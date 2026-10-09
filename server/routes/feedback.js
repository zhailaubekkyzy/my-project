// server/routes/feedback.js - Complaints and suggestions sent to the SI-assistant ("Поддержка").
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const supportService = require('../services/support-service');

router.use(requireAuth);

/**
 * POST /api/feedback  { text, context }
 * context: phone and system, Telegram version, screen, last error codes — attached by the app
 * automatically (see js/screens/chats.js), so the team does not have to ask.
 */
router.post('/', async (req, res, next) => {
  try {
    const text = String(req.body?.text || '').trim().slice(0, 2000);
    if (!text) return res.status(400).json({ error: 'bad_request', message: 'Напишите, что случилось или что предлагаете' });
    const id = `fb_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const context = supportService.sanitizeContext(req.body?.context);
    await db.run(
      'INSERT INTO feedback (id, user_id, text, context) VALUES (?, ?, ?, ?)',
      [id, req.user.userId, text, context ? JSON.stringify(context) : null]
    );
    await supportService.notifyStaffAboutFeedback(id);
    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/feedback/mine — my complaints with the team's answers (the "Поддержка" chat)
 */
router.get('/mine', async (req, res, next) => {
  try {
    const rows = await db.all(
      'SELECT id, text, status, created_at, reply, replied_at FROM feedback WHERE user_id = ? ORDER BY created_at ASC, id ASC LIMIT 100',
      [req.user.userId]
    );
    res.json({
      feedback: rows.map(r => ({
        id: r.id,
        text: r.text,
        status: r.status,
        createdAt: r.created_at,
        reply: r.reply || null,
        repliedAt: r.replied_at || null
      }))
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
