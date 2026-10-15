// server/routes/buddy.js - The conversation with Buddy (personal helper) and its notifications.
// Each person sees only their own messages; identity comes from the Telegram login.
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const buddyService = require('../services/buddy-service');
const voiceService = require('../services/voice-service');
const { readVoiceBody } = require('../middleware/image-upload');

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
 * POST /api/buddy/voice?seconds=12&tzOffset=300  (body: the recording, up to 1.5 minutes)
 * A voice message to Buddy: transcribed and answered like text. The recording itself is not kept.
 */
router.post('/voice', readVoiceBody, async (req, res, next) => {
  try {
    const buffer = req.body;
    if (!Buffer.isBuffer(buffer) || !buffer.length) return res.status(400).json({ error: 'bad_request', code: 'EMPTY_VOICE', message: 'Запись не получена. Попробуйте ещё раз.' });
    if (buffer.length > voiceService.MAX_BYTES) return res.status(413).json({ error: 'bad_request', code: 'VOICE_TOO_LARGE', message: 'Голосовое слишком длинное — до 1,5 минуты.' });
    const type = voiceService.detectAudioType(buffer);
    if (!type) return res.status(400).json({ error: 'bad_request', code: 'INVALID_VOICE', message: 'Не получилось прочитать запись. Попробуйте ещё раз.' });
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.userId]);
    // Within today's limit only: a transcription costs as much as a message
    const used = await buddyService.usage(user.id, user.tz_offset_minutes);
    if (used.used >= buddyService.DAILY_LIMIT) {
      return res.status(429).json({ error: 'bad_request', code: 'BUDDY_LIMIT', message: 'На сегодня сообщения Бадди закончились — продолжим завтра.' });
    }
    const text = await voiceService.transcribe(buffer, type);
    if (!text) return res.status(422).json({ error: 'bad_request', code: 'NOT_TRANSCRIBED', message: 'Не получилось разобрать голосовое — напишите, пожалуйста, текстом.' });
    const result = await buddyService.send(user, text, req.query.tzOffset, new Date(), { voice: true });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/buddy/calendar?from=ISO&to=ISO — my plans, reminders and meetings with experts (up to 62 days)
 */
router.get('/calendar', async (req, res, next) => {
  try {
    const from = new Date(String(req.query.from || ''));
    const to = new Date(String(req.query.to || ''));
    if (isNaN(from) || isNaN(to) || to <= from) return res.status(400).json({ error: 'bad_request', message: 'Неверный период' });
    res.json({ items: await buddyService.calendar(req.user.userId, from, to) });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/buddy/plans/:id — remove my plan or reminder from the calendar
 */
router.delete('/plans/:id', async (req, res, next) => {
  try {
    if (!(await buddyService.cancelPlan(req.user.userId, req.params.id))) {
      return res.status(404).json({ error: 'not_found', message: 'План не найден' });
    }
    res.json({ ok: true });
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
