// server/routes/people.js - People: search and conversations between people inside SmartFlow.
// Identity always comes from the Telegram login, never from the request body.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const peopleService = require('../services/people-service');
const { readDmFileBody } = require('../middleware/image-upload');

router.use(requireAuth);

function sendError(res, err, next) {
  if (err instanceof peopleService.PeopleError) {
    return res.status(err.status).json({ error: 'bad_request', code: err.code, message: err.message });
  }
  next(err);
}

/**
 * GET /api/people/search?q=анна — people by name, @username or the line under the name
 */
router.get('/search', async (req, res, next) => {
  try {
    res.json({ people: await peopleService.search(req.user.userId, req.query.q) });
  } catch (err) {
    sendError(res, err, next);
  }
});

/**
 * PUT /api/people/visibility  { hidden: true } — hide me from search (or show again)
 */
router.put('/visibility', async (req, res, next) => {
  try {
    const hidden = Boolean(req.body?.hidden);
    await peopleService.setHidden(req.user.userId, hidden);
    res.json({ hidden });
  } catch (err) {
    sendError(res, err, next);
  }
});

/**
 * GET /api/people/chats — my conversations with people
 */
router.get('/chats', async (req, res, next) => {
  try {
    res.json({ chats: await peopleService.myThreads(req.user.userId) });
  } catch (err) {
    sendError(res, err, next);
  }
});

/**
 * GET /api/people/:userId/messages — the conversation with this person (marks it read)
 */
router.get('/:userId/messages', async (req, res, next) => {
  try {
    res.json(await peopleService.conversation(req.user.userId, req.params.userId));
  } catch (err) {
    sendError(res, err, next);
  }
});

/**
 * POST /api/people/:userId/messages  { text }
 */
router.post('/:userId/messages', async (req, res, next) => {
  try {
    res.status(201).json(await peopleService.send(req.user.userId, req.params.userId, req.body?.text));
  } catch (err) {
    sendError(res, err, next);
  }
});

/**
 * POST /api/people/:userId/files?kind=voice|photo|video&seconds=18  (body: the file itself)
 * Voice up to 1.5 minutes, a photo, a round video up to 30 seconds
 */
router.post('/:userId/files', readDmFileBody, async (req, res, next) => {
  try {
    const file = { kind: String(req.query.kind || ''), buffer: req.body, seconds: req.query.seconds };
    res.status(201).json(await peopleService.send(req.user.userId, req.params.userId, null, file));
  } catch (err) {
    sendError(res, err, next);
  }
});

/**
 * GET /api/people/:userId/files/:fileId — a file of my conversation with this person
 */
router.get('/:userId/files/:fileId', async (req, res, next) => {
  try {
    const file = await peopleService.fileOf(req.user.userId, req.params.userId, req.params.fileId);
    if (!file) return res.status(404).json({ error: 'not_found', message: 'Файл не найден' });
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.send(file.buffer);
  } catch (err) {
    sendError(res, err, next);
  }
});

/**
 * POST /api/people/:userId/answer  { action: 'accept' | 'block' | 'unblock' }
 */
router.post('/:userId/answer', async (req, res, next) => {
  try {
    res.json(await peopleService.answer(req.user.userId, req.params.userId, String(req.body?.action || '')));
  } catch (err) {
    sendError(res, err, next);
  }
});

/**
 * POST /api/people/:userId/report  { reason } — the complaint goes to the support team
 */
router.post('/:userId/report', async (req, res, next) => {
  try {
    res.json(await peopleService.report(req.user.userId, req.params.userId, req.body?.reason));
  } catch (err) {
    sendError(res, err, next);
  }
});

module.exports = router;
