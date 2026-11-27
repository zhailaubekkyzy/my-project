// server/routes/payments.js - Оплаты через платформу (шаг 0: только приём вебхуков провайдера).
//
// POST /api/payments/webhooks/whop — Whop присылает события (оплачено, возврат, спор …).
// Тело читается «как есть» (express.raw): подпись проверяется по точным байтам,
// поэтому этот маршрут подключён в server/index.js ДО express.json().
const express = require('express');
const payments = require('../services/payments');

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

module.exports = router;
