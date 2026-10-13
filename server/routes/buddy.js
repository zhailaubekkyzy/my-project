// server/routes/buddy.js - The conversation with Buddy (personal helper) and its notifications.
// Each person sees only their own messages; identity comes from the Telegram login.
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const buddyService = require('../services/buddy-service');

router.use(requireAuth);

/**
 * GET /api/buddy/messages — the last messages (oldest first), unread count, today's limit
 */
router.get('/messages', async (req, res, next) => {
  try {
    const user = await db.get('SELECT id, tz_offset_minutes FROM users WHERE id = ?', [req.user.userId]);
    const list = await buddyService.messages(req.user.userId);
    res.json({
      messages: list,
      unread: list.filter(m => m.sender === 'buddy' && !m.read).length,
      usage: await buddyService.usage(req.user.userId, user && user.tz_offset_minutes)
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/buddy/messages  { text, tzOffset } — write to Buddy; tzOffset = minutes east of UTC
 */
router.post('/messages', async (req, res, next) => {
  try {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.userId]);
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'bad_request', message: 'Сообщение не может быть пустым' });
    const result = await buddyService.send(user, text, req.body?.tzOffset);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/buddy/read — the person opened Buddy: everything is read
 */
router.post('/read', async (req, res, next) => {
  try {
    await buddyService.markAllRead(req.user.userId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
