// server/routes/clients.js - CRM Leads & Direct Inquiries
const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireProjectPermission } = require('../middleware/permissions');
const projectService = require('../services/project-service');
const chatService = require('../services/chat-service');
const funnelService = require('../services/funnel-service');

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

    res.json({
      ...toClientCard(client, req.projectRole),
      funnel_label: funnelService.STATUSES[client.funnel_status] || null,
      events: await funnelService.eventsOf(client.id, 50)
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
