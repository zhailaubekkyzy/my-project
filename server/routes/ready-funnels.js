// server/routes/ready-funnels.js - Ready-made funnels from marketers, part 1 (migration 026):
// a marketer publishes a funnel from their own SI-seller, the team approves it, experts see the
// catalogue in the Office. Behind the flag `funnels` (FEATURES in Railway). The team's side is in
// routes/admin.js (/api/admin/funnels). Clients never see funnels.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const appInfo = require('../services/app-info');
const analytics = require('../services/analytics-service');
const telegramBot = require('../services/telegram-bot');
const funnels = require('../services/ready-funnel-service');
const purchases = require('../services/funnel-purchase-service');
const db = require('../db');

router.use(requireAuth);

// Off for this person → as if the feature does not exist yet
router.use(async (req, res, next) => {
  try {
    if (await appInfo.isOn('funnels', req.user.userId)) return next();
    res.status(404).json({ error: 'not_found', code: 'FEATURE_OFF', message: 'Шаблоны пока недоступны' });
  } catch (err) {
    next(err);
  }
});

function handle(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof funnels.FunnelError || err instanceof purchases.PurchaseError) return res.status(err.status).json({ error: err.code, message: err.message });
      next(err);
    }
  };
}

/** GET /api/ready-funnels?q=&niche= — the catalogue: published funnels */
router.get('/', handle(async (req, res) => {
  const result = await funnels.catalogue({ q: req.query.q, niche: req.query.niche });
  const results = await purchases.resultsFor(result.funnels.map(f => f.id));
  for (const f of result.funnels) f.results = results[f.id] || null;
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

// ---------------------------------------------------------------
// Part 2: buying, the marketer's confirmation, connecting to an SI-seller (migration 027)
// ---------------------------------------------------------------
async function nameOfUser(userId) {
  return purchases.nameOf(await db.get('SELECT display_name, profile FROM users WHERE id = ?', [userId])) || 'Эксперт';
}

function notify(userId, text, startParam) {
  telegramBot.notifyUser(userId, text, { buttonText: 'Открыть', startParam })
    .catch(err => console.warn('[SmartFlow Funnels] not notified:', err.message));
}

/** GET /api/ready-funnels/purchases — what I bought and who bought mine */
router.get('/purchases', handle(async (req, res) => {
  res.json({
    bought: await purchases.listForExpert(req.user.userId),
    sales: await purchases.listForMarketer(req.user.userId),
    waiting: await purchases.waitingForMarketer(req.user.userId)
  });
}));

/** POST /api/ready-funnels/purchases/:pid/decision { decision: confirm|decline, reason } — the marketer */
router.post('/purchases/:pid/decision', handle(async (req, res) => {
  const decision = String((req.body || {}).decision || '');
  const { row, renewal } = await purchases.decide(req.user.userId, req.params.pid, decision, (req.body || {}).reason);
  analytics.capture('ready_funnel_purchase_decided', req.user.userId, { funnel_id: row.funnel_id, price_type: row.price_type, decision, renewal });
  const marketer = await nameOfUser(req.user.userId);
  const title = `«${row.funnel_title}»`;
  let text;
  if (decision === 'confirm') {
    text = renewal
      ? `✅ ${marketer} подтвердил(а) оплату следующего месяца шаблона ${title}. Шаблон работает дальше.`
      : row.price_type === 'percent'
        ? `✅ ${marketer} согласен(на) подключить шаблон ${title} на условиях «${row.price_label}». Запустите SI-продавца: Маркетплейс → «Шаблоны ИИ-продавцов» → «Купленные».`
        : `✅ ${marketer} подтвердил(а) оплату шаблона ${title}. Запустите SI-продавца: Маркетплейс → «Шаблоны ИИ-продавцов» → «Купленные».`;
  } else {
    text = `${marketer} пока не подтвердил(а) ${renewal ? 'оплату следующего месяца' : 'оплату'} шаблона ${title}.\n\nПричина: ${row.reason}\n\nНапишите автору в SmartFlow, чтобы разобраться.`;
  }
  notify(row.expert_id, text, `F_${row.funnel_id}`);
  res.json({ purchase: await purchases.toPurchase(row, 'marketer') });
}));

/** POST /api/ready-funnels/purchases/:pid/end { reason } — the marketer stops a percentage */
router.post('/purchases/:pid/end', handle(async (req, res) => {
  const row = await purchases.endPercent(req.user.userId, req.params.pid, (req.body || {}).reason);
  analytics.capture('ready_funnel_percent_ended', req.user.userId, { funnel_id: row.funnel_id });
  notify(row.expert_id, `${await nameOfUser(req.user.userId)} отключил(а) шаблон «${row.funnel_title}».\n\nПричина: ${row.reason}\n\nВаш SI-продавец снова работает по вашей методологии.`, `F_${row.funnel_id}`);
  res.json({ purchase: await purchases.toPurchase(row, 'marketer') });
}));

/** POST /api/ready-funnels/purchases/:pid/apply { projectId, materials: { stepId: text } } — the expert */
router.post('/purchases/:pid/apply', handle(async (req, res) => {
  const body = req.body || {};
  const brainAccess = body.brainAccess === undefined ? undefined : Boolean(body.brainAccess);
  const { row, first, moved, released, puzzle } = await purchases.apply(req.user.userId, req.params.pid, body.projectId, body.materials, brainAccess);
  if (first || moved) analytics.capture('ready_funnel_applied', req.user.userId, { funnel_id: row.funnel_id, price_type: row.price_type, project_id: row.project_id, moved, puzzle, released, brain_access: brainAccess !== false });
  res.json({ purchase: await purchases.toPurchase(row, 'expert'), released, puzzle });
}));

/**
 * POST /api/ready-funnels/purchases/:pid/launch { businessId, productId, name, materials, brainAccess } — the expert:
 * the bought template becomes a new AI-продавец (owner's decision 22 Nov.)
 */
router.post('/purchases/:pid/launch', handle(async (req, res) => {
  const body = req.body || {};
  const brainAccess = body.brainAccess === undefined ? undefined : Boolean(body.brainAccess);
  const { row, released, puzzle, projectId } = await purchases.launch(req.user.userId, req.params.pid, {
    businessId: body.businessId, productId: body.productId, name: body.name, materials: body.materials, brainAccess
  });
  analytics.capture('si_seller_created', req.user.userId);
  analytics.capture('ready_funnel_applied', req.user.userId, { funnel_id: row.funnel_id, price_type: row.price_type, project_id: projectId, moved: false, puzzle, released, brain_access: brainAccess !== false, launched: true });
  res.status(201).json({ purchase: await purchases.toPurchase(row, 'expert'), released, puzzle, projectId });
}));

/** POST /api/ready-funnels/purchases/:pid/detach — the expert switches the funnel off */
router.post('/purchases/:pid/detach', handle(async (req, res) => {
  const row = await purchases.detach(req.user.userId, req.params.pid);
  analytics.capture('ready_funnel_detached', req.user.userId, { funnel_id: row.funnel_id });
  res.json({ purchase: await purchases.toPurchase(row, 'expert') });
}));

/**
 * POST /api/ready-funnels/:id/buy { note } — the expert paid by the author's link (or asks to connect
 * on a percentage); a monthly one that is already active — the next month. The author confirms.
 */
router.post('/:id/buy', handle(async (req, res) => {
  const { row, renewal } = await purchases.requestPurchase(req.user.userId, req.params.id, (req.body || {}).note);
  analytics.capture('ready_funnel_purchase_requested', req.user.userId, { funnel_id: row.funnel_id, price_type: row.price_type, renewal });
  const expert = await nameOfUser(req.user.userId);
  const what = row.price_type === 'percent'
    ? `хочет подключить ваш шаблон «${row.funnel_title}» на условиях «${row.price_label}»`
    : `оплатил(а) ${renewal ? 'следующий месяц шаблона' : 'шаблон'} «${row.funnel_title}» (${row.price_label})`;
  const note = renewal ? row.renewal_note : row.note;
  notify(row.marketer_id, `💳 ${expert} ${what}.${note ? `\n\nКомментарий: ${note}` : ''}\n\n${row.price_type === 'percent' ? 'Согласитесь или откажите' : 'Проверьте поступление и подтвердите'}: Маркетплейс → «Шаблоны ИИ-продавцов» → «Мои шаблоны».`, 'FSALES');
  res.status(201).json({ purchase: await purchases.toPurchase(row, 'expert') });
}));

/** GET /api/ready-funnels/:id — one funnel (published, or the author's own) */
router.get('/:id', handle(async (req, res) => {
  let funnel = await funnels.getForUser(req.user.userId, req.params.id);
  if (!funnel && await purchases.mineFor(req.user.userId, req.params.id)) funnel = await funnels.getBought(req.params.id);
  if (!funnel) return res.status(404).json({ error: 'not_found', message: 'Шаблон не найден или снят с публикации' });
  funnel.myPurchase = await purchases.mineFor(req.user.userId, funnel.id);
  funnel.results = (await purchases.resultsFor([funnel.id]))[funnel.id] || null;
  if (funnel.author.id !== req.user.userId) {
    analytics.capture('ready_funnel_viewed', req.user.userId, { funnel_id: funnel.id, price_type: funnel.priceType, steps: funnel.steps.length });
  }
  res.json({ funnel });
}));

/**
 * POST /api/ready-funnels — publish a template from one's own SI-seller: at once, without the team's review
 * { projectId, title, niche, description, result, priceType: once|monthly|percent, priceLabel, paymentUrl,
 *   sellerProjectId (who sells it; '' — nobody; default — the same seller), videoUrl }
 */
router.post('/', handle(async (req, res) => {
  const row = await funnels.submit(req.user.userId, req.body || {});
  const funnel = funnels.toFunnel(row, 'author');
  analytics.capture('ready_funnel_submitted', req.user.userId, {
    funnel_id: funnel.id, price_type: funnel.priceType, steps: funnel.steps.length, scenarios: funnel.scenarioCount, resubmitted: false
  });
  res.status(201).json({ funnel });
}));

/** PUT /api/ready-funnels/:id — change it: published at once (one hidden by the team stays hidden) */
router.put('/:id', handle(async (req, res) => {
  const row = await funnels.update(req.user.userId, req.params.id, req.body || {});
  const funnel = funnels.toFunnel(row, 'author');
  analytics.capture('ready_funnel_submitted', req.user.userId, {
    funnel_id: funnel.id, price_type: funnel.priceType, steps: funnel.steps.length, scenarios: funnel.scenarioCount, resubmitted: true
  });
  res.json({ funnel });
}));

/** DELETE /api/ready-funnels/:id — the author removes it from the catalogue */
router.delete('/:id', handle(async (req, res) => {
  await funnels.withdraw(req.user.userId, req.params.id);
  analytics.capture('ready_funnel_withdrawn', req.user.userId, { funnel_id: req.params.id });
  res.json({ ok: true });
}));

/** POST /api/ready-funnels/:id/report { reason } — a complaint goes to the team (it may hide the template) */
router.post('/:id/report', handle(async (req, res) => {
  await funnels.report(req.user.userId, req.params.id, (req.body || {}).reason);
  analytics.capture('ready_funnel_reported', req.user.userId, { funnel_id: req.params.id });
  res.json({ reported: true });
}));

module.exports = router;
