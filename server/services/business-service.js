// server/services/business-service.js - Business: the expert's company above their SI-sellers.
// SI-sellers (projects), clients, conversations and "Мне написали" requests belong to it.
// Members are rows in business_members (owner / assistant). Rights are checked here, on the
// server: the app talks only to the server, RLS in Supabase stays a closed lock.
const crypto = require('crypto');
const db = require('../db');
const telegramBot = require('./telegram-bot');
const supportService = require('./support-service');

// How many assistants one business may have. Raise this number to allow more.
const MAX_ASSISTANTS = 1;

const ROLES = { OWNER: 'owner', ASSISTANT: 'assistant' };

// What an assistant may do on the business's SI-sellers (see project-service.checkProjectAccess):
// answer in "Мне написали", pause / resume the SI, look at client cards. Not: money and payment
// links, SI-brain, SI-sellers and their settings, analytics.
const ASSISTANT_PERMISSIONS = ['conversations:read', 'conversations:write'];

class BusinessError extends Error {
  constructor(message, status = 400, code = 'BAD_REQUEST') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const newId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

function displayNameOf(user) {
  if (!user) return '';
  let custom = '';
  try { custom = (JSON.parse(user.profile || '{}').displayName || '').trim(); } catch (e) {}
  return custom || user.display_name;
}

async function businessOfOwner(ownerId) {
  return db.get('SELECT * FROM businesses WHERE owner_id = ?', [ownerId]);
}

/**
 * Puts the owner's SI-sellers and everything around them into the business (rows not moved yet).
 * Returns how many SI-sellers were moved.
 */
async function attachOwnerData(business) {
  const moved = await db.run('UPDATE projects SET business_id = ? WHERE owner_id = ? AND business_id IS NULL', [business.id, business.owner_id]);
  const inOwnerProjects = 'business_id IS NULL AND project_id IN (SELECT id FROM projects WHERE business_id = ?)';
  await db.run(`UPDATE clients SET business_id = ? WHERE ${inOwnerProjects}`, [business.id, business.id]);
  await db.run(`UPDATE conversations SET business_id = ? WHERE ${inOwnerProjects}`, [business.id, business.id]);
  await db.run(`UPDATE direct_inquiries SET business_id = ? WHERE ${inOwnerProjects}`, [business.id, business.id]);
  await db.run(`UPDATE client_events SET business_id = ? WHERE ${inOwnerProjects}`, [business.id, business.id]);
  return moved.changes || 0;
}

/**
 * The expert's business; created on first need (the expert turned an SI-seller on).
 * Safe to call twice at the same time: one business per owner (UNIQUE owner_id).
 */
async function ensureBusiness(ownerId) {
  let business = await businessOfOwner(ownerId);
  if (!business) {
    await db.run(
      'INSERT INTO businesses (id, owner_id) VALUES (?, ?) ON CONFLICT (owner_id) DO NOTHING',
      [newId('biz'), ownerId]
    );
    business = await businessOfOwner(ownerId);
    await db.run(
      `INSERT INTO business_members (id, business_id, user_id, role, status)
       VALUES (?, ?, ?, 'owner', 'active') ON CONFLICT (business_id, user_id) DO NOTHING`,
      [newId('bm'), business.id, ownerId]
    );
  }
  await attachOwnerData(business);
  return business;
}

/**
 * Business of an SI-seller: if the owner has none yet (the SI-seller just started talking to
 * clients), it is created. Returns the business id.
 */
async function ensureProjectBusiness(project) {
  if (project.business_id) return project.business_id;
  const business = await ensureBusiness(project.owner_id);
  project.business_id = business.id;
  return business.id;
}

/**
 * The person's active role in this business: 'owner' | 'assistant' | null.
 */
async function roleIn(businessId, userId) {
  if (!businessId || !userId) return null;
  const row = await db.get(
    `SELECT role FROM business_members WHERE business_id = ? AND user_id = ? AND status = 'active'`,
    [businessId, userId]
  );
  return row ? row.role : null;
}

/**
 * People of the business who answer clients (owner and assistants), for bot notifications.
 */
async function activeMemberIds(businessId) {
  if (!businessId) return [];
  const rows = await db.all(`SELECT user_id FROM business_members WHERE business_id = ? AND status = 'active'`, [businessId]);
  return rows.map(r => r.user_id);
}

async function listMembers(businessId) {
  const rows = await db.all(
    `SELECT m.user_id, m.role, m.created_at, u.display_name, u.profile, u.username, u.support_code
     FROM business_members m JOIN users u ON u.id = m.user_id
     WHERE m.business_id = ? AND m.status = 'active'
     ORDER BY CASE WHEN m.role = 'owner' THEN 0 ELSE 1 END, m.created_at`,
    [businessId]
  );
  return rows.map(r => ({
    userId: r.user_id,
    role: r.role,
    name: displayNameOf(r),
    username: r.username || null,
    supportCode: r.support_code || null,
    since: r.created_at
  }));
}

/**
 * What the signed-in person sees about businesses: their own (with members) and the ones they assist.
 */
async function overview(userId) {
  const own = await businessOfOwner(userId);
  const assisting = await db.all(
    `SELECT b.id, b.owner_id, u.display_name, u.profile
     FROM business_members m
     JOIN businesses b ON b.id = m.business_id
     JOIN users u ON u.id = b.owner_id
     WHERE m.user_id = ? AND m.role = 'assistant' AND m.status = 'active'`,
    [userId]
  );
  const ownProjects = own ? null : await db.get('SELECT COUNT(*) AS count FROM projects WHERE owner_id = ?', [userId]);
  return {
    business: own ? { id: own.id, members: await listMembers(own.id) } : null,
    // No business yet: it appears when the expert turns an SI-seller on (Office terms or a new SI-seller)
    canCreate: !own && Boolean(ownProjects && ownProjects.count),
    maxAssistants: MAX_ASSISTANTS,
    assisting: assisting.map(b => ({ businessId: b.id, ownerName: displayNameOf(b) }))
  };
}

/**
 * The owner adds an assistant by their number from Profile (SF-48213).
 */
async function addAssistant(ownerId, rawCode) {
  const business = await businessOfOwner(ownerId);
  if (!business) throw new BusinessError('Сначала включите своего SI-продавца в Офисе — бизнес появится вместе с ним.', 400, 'NO_BUSINESS');

  const code = supportService.normalizeSupportCode(rawCode);
  const user = code ? await db.get('SELECT * FROM users WHERE support_code = ?', [code]) : null;
  if (!user) throw new BusinessError('Человек с таким номером не найден. Номер — внизу его Профиля, вида SF-48213.', 404, 'USER_NOT_FOUND');
  if (user.id === ownerId) throw new BusinessError('Это ваш собственный номер.', 400, 'SELF');
  if (user.status === 'blocked') throw new BusinessError('Этот человек заблокирован в SmartFlow.', 400, 'BLOCKED');

  const existing = await db.get('SELECT * FROM business_members WHERE business_id = ? AND user_id = ?', [business.id, user.id]);
  if (existing && existing.status === 'active') throw new BusinessError('Этот человек уже ваш помощник.', 409, 'ALREADY_MEMBER');

  const count = await db.get(
    `SELECT COUNT(*) AS count FROM business_members WHERE business_id = ? AND role = 'assistant' AND status = 'active'`,
    [business.id]
  );
  if (count.count >= MAX_ASSISTANTS) {
    throw new BusinessError(
      MAX_ASSISTANTS === 1 ? 'Помощник может быть только один. Сначала уберите текущего.' : `Помощников может быть не больше ${MAX_ASSISTANTS}.`,
      409, 'ASSISTANT_LIMIT'
    );
  }

  if (existing) {
    await db.run(
      `UPDATE business_members SET role = 'assistant', status = 'active', invited_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [ownerId, existing.id]
    );
  } else {
    await db.run(
      `INSERT INTO business_members (id, business_id, user_id, role, status, invited_by) VALUES (?, ?, ?, 'assistant', 'active', ?)`,
      [newId('bm'), business.id, user.id, ownerId]
    );
  }

  const owner = await db.get('SELECT display_name, profile FROM users WHERE id = ?', [ownerId]);
  const firstProject = await db.get('SELECT id FROM projects WHERE business_id = ? ORDER BY created_at LIMIT 1', [business.id]);
  await telegramBot.notifyUser(
    user.id,
    `🤝 ${displayNameOf(owner)} добавил(а) вас помощником в SmartFlow.\nВы сможете отвечать клиентам в «Мне написали» и ставить SI на паузу.`,
    { buttonText: 'Открыть Офис', startParam: firstProject ? `I_${firstProject.id}` : undefined }
  );
  return listMembers(business.id);
}

async function removeAssistant(ownerId, assistantUserId) {
  const business = await businessOfOwner(ownerId);
  if (!business) throw new BusinessError('Бизнес не найден.', 404, 'NO_BUSINESS');
  const res = await db.run(
    `UPDATE business_members SET status = 'removed', updated_at = CURRENT_TIMESTAMP
     WHERE business_id = ? AND user_id = ? AND role = 'assistant' AND status = 'active'`,
    [business.id, assistantUserId]
  );
  if (!res.changes) throw new BusinessError('Такого помощника нет.', 404, 'NOT_MEMBER');
  // Dialogs the assistant was answering go back to the owner (the SI stays paused there)
  await db.run(
    `UPDATE clients SET responsible_user_id = ? WHERE business_id = ? AND responsible_type = 'human' AND responsible_user_id = ?`,
    [ownerId, business.id, assistantUserId]
  );
  return listMembers(business.id);
}

module.exports = {
  MAX_ASSISTANTS,
  ROLES,
  ASSISTANT_PERMISSIONS,
  BusinessError,
  businessOfOwner,
  ensureBusiness,
  ensureProjectBusiness,
  attachOwnerData,
  roleIn,
  activeMemberIds,
  listMembers,
  overview,
  addAssistant,
  removeAssistant
};
