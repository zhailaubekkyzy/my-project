// server/routes/clients.js - CRM Leads & Direct Inquiries
const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireProjectPermission } = require('../middleware/permissions');
const projectService = require('../services/project-service');
const chatService = require('../services/chat-service');
const funnelService = require('../services/funnel-service');
const receiptService = require('../services/receipt-service');

router.use(requireAuth);

// A client card for the Office. The assistant does not see money (deal value).
function toClientCard(c, role) {
  const card = {
    ...c,
    tags: projectService.safeJsonParse(c.tags, []),
    qualification_answers: projectService.safeJsonParse(c.qualification_answers, {}),
    si_paused: chatService.isSiPaused(c),
    responsible_name: c.responsible_name || null
  };
  delete card.responsible_profile;
  if (c.responsible_profile) {
    const custom = (projectService.safeJsonParse(c.responsible_profile).displayName || '').trim();
    if (custom) card.responsible_name = custom;
  }
  if (role === 'assistant') delete card.deal_value;
  return card;
}

const CLIENT_SELECT = `SELECT c.*, u.display_name AS responsible_name, u.profile AS responsible_profile
  FROM clients c LEFT JOIN users u ON u.id = c.responsible_user_id`;

const memberOf = (req) => ({ userId: req.user.userId, role: req.projectRole === 'assistant' ? 'assistant' : 'owner' });

/**
 * GET /api/projects/:projectId/clients
 * List leads in CRM (strictly checks conversations:read)
 */
