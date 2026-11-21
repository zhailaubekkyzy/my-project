// server/routes/ready-funnels.js - Ready-made funnels from marketers, part 1 (migration 026):
// a marketer publishes a funnel from their own SI-seller, the team approves it, experts see the
// catalogue in the Office. Behind the flag `funnels` (FEATURES in Railway). The team's side is in
// routes/admin.js (/api/admin/funnels). Clients never see funnels.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const appInfo = require('../services/app-info');
const analytics = require('../services/analytics-service');
const supportService = require('../services/support-service');
const telegramBot = require('../services/telegram-bot');
const funnels = require('../services/ready-funnel-service');

router.use(requireAuth);

// Off for this person → as if the feature does not exist yet
router.use(async (req, res, next) => {
  try {
    if (await appInfo.isOn('funnels', req.user.userId)) return next();
    res.status(404).json({ error: 'not_found', code: 'FEATURE_OFF', message: 'Готовые воронки пока недоступны' });
  } catch (err) {
    next(err);
  }
});

function handle(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof funnels.FunnelError) return res.status(err.status).json({ error: err.code, message: err.message });
      next(err);
    }
  };
}

// The team learns there is something to review (a bot message to everyone in the team)
async function tellTeam(funnel, isUpdate) {
  try {
    const team = await supportService.staffUserIds();
    const text = `${isUpdate ? '✏️ Воронку изменили' : '🧩 Новая воронка'} на проверку: «${funnel.title}» (${funnel.niche}). Проверьте в панели поддержки → «Воронки».`;
    for (const userId of team) {
      await telegramBot.notifyUser(userId, text, { buttonText: 'Проверить', startParam: 'FREVIEW' });
    }
  } catch (err) {
    console.warn('[SmartFlow Funnels] team not notified:', err.message);
  }
}

/** GET /api/ready-funnels?q=&niche= — the catalogue: published funnels */
router.get('/', handle(async (req, res) => {
  const result = await funnels.catalogue({ q: req.query.q, niche: req.query.niche });
  analytics.capture('ready_funnel_catalog_opened', req.user.userId, {
    funnels: result.funnels.length,
    searched: Boolean(String(req.query.q || '').trim() || String(req.query.niche || '').trim())
  });
  res.json(result);
}));

/** GET /api/ready-funnels/mine — the author's own funnels with their status */
router.get('/mine', handle(async (req, res) => {
  res.json({ funnels: await funnels.listMine(req.user.userId), maxPerAuthor: funnels.MAX_PER_AUTHOR, minSteps: funnels.MIN_STEPS });
}));

/** GET /api/ready-funnels/:id — one funnel (published, or the author's own) */
router.get('/:id', handle(async (req, res) => {
  const funnel = await funnels.getForUser(req.user.userId, req.params.id);
  if (!funnel) return res.status(404).json({ error: 'not_found', message: 'Воронка не найдена или снята с публикации' });
  if (funnel.author.id !== req.user.userId) {
    analytics.capture('ready_funnel_viewed', req.user.userId, { funnel_id: funnel.id, price_type: funnel.priceType, steps: funnel.steps.length });
  }
  res.json({ funnel });
}));

/**
 * POST /api/ready-funnels — publish a funnel from one's own SI-seller (goes to the team first)
 * { projectId, title, niche, description, result, priceType: once|monthly|percent, priceLabel, paymentUrl }
 */
router.post('/', handle(async (req, res) => {
  const row = await funnels.submit(req.user.userId, req.body || {});
  const funnel = funnels.toFunnel(row, 'author');
  analytics.capture('ready_funnel_submitted', req.user.userId, {
    funnel_id: funnel.id, price_type: funnel.priceType, steps: funnel.steps.length, scenarios: funnel.scenarioCount, resubmitted: false
  });
  tellTeam(funnel, false);
  res.status(201).json({ funnel });
}));

/** PUT /api/ready-funnels/:id — change it: goes back to the team */
router.put('/:id', handle(async (req, res) => {
  const row = await funnels.update(req.user.userId, req.params.id, req.body || {});
  const funnel = funnels.toFunnel(row, 'author');
  analytics.capture('ready_funnel_submitted', req.user.userId, {
    funnel_id: funnel.id, price_type: funnel.priceType, steps: funnel.steps.length, scenarios: funnel.scenarioCount, resubmitted: true
  });
  tellTeam(funnel, true);
  res.json({ funnel });
}));

/** DELETE /api/ready-funnels/:id — the author removes it from the catalogue */
router.delete('/:id', handle(async (req, res) => {
  await funnels.withdraw(req.user.userId, req.params.id);
  analytics.capture('ready_funnel_withdrawn', req.user.userId, { funnel_id: req.params.id });
  res.json({ ok: true });
}));

module.exports = router;
