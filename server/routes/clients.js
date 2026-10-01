// server/routes/clients.js - CRM Leads & Direct Inquiries
const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireProjectPermission } = require('../middleware/permissions');
const projectService = require('../services/project-service');

router.use(requireAuth);

/**
 * GET /api/projects/:projectId/clients
 * List leads in CRM (strictly checks conversations:read)
 */
router.get('/', requireProjectPermission('conversations:read'), async (req, res, next) => {
  try {
    const clients = await db.all(
      'SELECT * FROM clients WHERE project_id = ? ORDER BY last_activity DESC',
      [req.project.id]
    );

    res.json(clients.map(c => ({
      ...c,
      tags: projectService.safeJsonParse(c.tags, []),
      qualification_answers: projectService.safeJsonParse(c.qualification_answers, {})
    })));
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
      'SELECT * FROM clients WHERE id = ? AND project_id = ?',
      [req.params.clientId, req.project.id]
    );

    if (!client) {
      return res.status(404).json({ error: 'not_found', message: 'Клиент не найден в данном проекте' });
    }

    res.json({
      ...client,
      tags: projectService.safeJsonParse(client.tags, []),
      qualification_answers: projectService.safeJsonParse(client.qualification_answers, {})
    });
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
