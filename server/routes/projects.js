// server/routes/projects.js - Expert Projects & Funnel Instances Management
const express = require('express');
const router = express.Router();
const projectService = require('../services/project-service');
const marketplaceService = require('../services/marketplace-service');
const quickStart = require('../services/quick-start');
const slugService = require('../services/slug-service');
const funnelService = require('../services/funnel-service');
const reviewService = require('../services/review-service');
const analytics = require('../services/analytics-service');
const partnerService = require('../services/partner-service');
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
    const { name, templateId, niche, customAiSettings, pricingOptions, businessId, productId } = req.body;

    const project = await projectService.createProject(req.user.userId, {
      name,
      templateId,
      niche,
      customAiSettings: projectService.limitAiSettings(customAiSettings),
      pricingOptions,
      businessId: businessId ? String(businessId) : null,
      productId: productId ? String(productId) : null
    });

    analytics.capture('si_seller_created', req.user.userId);
    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/projects/quick-start  { goal, about, offer, priceMode, priceLabel, link }
 * «Быстрый старт»: a working SI-seller from one of four simple goals (server/services/quick-start.js).
 * goal: consult | sell | leads | free. about — who the expert is in a word («нутрициолог»);
 * link — the payment link (sell, optional) or the free material (free, required: a link or a text).
 */
