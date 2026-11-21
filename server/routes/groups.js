// server/routes/groups.js - Group conversations in «Чаты» (server/services/group-service.js).
// Identity always comes from the Telegram login, never from the request body.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const groupService = require('../services/group-service');
const mediaService = require('../services/media-service');
const { readDmFileBody, readImageBody } = require('../middleware/image-upload');

router.use(requireAuth);

function sendError(res, err, next) {
  if (err instanceof groupService.GroupError || err instanceof mediaService.MediaError) {
    return res.status(err.status).json({ error: 'bad_request', code: err.code, message: err.message });
  }
  next(err);
}

// Wraps a handler: JSON answer, known errors as 4xx
const handle = (fn, status = 200) => async (req, res, next) => {
  try {
    res.status(status).json(await fn(req));
  } catch (err) {
    sendError(res, err, next);
  }
};
const me = (req) => req.user.userId;
const body = (req) => req.body || {};

/** GET /api/groups — my groups and invitations */
router.get('/', handle(async (req) => ({ groups: await groupService.myGroups(me(req)) })));

/** POST /api/groups  { name, memberIds: [] } — a new group; the chosen people get invitations */
router.post('/', handle((req) => groupService.create(me(req), body(req)), 201));

/** GET /api/groups/join/:code — what the invitation link shows; POST — join by it */
router.get('/join/:code', handle((req) => groupService.preview(me(req), req.params.code)));
router.post('/join/:code', handle((req) => groupService.joinByCode(me(req), req.params.code)));

/** GET /api/groups/:id — the group: messages, members, the pinned message (marks it read) */
router.get('/:id', handle((req) => groupService.conversation(me(req), req.params.id)));

/** POST /api/groups/:id/messages  { text, replyTo, mentionIds: [] } */
router.post('/:id/messages', handle((req) => groupService.send(me(req), req.params.id, body(req).text, null, body(req).replyTo, body(req).mentionIds), 201));

/** POST /api/groups/:id/files?kind=voice|photo|video&seconds=18&replyTo=…  (body: the file itself) */
router.post('/:id/files', readDmFileBody, handle((req) => groupService.send(
  me(req), req.params.id, null,
  { kind: String(req.query.kind || ''), buffer: req.body, seconds: req.query.seconds },
  req.query.replyTo || null
), 201));

/** GET /api/groups/:id/files/:fileId — a file of the group (active members only) */
router.get('/:id/files/:fileId', async (req, res, next) => {
  try {
    const file = await groupService.fileOf(me(req), req.params.id, req.params.fileId);
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

/** POST /api/groups/:id/answer  { accept: true | false } — «Вступить» / «Отказаться» */
router.post('/:id/answer', handle((req) => groupService.answerInvite(me(req), req.params.id, body(req).accept === true)));

/** POST /api/groups/:id/invite  { userIds: [] } — the owner or an admin */
router.post('/:id/invite', handle((req) => groupService.invite(me(req), req.params.id, body(req).userIds)));

/** POST /api/groups/:id/messages/:messageId/react  { emoji } — the same emoji again takes it back */
router.post('/:id/messages/:messageId/react', handle((req) => groupService.react(me(req), req.params.id, req.params.messageId, String(body(req).emoji || ''))));

/** DELETE /api/groups/:id/messages/:messageId — its author, the owner or an admin */
router.delete('/:id/messages/:messageId', handle((req) => groupService.removeMessage(me(req), req.params.id, req.params.messageId)));

/** PUT /api/groups/:id/pin  { messageId | null } */
router.put('/:id/pin', handle((req) => groupService.pin(me(req), req.params.id, body(req).messageId || null)));

/** PUT /api/groups/:id  { name } — rename (the owner or an admin) */
router.put('/:id', handle((req) => groupService.rename(me(req), req.params.id, body(req).name)));

/** POST /api/groups/:id/photo  (body: JPEG/PNG/WebP up to 2 MB) */
router.post('/:id/photo', readImageBody, handle((req) => groupService.setPhoto(me(req), req.params.id, req.body), 201));

/** PUT /api/groups/:id/mute  { muted } — «Без звука» */
router.put('/:id/mute', handle((req) => groupService.setMuted(me(req), req.params.id, Boolean(body(req).muted))));

/** PUT /api/groups/:id/members/:userId  { role: 'admin' | 'member' } — the owner only */
router.put('/:id/members/:userId', handle((req) => groupService.setRole(me(req), req.params.id, req.params.userId, String(body(req).role || ''))));

/** DELETE /api/groups/:id/members/:userId — remove a person (or cancel an invitation) */
router.delete('/:id/members/:userId', handle((req) => groupService.removeMember(me(req), req.params.id, req.params.userId)));

/** POST /api/groups/:id/leave */
router.post('/:id/leave', handle((req) => groupService.leave(me(req), req.params.id)));

/** POST /api/groups/:id/report  { messageId, reason } — the complaint goes to the support team */
router.post('/:id/report', handle((req) => groupService.report(me(req), req.params.id, body(req).messageId || null, body(req).reason)));

/** POST /api/groups/:id/summary — «Кратко» by SI: what I missed since where I stopped */
router.post('/:id/summary', handle((req) => groupService.summary(me(req), req.params.id)));

module.exports = router;
