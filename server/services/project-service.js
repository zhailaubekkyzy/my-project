// server/services/project-service.js - Project Access Control & Data Isolation
const crypto = require('crypto');
const db = require('../db');
const { mediaUrl } = require('./media-service');

/**
 * Unified Access Control Verification for Project Actions
 * Actions:
 *  - 'funnel:read' / 'funnel:write' (view/edit funnel settings)
 *  - 'analytics:read' (view analytics & metrics)
 *  - 'conversations:read' / 'conversations:write' (view CRM leads, chat history, takeover)
 *  - 'member:invite' / 'member:manage' (future collaborator invitations)
 *  - '*' (full administrative control)
 */
async function checkProjectAccess(userId, projectId, requiredAction = 'funnel:read') {
  if (!userId || !projectId) {
    return { allowed: false, reason: 'missing_parameters' };
  }

  const project = await db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
  if (!project) {
    return { allowed: false, reason: 'project_not_found' };
  }

  // 1. Owner always has full unconditional permissions
  if (project.owner_id === userId) {
    return {
      allowed: true,
      role: 'owner',
      permissions: ['*'],
      project
    };
  }

  // 2. Check project_members table for invited collaborators (e.g. invited marketer)
  const member = await db.get(
    'SELECT * FROM project_members WHERE project_id = ? AND user_id = ? AND status = ?',
    [projectId, userId, 'active']
  );

  if (!member) {
    // Note: Creating the template does NOT give the marketer access to the expert's project instance!
    return { allowed: false, reason: 'access_denied_not_a_member', project };
  }

  let permissions = [];
  try {
    permissions = JSON.parse(member.permissions || '[]');
  } catch (e) {
    permissions = [];
  }

  // Check if member has wildcard '*' or specific requested permission
  const hasPermission = permissions.includes('*') || permissions.includes(requiredAction);
  if (!hasPermission) {
    return {
      allowed: false,
      reason: 'insufficient_permissions',
      requiredAction,
      memberRole: member.role,
      project
    };
  }

  return {
    allowed: true,
    role: member.role,
    permissions,
    project
  };
}

/**
 * Role shown to clients must start with "SI" (SI-консультант, SI-помощник, SI-менеджер...).
 */
function normalizeRoleTitle(value) {
  if (typeof value !== 'string') return null;
  const title = value.trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!title) return null;
  if (/^SI(\b|-)/i.test(title)) return 'SI' + title.slice(2);
  return `SI-${title.charAt(0).toLowerCase()}${title.slice(1)}`;
}

/**
 * Project row as returned to the Mini App (JSON fields parsed, photo URL resolved).
 */
function decorateProject(p) {
  return {
    ...p,
    custom_ai_settings: safeJsonParse(p.custom_ai_settings),
    pricing_options: safeJsonParse(p.pricing_options),
    stats: safeJsonParse(p.stats),
    role_title: p.role_title || 'SI-консультант',
    photo_url: mediaUrl(p.photo_media_id)
  };
}

/**
 * Retrieve projects accessible to a user (as owner or active collaborator)
 */
async function getUserProjects(userId) {
  const ownedProjects = await db.all(
    'SELECT * FROM projects WHERE owner_id = ? ORDER BY created_at DESC',
    [userId]
  );

  const sharedProjects = await db.all(
    `SELECT p.*, pm.role as member_role, pm.permissions as member_permissions
     FROM projects p
     JOIN project_members pm ON p.id = pm.project_id
     WHERE pm.user_id = ? AND pm.status = 'active'
     ORDER BY p.created_at DESC`,
    [userId]
  );

  return {
    owned: ownedProjects.map(decorateProject),
    shared: sharedProjects.map(p => ({
      ...decorateProject(p),
      member_permissions: safeJsonParse(p.member_permissions)
    }))
  };
}

/**
 * Create a new expert project instance (optionally from a template)
 */
