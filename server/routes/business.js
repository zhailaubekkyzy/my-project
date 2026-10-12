// server/routes/business.js - My business: members (owner + one assistant) and funnel counts.
// Only the owner adds or removes the assistant. Rights are checked here, not by RLS.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const businessService = require('../services/business-service');
const funnelService = require('../services/funnel-service');

router.use(requireAuth);

function sendBusinessError(res, err, next) {
  if (err instanceof businessService.BusinessError) {
    return res.status(err.status).json({ error: 'bad_request', code: err.code, message: err.message });
  }
  next(err);
}

/**
 * GET /api/business
 * My business with its members, and the businesses where I am the assistant
 */
router.get('/', async (req, res, next) => {
  try {
    res.json(await businessService.overview(req.user.userId));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/business/assistants  { supportCode: "SF-48213" }
 * The owner invites an assistant by the number from the assistant's Profile
 */
router.post('/assistants', async (req, res, next) => {
  try {
    const members = await businessService.addAssistant(req.user.userId, req.body?.supportCode);
    res.status(201).json({ members });
  } catch (err) {
    sendBusinessError(res, err, next);
  }
});

/**
 * DELETE /api/business/assistants/:userId
 */
router.delete('/assistants/:userId', async (req, res, next) => {
  try {
    const members = await businessService.removeAssistant(req.user.userId, req.params.userId);
    res.json({ members });
  } catch (err) {
    sendBusinessError(res, err, next);
  }
});

/**
 * GET /api/business/funnel?businessId=&status=&offset=&days=&projectId=
 * Clients per funnel status (counted on request); with status — that list, 30 at a time.
 * Owner and assistant of the business. Without businessId — my own business.
 */
router.get('/funnel', async (req, res, next) => {
  try {
    const own = await businessService.businessOfOwner(req.user.userId);
    const businessId = String(req.query.businessId || (own && own.id) || '');
    if (!businessId || !(await businessService.roleIn(businessId, req.user.userId))) {
      return res.status(404).json({ error: 'not_found', message: 'Бизнес не найден' });
    }
    // days: 7 / 30 (clients active in that period), empty = all time; projectId: one SI-seller
    const filter = { days: req.query.days, projectId: req.query.projectId || null };
    const result = {
      businessId,
      statuses: funnelService.STATUSES,
      counts: await funnelService.counts(businessId, filter)
    };
    if (req.query.status) {
      result.clients = await funnelService.clientsInStatus(businessId, String(req.query.status), { ...filter, offset: req.query.offset });
      result.pageSize = funnelService.PAGE_SIZE;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
