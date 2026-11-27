// server/routes/payments.js - Оплаты через платформу.
//
// POST /api/payments/webhooks/whop — Whop присылает события (оплачено, возврат, спор …).
// Тело читается «как есть» (express.raw): подпись проверяется по точным байтам,
// поэтому этот роутер подключён в server/index.js ДО express.json() (JSON — только у своих маршрутов).
//
// «Подключить выплаты» (шаг 1), только после входа:
//   GET  /api/payments/payouts            — статус: not_connected / pending / ready / rejected (или available: false)
//   POST /api/payments/payouts/connect    — { email? } → { url } ссылка на проверку личности на странице Whop
//   POST /api/payments/payouts/dashboard  — { url } кабинет выплат на странице Whop
const express = require('express');
const payments = require('../services/payments');
const payouts = require('../services/payments/payouts');
const { PaymentProviderError } = require('../services/payments/provider');
const { requireAuth } = require('../middleware/auth');
const supportService = require('../services/support-service');

const router = express.Router();

router.post('/webhooks/:provider', express.raw({ type: '*/*', limit: '1mb' }), async (req, res, next) => {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const result = await payments.receiveWebhook(req.params.provider, rawBody, req.headers);
    res.status(result.status).json(result.body);
  } catch (err) {
    next(err);
  }
});

// Понятные ответы: наши отказы — как есть; Whop не ответил — по-человечески и с кодом для поддержки
async function sendPayoutsError(req, res, next, err) {
  if (err instanceof payouts.PayoutsError) {
    return res.status(err.status).json({ error: 'payouts', code: err.code, message: err.message });
  }
  if (err instanceof PaymentProviderError) {
    const errorCode = supportService.newErrorCode();
    await supportService.logError({
      code: errorCode, source: 'server', userId: req.user ? req.user.userId : null, method: req.method,
      path: req.originalUrl.split('?')[0], status: 502, message: err.message
    });
    console.warn(`[SmartFlow Payments] code=${errorCode} ${err.message}`);
    return res.status(502).json({ error: 'provider', code: 'PROVIDER_UNAVAILABLE', errorCode,
      message: 'Whop сейчас не отвечает. Попробуйте ещё раз через минуту.' });
  }
  next(err);
}

router.get('/payouts', requireAuth, async (req, res, next) => {
  try {
    res.json(await payouts.getStatus(req.user.userId));
  } catch (err) {
    sendPayoutsError(req, res, next, err);
  }
});

router.post('/payouts/connect', requireAuth, express.json(), async (req, res, next) => {
  try {
    res.json(await payouts.connect(req.user.userId, { email: req.body && req.body.email }));
  } catch (err) {
    sendPayoutsError(req, res, next, err);
  }
});

router.post('/payouts/dashboard', requireAuth, express.json(), async (req, res, next) => {
  try {
    res.json(await payouts.dashboard(req.user.userId));
  } catch (err) {
    sendPayoutsError(req, res, next, err);
  }
});

module.exports = router;