async function createProject(userId, { name, templateId, niche, customAiSettings, pricingOptions }) {
  const projectId = `proj_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  // Latin letters and digits only (Telegram start links allow [A-Za-z0-9_-]); a Cyrillic name leaves "si"
  const slugBase = (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '') || 'si';
  const cleanSlug = `${slugBase}-${Date.now().toString(36)}`;

  let templateCloneSettings = customAiSettings || {};
  if (templateId) {
    const tmpl = await db.get('SELECT * FROM funnel_templates WHERE id = ?', [templateId]);
    if (tmpl && !customAiSettings) {
      templateCloneSettings = safeJsonParse(tmpl.ai_clone_settings);
    }
  }

  await db.run(
    `INSERT INTO projects (id, owner_id, template_id, name, slug, status, niche, custom_ai_settings, pricing_options, stats, is_demo)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 0)`,
    [
      projectId,
      userId,
      templateId || null,
      name || 'Новый проект',
      cleanSlug,
      niche || 'Экспертные продажи',
      JSON.stringify(templateCloneSettings),
      JSON.stringify(pricingOptions || []), // no made-up prices: the expert sets the price on the card
      JSON.stringify({ traffic: 0, leads: 0, qualified: 0, bookings: 0, cr: 0, revenueRub: 0, savedHours: 0 })
    ]
  );

  return await db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
}

/**
 * Update project settings (strictly owner or collaborator with funnel:write)
 */
async function updateProject(projectId, updateData) {
  const fields = [];
  const values = [];

  if (updateData.name !== undefined) {
    fields.push('name = ?');
    values.push(updateData.name);
  }
  if (updateData.niche !== undefined) {
    fields.push('niche = ?');
    values.push(updateData.niche);
  }
  // Marketplace card (validated in routes/projects.js)
  for (const key of ['offer', 'description', 'price_label', 'payment_url', 'trial_days', 'category', 'is_listed']) {
    if (updateData[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(updateData[key]);
    }
  }
  if (updateData.role_title !== undefined) {
    fields.push('role_title = ?');
    values.push(normalizeRoleTitle(updateData.role_title));
  }
  if (updateData.status !== undefined) {
    fields.push('status = ?');
    values.push(updateData.status);
  }
  if (updateData.custom_ai_settings !== undefined) {
    fields.push('custom_ai_settings = ?');
    values.push(typeof updateData.custom_ai_settings === 'string' ? updateData.custom_ai_settings : JSON.stringify(updateData.custom_ai_settings));
  }
  if (updateData.pricing_options !== undefined) {
    fields.push('pricing_options = ?');
    values.push(typeof updateData.pricing_options === 'string' ? updateData.pricing_options : JSON.stringify(updateData.pricing_options));
  }
  if (updateData.stats !== undefined) {
    fields.push('stats = ?');
    values.push(typeof updateData.stats === 'string' ? updateData.stats : JSON.stringify(updateData.stats));
  }

  if (fields.length === 0) return null;

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(projectId);

  await db.run(
    `UPDATE projects SET ${fields.join(', ')} WHERE id = ?`,
    values
  );

  return await db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
}

/**
 * Get public seller profile for leads (strips confidential owner data, prompts, and settings)
 */
async function getPublicProjectBySlug(slug) {
  const project = await db.get(
    `SELECT p.id, p.name, p.slug, p.niche, p.pricing_options, p.custom_ai_settings, p.role_title, p.photo_media_id,
            u.display_name as expert_name, u.avatar_url as expert_avatar, u.photo_media_id as expert_photo_media_id,
            u.username as expert_username
     FROM projects p
     JOIN users u ON p.owner_id = u.id
     WHERE p.slug = ? AND p.status = 'active'`,
    [slug]
  );

  if (!project) return null;

  let aiSettings = safeJsonParse(project.custom_ai_settings);
  // Only expose public-facing parts of the AI seller
  const publicAiSeller = {
    greeting: aiSettings.greeting || `Здравствуйте! Я SI-консультант эксперта ${project.expert_name}. Чем могу помочь?`,
    roleTitle: project.role_title || 'SI-консультант',
    photoUrl: mediaUrl(project.photo_media_id),
    suggestedTopics: ['Узнать стоимость', 'Записаться на разбор', 'Задать вопрос']
  };

  return {
    projectId: project.id,
    name: project.name,
    slug: project.slug,
    niche: project.niche,
    expert: {
      name: project.expert_name,
      avatar: mediaUrl(project.expert_photo_media_id) || project.expert_avatar,
      username: project.expert_username
    },
    pricingOptions: safeJsonParse(project.pricing_options),
    aiSeller: publicAiSeller
  };
}

function safeJsonParse(str, defaultVal = {}) {
  if (!str) return defaultVal;
  if (typeof str === 'object') return str;
  try {
    return JSON.parse(str);
  } catch (e) {
    return defaultVal;
  }
}

module.exports = {
  checkProjectAccess,
  getUserProjects,
  createProject,
  updateProject,
  getPublicProjectBySlug,
  decorateProject,
  normalizeRoleTitle,
  safeJsonParse
};
