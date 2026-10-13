// server/routes/conversations.js - Messages and CRM Chat History
const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db');
const chatService = require('../services/chat-service');
const voiceService = require('../services/voice-service');
const { requireAuth } = require('../middleware/auth');
const { requireProjectPermission } = require('../middleware/permissions');

router.use(requireAuth);

/**
 * GET /api/projects/:projectId/conversations/:clientId/messages
 * Retrieve full chat history (requires conversations:read)
 */
router.get('/:clientId/messages', requireProjectPermission('conversations:read'), async (req, res, next) => {
  try {
    res.json(await chatService.history(req.project.id, req.params.clientId));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/projects/:projectId/conversations/:clientId/voice/:voiceId
 * A client's voice message, to play it (the owner and the assistant of the business)
 */
router.get('/:clientId/voice/:voiceId', requireProjectPermission('conversations:read'), async (req, res, next) => {
  try {
    const client = await db.get('SELECT id FROM clients WHERE id = ? AND project_id = ?', [req.params.clientId, req.project.id]);
    const file = client ? await voiceService.voiceFile(client.id, req.params.voiceId) : null;
    if (!file) return res.status(404).json({ error: 'not_found', message: 'Голосовое не найдено' });
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
 * POST /api/projects/:projectId/conversations/:clientId/messages
 * Send message from the owner or the assistant personally (requires conversations:write)
 */
router.post('/:clientId/messages', requireProjectPermission('conversations:write'), async (req, res, next) => {
  try {
    const text = String(req.body?.text || '').trim().slice(0, 2000);
    if (!text) {
      return res.status(400).json({ error: 'bad_request', message: 'Текст сообщения не может быть пустым' });
    }
    const client = await db.get('SELECT * FROM clients WHERE id = ? AND project_id = ?', [req.params.clientId, req.project.id]);
    if (!client) return res.status(404).json({ error: 'not_found', message: 'Клиент не найден в данном проекте' });

    // The owner or the assistant answers personally: they become responsible for the dialog
    // (SI pauses for this client), the client gets a Telegram message
    const member = { userId: req.user.userId, role: req.projectRole === 'assistant' ? 'assistant' : 'owner' };
    const message = await chatService.humanReply(req.project, client, text, member);
    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
