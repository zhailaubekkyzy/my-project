// server/routes/feedback.js - Complaints and suggestions sent to the SI-assistant.
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

/**
 * POST /api/feedback  { text }
 */
router.post('/', async (req, res, next) => {
  try {
    const text = String(req.body?.text || '').trim().slice(0, 2000);
    if (!text) return res.status(400).json({ error: 'bad_request', message: 'Напишите, что случилось или что предлагаете' });
    const id = `fb_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await db.run('INSERT INTO feedback (id, user_id, text) VALUES (?, ?, ?)', [id, req.user.userId, text]);
    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