router.post('/quick-start', async (req, res, next) => {
  try {
    const body = req.body || {};
    const template = quickStart.TEMPLATES[body.goal];
    if (!template) return res.status(400).json({ error: 'bad_request', message: 'Выберите цель' });
    const about = cleanText(body.about, 40);
    const offer = cleanText(body.offer, 200);
    if (!about) return res.status(400).json({ error: 'bad_request', message: 'Напишите, чем вы занимаетесь' });
    if (!offer) return res.status(400).json({ error: 'bad_request', message: 'Напишите, что получит клиент' });
    const rawLink = cleanText(body.link, 500);
    let paymentUrl = null;
    let material = '';
    if (body.goal === 'free') {
      if (!rawLink) return res.status(400).json({ error: 'bad_request', message: 'Добавьте ссылку на материал или его текст' });
      material = rawLink;
    } else if (rawLink && body.goal === 'sell') {
      paymentUrl = cleanUrl(rawLink);
      if (!paymentUrl) return res.status(400).json({ error: 'bad_request', message: 'Ссылка на оплату должна начинаться с https://' });
    }
    const priceMode = marketplaceService.PRICE_MODES.includes(body.priceMode) ? body.priceMode : template.priceMode;
    const priceLabel = priceMode === 'fixed' ? cleanText(body.priceLabel, 80) : '';

    const user = await db.get('SELECT display_name, profile FROM users WHERE id = ?', [req.user.userId]);
    const shownName = (projectService.safeJsonParse(user && user.profile).displayName || (user && user.display_name) || '').trim();
    const firstName = shownName.split(/\s+/)[0] || 'Эксперт';
    const plan = template.build({ offer, link: material });

    const project = await projectService.createProject(req.user.userId, {
      name: `${firstName} · ${about}`.slice(0, 80),
      niche: about,
      // In which of my businesses («Бизнес-режим 2.0»); without it — the main one
      businessId: body.businessId ? String(body.businessId) : null,
      customAiSettings: projectService.limitAiSettings({
        clientLimit: 40,
        quickStart: body.goal,
        goal: plan.goal,
        instructions: plan.instructions,
        methodology: plan.methodology,
        steps: funnelService.normalizeSteps(plan.steps),
        scenarios: funnelService.normalizeScenarios(plan.scenarios, plan.steps)
      })
    });
    const updated = await projectService.updateProject(project.id, {
      offer,
      price_mode: priceMode,
      price_label: priceLabel,
      payment_url: paymentUrl,
      cta_kind: template.cta,
      cta_label: template.ctaLabel || null
    });
    analytics.capture('si_seller_created', req.user.userId, { template: body.goal });
    res.status(201).json(projectService.decorateProject(updated || project));
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
  // Access link after a confirmed payment (sent to the client only after a person confirms the receipt)
  if (body.access_url !== undefined) {
    const raw = String(body.access_url || '').trim();
    if (raw && !cleanUrl(raw)) return { error: 'Ссылка на доступ должна начинаться с https://' };
    fields.access_url = raw ? cleanUrl(raw) : null;
  }
  if (body.trial_days !== undefined) {
    fields.trial_days = Math.max(0, Math.min(60, parseInt(body.trial_days, 10) || 0));
  }
  // Price mode and the card button (the expert chooses for each SI-seller)
  if (body.price_mode !== undefined) {
    fields.price_mode = marketplaceService.PRICE_MODES.includes(body.price_mode) ? body.price_mode : 'fixed';
  }
  if (body.cta_kind !== undefined) {
    fields.cta_kind = marketplaceService.CTA_KINDS.includes(body.cta_kind) ? body.cta_kind : 'buy';
  }
  if (body.cta_label !== undefined) fields.cta_label = cleanText(body.cta_label, 40) || null;
  if (body.category !== undefined) {
    fields.category = body.category === 'warmup' ? 'warmup' : 'sales';
  }
  if (body.is_listed !== undefined) {
    fields.is_listed = body.is_listed ? 1 : 0;
    // Hidden by the support team after a complaint: only the team shows it again
    if (fields.is_listed && Number(project.hidden_by_staff) === 1) {
      return { error: 'Команда SmartFlow скрыла этого SI-продавца из Маркетплейса. Чтобы вернуть его, напишите в поддержку.', status: 403 };
    }
    const offer = fields.offer !== undefined ? fields.offer : project.offer;
    if (fields.is_listed && !offer) {
      return { error: 'Чтобы показать SI-продавца в Маркетплейсе, заполните оффер' };
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
    // status (on / off) is not taken from here: only the support team turns an SI-seller off and on
    const { name, niche, custom_ai_settings, pricing_options, role_title } = req.body;
    const card = readCardFields(req.body, req.project);
    if (card.error) return res.status(card.status || 400).json({ error: card.status === 403 ? 'forbidden' : 'bad_request', message: card.error });

    // The short link («aliya-nutri»): the old address keeps working (slug-service)
    if (req.body.slug !== undefined) {
      try {
        req.project.slug = await slugService.change(req.project, req.body.slug);
      } catch (err) {
        if (err instanceof slugService.SlugError) return res.status(err.status).json({ error: 'bad_request', code: err.code, message: err.message });
        throw err;
      }
    }

    // "If…, then…" scenarios are part of the methodology: only known conditions and actions are kept
    let aiSettings = projectService.limitAiSettings(custom_ai_settings);
    // The general description of the methodology: plain text, limited
    if (aiSettings && typeof aiSettings === 'object' && aiSettings.methodology !== undefined) {
      aiSettings = { ...aiSettings, methodology: String(aiSettings.methodology || '').trim().slice(0, 3000) };
    }
    // Steps of the funnel: up to 8, each with a title. Scenarios of a deleted step are dropped
    if (aiSettings && typeof aiSettings === 'object' && aiSettings.steps !== undefined) {
      aiSettings = { ...aiSettings, steps: funnelService.normalizeSteps(aiSettings.steps) };
    }
    if (aiSettings && typeof aiSettings === 'object' && aiSettings.scenarios !== undefined) {
      const steps = aiSettings.steps !== undefined ? aiSettings.steps : (projectService.safeJsonParse(req.project.custom_ai_settings).steps || []);
      aiSettings = { ...aiSettings, scenarios: funnelService.normalizeScenarios(aiSettings.scenarios, steps) };
    }

    const updated = await projectService.updateProject(req.params.projectId, {
      name: name !== undefined ? cleanText(name, 80) || req.project.name : undefined,
      niche,
      custom_ai_settings: aiSettings,
      pricing_options,
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

  // Two ways in (owner's decision 20 Nov.): how many clients came by each and how many bought.
  // 'old' — clients from before the entry was remembered (24th migration)
  const entryRows = await db.all(
    `SELECT COALESCE(entry, 'old') AS entry, COUNT(*) AS clients,
            SUM(CASE WHEN funnel_status = 'bought' THEN 1 ELSE 0 END) AS bought
     FROM clients WHERE project_id = ? AND COALESCE(entry, '') <> 'self' GROUP BY COALESCE(entry, 'old')`, [p.id]);
  const entries = {};
  for (const r of entryRows) entries[r.entry] = { clients: Number(r.clients) || 0, bought: Number(r.bought) || 0 };
  const cardViews = await count('SELECT COUNT(*) as count FROM card_views WHERE project_id = ? AND user_id <> ?', [p.id, p.owner_id]);

  res.json({
    stats: {
      ...stats,
      totalLeadsInDb: clients,
      activeHumanInquiries: waiting
    },
    live: { clients, talked, clientMessages, siReplies, humanRequests, waiting },
    entries,
    cardViews
  });
});

/**
 * GET /api/projects/:projectId/links — links with a traffic source (up to 3) and their numbers
 * POST /api/projects/:projectId/links  { label } — a new link for this SI-seller
 * DELETE /api/projects/:projectId/links/:linkId — hide it (it keeps working, its people stay counted)
 */
router.get('/:projectId/links', requireProjectPermission('funnel:write'), async (req, res, next) => {
  try {
    res.json(await partnerService.projectLinks(req.project));
  } catch (err) {
    next(err);
  }
});

router.post('/:projectId/links', requireProjectPermission('funnel:write'), async (req, res, next) => {
  try {
    res.status(201).json({ link: await partnerService.createSourceLink(req.project, req.user.userId, req.body?.label) });
  } catch (err) {
    if (err instanceof partnerService.PartnerError) return res.status(err.status).json({ error: 'bad_request', code: err.code, message: err.message });
    next(err);
  }
});

router.delete('/:projectId/links/:linkId', requireProjectPermission('funnel:write'), async (req, res, next) => {
  try {
    await partnerService.archiveSourceLink(req.project, req.params.linkId);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof partnerService.PartnerError) return res.status(err.status).json({ error: 'bad_request', code: err.code, message: err.message });
    next(err);
  }
});

/**
 * GET /api/projects/:projectId/reviews — all reviews of my SI-seller (hidden ones marked)
 * POST /api/projects/:projectId/reviews/:reviewId/reply  { text } — answer (empty = remove the answer)
 * The owner only: the expert answers a review but never deletes it.
 */
router.get('/:projectId/reviews', requireProjectPermission('funnel:write'), async (req, res, next) => {
  try {
    res.json({ reviews: await reviewService.reviewsForOwner(req.project.id) });
  } catch (err) {
    next(err);
  }
});

router.post('/:projectId/reviews/:reviewId/reply', requireProjectPermission('funnel:write'), async (req, res, next) => {
  try {
    res.json({ review: await reviewService.reply(req.project, req.params.reviewId, req.body?.text) });
  } catch (err) {
    if (err instanceof reviewService.ReviewError) return res.status(err.status).json({ error: 'bad_request', code: err.code, message: err.message });
    next(err);
  }
});

module.exports = router;
