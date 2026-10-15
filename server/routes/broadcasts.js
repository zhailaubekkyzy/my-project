// server/routes/broadcasts.js - Broadcasts of an SI-seller (Офис → SI-продавец → «Рассылки»).
// The owner prepares and sends; the assistant prepares, the owner approves (owner's decision).
const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireAuth } = require('../middleware/auth');
const { requireProjectPermission } = require('../middleware/permissions');
const broadcastService = require('../services/broadcast-service');

router.use(requireAuth);

const memberOf = (req) => ({ userId: req.user.userId, role: req.projectRole === 'assistant' ? 'assistant' : 'owner' });
const ownerOnly = (req, res) => {
  if (req.projectRole === 'assistant') {
    res.status(403).json({ error: 'forbidden', code: 'OWNER_ONLY', message: 'Отправить рассылку может только владелец — он получит её на одобрение.' });
    return false;
  }
  return true;
};

function sendError(res, err, next) {
  if (err instanceof broadcastService.BroadcastError) {
    return res.status(err.status).json({ error: 'bad_request', code: err.code, message: err.message });
  }
  next(err);
}

/**
 * GET /api/projects/:projectId/broadcasts — the last 30 broadcasts and the limits
 */
router.get('/', requireProjectPermission('conversations:read'), async (req, res, next) => {
  try {
    res.json({
      broadcasts: await broadcastService.listOf(req.project.id),
      limits: { perDay: broadcastService.PER_DAY, perWeek: broadcastService.PER_WEEK, hours: [broadcastService.DAY_START, broadcastService.DAY_END] }
    });
  } catch (err) {
    sendError(res, err, next);
  }
});

/**
 * POST /api/projects/:projectId/broadcasts/plan  { request } — SI turns "кому и что — словами" into
 * an audience and a draft text. { plan: null } without OpenAI: the form is filled by hand.
 */
router.post('/plan', requireProjectPermission('conversations:write'), async (req, res, next) => {
  try {
    const plan = await broadcastService.planFromWords(req.project, req.body?.request);
    if (!plan) return res.json({ plan: null });
    const pre = await broadcastService.preview(req.project, plan.audience);
    res.json({ plan: { ...plan, count: pre.count, sample: pre.sample } });
  } catch (err) {
    sendError(res, err, next);
  }
});

/**
 * POST /api/projects/:projectId/broadcasts/preview  { audience } — how many would get it
 */
router.post('/preview', requireProjectPermission('conversations:write'), async (req, res, next) => {
  try {
    res.json(await broadcastService.preview(req.project, req.body?.audience));
  } catch (err) {
    sendError(res, err, next);
  }
});

/**
 * POST /api/projects/:projectId/broadcasts  { request, audience, text, send }
 * The owner: a draft, or sends at once (send: true). The assistant: goes to the owner for approval.
 */
router.post('/', requireProjectPermission('conversations:write'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const broadcast = await broadcastService.create(req.project, memberOf(req), {
      request: b.request, audience: b.audience, text: b.text, send: Boolean(b.send) && req.projectRole !== 'assistant'
    });
    res.status(201).json({ broadcast });
  } catch (err) {
    sendError(res, err, next);
  }
});

/**
 * POST /api/projects/:projectId/broadcasts/:id/approve  { text? } — the owner sends (approves) it
 */
router.post('/:broadcastId/approve', requireProjectPermission('conversations:write'), async (req, res, next) => {
  try {
    if (!ownerOnly(req, res)) return;
    res.json({ broadcast: await broadcastService.approve(req.project, req.params.broadcastId, req.user.userId, { text: req.body?.text }) });
  } catch (err) {
    sendError(res, err, next);
  }
});

/**
 * POST /api/projects/:projectId/broadcasts/:id/cancel — cancel a draft or stop sending
 */
router.post('/:broadcastId/cancel', requireProjectPermission('conversations:write'), async (req, res, next) => {
  try {
    res.json({ broadcast: await broadcastService.cancel(req.project, req.params.broadcastId, memberOf(req)) });
  } catch (err) {
    sendError(res, err, next);
  }
});

module.exports = router;
