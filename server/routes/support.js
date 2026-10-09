// server/routes/support.js - Errors that happened inside the app on the person's phone.
// The app shows "Ошибка, код K7P2" and sends the same code here, so the team finds it by code.
const express = require('express');
const router = express.Router();
const { optionalAuth } = require('../middleware/auth');
const supportService = require('../services/support-service');

// Max reports per address per 10 minutes: a broken screen re-rendering must not flood the log
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 30;
const hits = new Map();

function tooMany(key) {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now - entry.start > WINDOW_MS) {
    hits.set(key, { start: now, count: 1 });
    if (hits.size > 5000) hits.clear();
    return false;
  }
  entry.count++;
  return entry.count > MAX_PER_WINDOW;
}

/**
 * POST /api/support/errors  { code, message, route, context }
 */
router.post('/errors', optionalAuth, async (req, res, next) => {
  try {
    const userId = req.user ? req.user.userId : null;
    if (tooMany(userId || req.ip || 'anon')) return res.status(429).json({ error: 'too_many', message: 'Слишком много сообщений об ошибках' });
    const code = supportService.normalizeErrorCode(req.body?.code) || supportService.newErrorCode();
    const context = supportService.sanitizeContext(req.body?.context);
    await supportService.logError({
      code,
      source: 'client',
      userId,
      path: String(req.body?.route || '').slice(0, 200) || null,
      message: String(req.body?.message || '').slice(0, 1000),
      context
    });
    res.status(201).json({ code });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