router.get('/', requireProjectPermission('conversations:read'), async (req, res, next) => {
  try {
    const clients = await db.all(
      `${CLIENT_SELECT} WHERE c.project_id = ? ORDER BY c.last_activity DESC`,
      [req.project.id]
    );

    res.json(clients.map(c => toClientCard(c, req.projectRole)));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/projects/:projectId/clients/:clientId
 * Get single lead details
 */
router.get('/:clientId', requireProjectPermission('conversations:read'), async (req, res, next) => {
  try {
    const client = await db.get(
      `${CLIENT_SELECT} WHERE c.id = ? AND c.project_id = ?`,
      [req.params.clientId, req.project.id]
    );

    if (!client) {
      return res.status(404).json({ error: 'not_found', message: 'Клиент не найден в данном проекте' });
    }

    // Steps of the funnel (titles only: the assistant sees where the client is, not the settings)
    const steps = funnelService.normalizeSteps(projectService.safeJsonParse(req.project.custom_ai_settings).steps);
    res.json({
      ...toClientCard(client, req.projectRole),
      steps: steps.map(s => ({ id: s.id, title: s.title })),
      current_step_id: steps.length ? funnelService.currentStep(steps, client).id : null,
      funnel_label: funnelService.STATUSES[client.funnel_status] || null,
      events: await funnelService.eventsOf(client.id, 50),
      receipts: await receiptService.receiptsOf(client.id)
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/projects/:projectId/clients/:clientId/si  { enabled }
 * Turn the SI back on for a client (or pause it: the owner / assistant becomes responsible)
 */
router.post('/:clientId/si', requireProjectPermission('conversations:write'), async (req, res, next) => {
  try {
    const client = await db.get('SELECT * FROM clients WHERE id = ? AND project_id = ?', [req.params.clientId, req.project.id]);
    if (!client) return res.status(404).json({ error: 'not_found', message: 'Клиент не найден в данном проекте' });
    const enabled = Boolean(req.body && req.body.enabled);
    await chatService.setSiEnabled(client, enabled, memberOf(req));
    res.json({ clientId: client.id, siEnabled: enabled });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/projects/:projectId/clients/:clientId/funnel  { outcome: 'paid' | 'refused' | 'reopened' }
 * The owner or the assistant marks "Купил", "Отказ" or returns the client into the funnel
 */
router.post('/:clientId/funnel', requireProjectPermission('conversations:write'), async (req, res, next) => {
  try {
    const client = await db.get('SELECT * FROM clients WHERE id = ? AND project_id = ?', [req.params.clientId, req.project.id]);
    if (!client) return res.status(404).json({ error: 'not_found', message: 'Клиент не найден в данном проекте' });
    const status = await chatService.markOutcome(req.project, client, String(req.body?.outcome || ''), memberOf(req));
    if (!status) return res.status(400).json({ error: 'bad_request', message: 'Неизвестный итог' });
    res.json({
      clientId: client.id,
      funnelStatus: status,
      funnelLabel: funnelService.STATUSES[status],
      events: await funnelService.eventsOf(client.id, 50)
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/projects/:projectId/clients/:clientId/step  { stepId }
 * The owner or the assistant moves the client to a step of the funnel by hand (forward or back).
 * The step's material is not sent: a hand move must never write to the client unexpectedly.
 */
router.post('/:clientId/step', requireProjectPermission('conversations:write'), async (req, res, next) => {
  try {
    const client = await db.get('SELECT * FROM clients WHERE id = ? AND project_id = ?', [req.params.clientId, req.project.id]);
    if (!client) return res.status(404).json({ error: 'not_found', message: 'Клиент не найден в данном проекте' });
    const steps = funnelService.normalizeSteps(projectService.safeJsonParse(req.project.custom_ai_settings).steps);
    const stepId = String(req.body?.stepId || '');
    if (!steps.some(s => s.id === stepId)) return res.status(400).json({ error: 'bad_request', message: 'Такого шага нет' });
    const member = memberOf(req);
    await chatService.moveToStep(req.project, client, stepId, { type: member.role, userId: member.userId });
    res.json({ clientId: client.id, currentStepId: stepId, events: await funnelService.eventsOf(client.id, 50) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/projects/:projectId/clients/:clientId/receipts/:receiptId/file
 * The receipt itself (photo or PDF) — only for the people of the business
 */
router.get('/:clientId/receipts/:receiptId/file', requireProjectPermission('conversations:read'), async (req, res, next) => {
  try {
    const client = await db.get('SELECT id FROM clients WHERE id = ? AND project_id = ?', [req.params.clientId, req.project.id]);
    const file = client ? await receiptService.receiptFile(client.id, req.params.receiptId) : null;
    if (!file) return res.status(404).json({ error: 'not_found', message: 'Чек не найден' });
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.send(file.buffer);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/projects/:projectId/clients/:clientId/receipts/:receiptId  { action: 'confirm' | 'reject' }
 * The owner or the assistant checks a receipt: confirmed → "Купили" and the access link to the client
 */
router.post('/:clientId/receipts/:receiptId', requireProjectPermission('conversations:write'), async (req, res, next) => {
  try {
    const client = await db.get('SELECT * FROM clients WHERE id = ? AND project_id = ?', [req.params.clientId, req.project.id]);
    if (!client) return res.status(404).json({ error: 'not_found', message: 'Клиент не найден в данном проекте' });
    const result = await receiptService.reviewReceipt(req.project, client, req.params.receiptId, String(req.body?.action || ''), memberOf(req));
    res.json({ ...result, funnelLabel: funnelService.STATUSES[result.funnelStatus], events: await funnelService.eventsOf(client.id, 50), receipts: await receiptService.receiptsOf(client.id) });
  } catch (err) {
    if (err instanceof receiptService.ReceiptError) {
      return res.status(err.status).json({ error: 'bad_request', code: err.code, message: err.message });
    }
    next(err);
  }
});

/**
 * GET /api/projects/:projectId/inquiries
 * List priority direct inquiries ("Кто написал лично 👤")
 */
router.get('/inquiries/list', requireProjectPermission('conversations:read'), async (req, res, next) => {
  try {
    const inquiries = await db.all(
      'SELECT * FROM direct_inquiries WHERE project_id = ? ORDER BY created_at DESC',
      [req.project.id]
    );

    res.json(inquiries);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/projects/:projectId/inquiries/:inquiryId/resolve
 * Mark direct inquiry answered (requires conversations:write)
 */
router.post('/inquiries/:inquiryId/resolve', requireProjectPermission('conversations:write'), async (req, res, next) => {
  try {
    const inquiry = await db.get(
      'SELECT * FROM direct_inquiries WHERE id = ? AND project_id = ?',
      [req.params.inquiryId, req.project.id]
    );

    if (!inquiry) {
      return res.status(404).json({ error: 'not_found', message: 'Запрос не найден' });
    }

    await db.run(
      `UPDATE direct_inquiries SET status = 'answered', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [inquiry.id]
    );

    res.json({ message: 'Запрос успешно помечен как обработанный', id: inquiry.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
