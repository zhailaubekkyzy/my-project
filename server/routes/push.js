// server/routes/push.js - Уведомления на этом устройстве (Web Push) и «Важное на почту» (вход через браузер,
// часть 2; решения владелицы 23 нояб.). Всё — только для вошедшего человека и только про него самого.
const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const pushService = require('../services/push-service');
const mail = require('../services/mail-service');
const analytics = require('../services/analytics-service');

router.use(requireAuth);

const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof pushService.PushError) return res.status(err.status).json({ error: 'bad_request', code: err.code, message: err.message });
    next(err);
  }
};

/**
 * GET /api/push/status — { configured, publicKey, devices: [{ id, device }], email, emailNotify, mailConfigured }
 * The public key is not a secret: the browser needs it to subscribe.
 */
router.get('/status', handle(async (req, res) => {
  const user = await db.get('SELECT email, email_notify FROM users WHERE id = ?', [req.user.userId]);
  const devices = await pushService.devicesOf(req.user.userId);
  res.json({
    configured: pushService.isConfigured(),
    publicKey: config.vapidPublicKey || null,
    devices: devices.map(d => ({ id: d.id, device: d.device })),
    email: (user && user.email) || null,
    emailNotify: !user || Number(user.email_notify) !== 0,
    mailConfigured: mail.isConfigured()
  });
}));

/** POST /api/push/subscribe  { subscription: PushSubscription.toJSON() } */
router.post('/subscribe', handle(async (req, res) => {
  if (!pushService.isConfigured()) {
    return res.status(503).json({ error: 'unavailable', code: 'PUSH_NOT_CONFIGURED', message: 'Уведомления скоро заработают' });
  }
  const before = await db.get('SELECT id FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', [String((req.body?.subscription || {}).endpoint || ''), req.user.userId]);
  const out = await pushService.subscribe(req.user.userId, req.body?.subscription || {}, req.get('user-agent'));
  if (!before) analytics.capture('push_subscribed', req.user.userId, { device: out.device });
  res.json({ ok: true, device: out.device });
}));

/** POST /api/push/unsubscribe  { endpoint } — this device stops getting notifications (also on «Выйти») */
router.post('/unsubscribe', handle(async (req, res) => {
  res.json(await pushService.unsubscribe(req.user.userId, req.body?.endpoint));
}));

/** PUT /api/push/email  { on: boolean } — «Важное на почту» */
router.put('/email', handle(async (req, res) => {
  const on = req.body?.on !== false;
  await db.run('UPDATE users SET email_notify = ? WHERE id = ?', [on ? 1 : 0, req.user.userId]);
  res.json({ emailNotify: on });
}));

/** POST /api/push/test — a test notification to my devices (button «Проверить») */
router.post('/test', handle(async (req, res) => {
  const devices = (await pushService.devicesOf(req.user.userId)).length;
  const delivered = devices ? await pushService.sendPush(req.user.userId, { text: '🔔 Уведомления работают! Так будут приходить новые сообщения и напоминания.', startParam: '' }) : false;
  res.json({ delivered, devices });
}));

module.exports = router;
