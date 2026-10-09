// server/routes/projects.js - Expert Projects & Funnel Instances Management
const express = require('express');
const router = express.Router();
const projectService = require('../services/project-service');
const { requireAuth } = require('../middleware/auth');
const { requireProjectPermission } = require('../middleware/permissions');
const db = require('../db');
const mediaService = require('../services/media-service');
const { cleanUrl, cleanText } = require('../services/profile-service');
const { readImageBody } = require('../middleware/image-upload');

// All project routes require valid authenticated user session
router.use(requireAuth);

/**
 * GET /api/projects
 * List all projects owned by or shared with current user
 */
router.get('/', async (req, res, next) => {
  try {
    const projects = await projectService.getUserProjects(req.user.userId);
    res.json(projects);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/projects
 * Create a new expert project / funnel instance
 */
router.post('/', async (req, res, next) => {
  try {
    const { name, templateId, niche, customAiSettings, pricingOptions } = req.body;

    const project = await projectService.createProject(req.user.userId, {
      name,
      templateId,
      niche,
      customAiSettings,
      pricingOptions
    });

    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});

/**
 * Marketplace card fields of an SI-consultant. Each consultant has its own payment link
 * (SmartFlow does not take payments): only https:// links are accepted.
 */
function readCardFields(body, project) {
  const fields = {};
  if (body.offer !== undefined) fields.offer = cleanText(body.offer, 200);
  if (body.description !== undefined) fields.description = cleanText(body.description, 1000);
  if (body.price_label !== undefined) fields.price_label = cleanText(body.price_label, 80);
  if (body.payment_url !== undefined) {
    const raw = String(body.payment_url || '').trim();
    if (raw && !cleanUrl(raw)) return { error: 'Ссылка на оплату должна начинаться с https://' };
    fields.payment_url = raw ? cleanUrl(raw) : null;
  }
  if (body.trial_days !== undefined) {
    fields.trial_days = Math.max(0, Math.min(60, parseInt(body.trial_days, 10) || 0));
  }
  if (body.category !== undefined) {
    fields.category = body.category === 'warmup' ? 'warmup' : 'sales';
  }
  if (body.is_listed !== undefined) {
    fields.is_listed = body.is_listed ? 1 : 0;
    const offer = fields.offer !== undefined ? fields.offer : project.offer;
    if (fields.is_listed && !offer) {
      return { error: 'Чтобы показать консультанта в Маркетплейсе, заполните оффер' };
    }
  }
  return { fields };
}

/**
 * GET /api/projects/:projectId
 * Get details of a specific project (requires funnel:read permission)
 */
router.get('/:projectId', requireProjectPermission('funnel:read'), async (req, res) => {
  res.json({
    ...projectService.decorateProject(req.project),
    userRole: req.projectRole,
    permissions: req.projectPermissions
  });
});

/**
 * PUT /api/projects/:projectId
 * Update project settings (requires funnel:write permission)
 * Note: owner_id CANNOT be modified or spoofed by client!
 */
router.put('/:projectId', requireProjectPermission('funnel:write'), async (req, res, next) => {
  try {
    const { name, niche, custom_ai_settings, pricing_options, status, role_title } = req.body;
    const card = readCardFields(req.body, req.project);
    if (card.error) return res.status(400).json({ error: 'bad_request', message: card.error });

    const updated = await projectService.updateProject(req.params.projectId, {
      name: name !== undefined ? cleanText(name, 80) || req.project.name : undefined,
      niche,
      custom_ai_settings,
      pricing_options,
      status,
      role_title,
      ...card.fields
    });

    res.json(projectService.decorateProject(updated || req.project));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/projects/:projectId/photo
 * Photo of the SI-consultant (requires funnel:write). Body: the image file itself.
 */
router.post('/:projectId/photo', requireProjectPermission('funnel:write'), readImageBody, async (req, res, next) => {
  try {
    const previous = req.project.photo_media_id;
    const saved = await mediaService.saveImage(req.user.userId, req.body, 'consultant_photo');
    await db.run('UPDATE projects SET photo_media_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [saved.id, req.project.id]);
    await mediaService.deleteImage(previous);
    res.status(201).json({ photoUrl: saved.url });
  } catch (err) {
    if (err instanceof mediaService.MediaError) {
      return res.status(err.status).json({ error: 'bad_request', code: err.code, message: err.message });
    }
    next(err);
  }
});

/**
 * GET /api/projects/:projectId/analytics
 * Get project metrics (requires analytics:read permission)
 */
router.get('/:projectId/analytics', requireProjectPermission('analytics:read'), async (req, res) => {
  const p = req.project;
  const stats = projectService.safeJsonParse(p.stats, {
    traffic: 0,
    leads: 0,
    qualified: 0,
    bookings: 0,
    cr: 0,
    revenueRub: 0,
    savedHours: 0
  });

  // Live counts from the database (real numbers only)
  const count = async (sql, params) => ((await db.get(sql, params)) || {}).count || 0;
  const clients = await count('SELECT COUNT(*) as count FROM clients WHERE project_id = ?', [p.id]);
  const talked = await count(
    `SELECT COUNT(DISTINCT client_id) as count FROM conversations WHERE project_id = ? AND sender = 'client'`, [p.id]);
  const clientMessages = await count(`SELECT COUNT(*) as count FROM conversations WHERE project_id = ? AND sender = 'client'`, [p.id]);
  const siReplies = await count(`SELECT COUNT(*) as count FROM conversations WHERE project_id = ? AND sender = 'ai'`, [p.id]);
  const humanRequests = await count('SELECT COUNT(*) as count FROM direct_inquiries WHERE project_id = ?', [p.id]);
  const waiting = await count(`SELECT COUNT(*) as count FROM direct_inquiries WHERE project_id = ? AND status = 'waiting'`, [p.id]);

  res.json({
    stats: {
      ...stats,
      totalLeadsInDb: clients,
      activeHumanInquiries: waiting
    },
    live: { clients, talked, clientMessages, siReplies, humanRequests, waiting }
  });
});

module.exports = router;
