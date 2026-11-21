// server/routes/communities.js - Communities in «Комьюнити» (server/services/community-service.js).
// Identity always comes from the Telegram login, never from the request body.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const communityService = require('../services/community-service');
const mediaService = require('../services/media-service');
const { readImageBody, readDmFileBody } = require('../middleware/image-upload');

router.use(requireAuth);

const handle = (fn, status = 200) => async (req, res, next) => {
  try {
    res.status(status).json(await fn(req));
  } catch (err) {
    if (err instanceof communityService.CommunityError || err instanceof mediaService.MediaError) {
      return res.status(err.status).json({ error: 'bad_request', code: err.code, message: err.message });
    }
    next(err);
  }
};
const me = (req) => req.user.userId;
const body = (req) => req.body || {};

/** GET /api/communities?q= — the catalog; GET /api/communities/mine — where I am */
router.get('/', handle(async (req) => ({ communities: await communityService.catalog(me(req), req.query.q) })));
router.get('/mine', handle(async (req) => ({ communities: await communityService.mine(me(req)) })));

/** POST /api/communities — a new community (business profile only) */
router.post('/', handle((req) => communityService.create(me(req), body(req)), 201));

/** Posts and comments by their own id (links KP_<postId>) */
router.get('/posts/:postId', handle((req) => communityService.post(me(req), req.params.postId)));
router.post('/posts/:postId/comments', handle((req) => communityService.comment(me(req), req.params.postId, body(req)), 201));
router.put('/posts/:postId/pin', handle((req) => communityService.pinPost(me(req), req.params.postId, Boolean(body(req).pinned))));
router.delete('/posts/:postId', handle((req) => communityService.deletePost(me(req), req.params.postId)));
router.delete('/comments/:commentId', handle((req) => communityService.deleteComment(me(req), req.params.commentId)));
/** POST /api/communities/like/:targetId — a post (cmp_…) or a comment (cmc_…); again — takes it back */
router.post('/like/:targetId', handle((req) => communityService.like(me(req), req.params.targetId)));

/** GET /api/communities/:id — «О сообществе» and what I may do; PUT — settings (the owner) */
router.get('/:id', handle((req) => communityService.view(me(req), req.params.id)));
router.put('/:id', handle((req) => communityService.update(me(req), req.params.id, body(req))));
router.post('/:id/cover', readImageBody, handle((req) => communityService.setCover(me(req), req.params.id, req.body), 201));

/** POST /api/communities/:id/join { answers, note } · /renew { note } · /leave */
router.post('/:id/join', handle((req) => communityService.join(me(req), req.params.id, body(req))));
router.post('/:id/renew', handle((req) => communityService.renew(me(req), req.params.id, body(req).note)));
router.post('/:id/leave', handle((req) => communityService.leave(me(req), req.params.id)));

/** The owner / moderators: requests and payments waiting; accept or decline */
router.get('/:id/waiting', handle((req) => communityService.waiting(me(req), req.params.id)));
router.post('/:id/waiting/:userId', handle((req) => communityService.decide(me(req), req.params.id, req.params.userId, body(req).accept === true, body(req).reason)));

/** Members; the owner names moderators; remove / ban */
router.get('/:id/members', handle((req) => communityService.members(me(req), req.params.id)));
router.put('/:id/members/:userId', handle((req) => communityService.setRole(me(req), req.params.id, req.params.userId, String(body(req).role || ''))));
router.delete('/:id/members/:userId', handle((req) => communityService.removeMember(me(req), req.params.id, req.params.userId, req.query.ban === '1')));

/** GET /api/communities/:id/feed?category=&before= ; POST — a post (JSON) */
router.get('/:id/feed', handle((req) => communityService.feed(me(req), req.params.id, { category: req.query.category || null, before: req.query.before || null })));
router.post('/:id/posts', handle((req) => communityService.createPost(me(req), req.params.id, body(req)), 201));
/** POST /api/communities/:id/posts/photo?text=…&category=…&announcement=1 (body: the photo) */
router.post('/:id/posts/photo', readDmFileBody, handle((req) => communityService.createPost(me(req), req.params.id, {
  text: req.query.text, category: req.query.category, announcement: req.query.announcement === '1',
  mentionIds: String(req.query.mentions || '').split(',').filter(Boolean)
}, req.body), 201));

/** GET /api/communities/:id/files/:fileId — a photo of a post (members only) */
router.get('/:id/files/:fileId', async (req, res, next) => {
  try {
    const file = await communityService.fileOf(me(req), req.params.id, req.params.fileId);
    if (!file) return res.status(404).json({ error: 'not_found', message: 'Файл не найден' });
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.send(file.buffer);
  } catch (err) {
    next(err);
  }
});

/** POST /api/communities/:id/report { postId, reason } */
router.post('/:id/report', handle((req) => communityService.report(me(req), req.params.id, body(req).postId || null, body(req).reason)));

module.exports = router;
