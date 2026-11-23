// server/services/push-service.js - Уведомления на телефон и компьютер из браузера (Web Push; вход через браузер,
// часть 2; решения владелицы 23 нояб.). Работает, когда SmartFlow открыт в браузере или установлен на экран:
// человек разрешает уведомления → браузер выдаёт адрес устройства → сервер шлёт туда коротко «что случилось»,
// нажатие открывает нужный экран (тот же параметр, что у кнопки в Telegram: /?startapp=…).
// Ключи VAPID — только в Railway (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY); без них канал молчит.
// iPhone и iPad: уведомления только у SmartFlow, установленного на экран «Домой» (iOS 16.4+).
const crypto = require('crypto');
const webpush = require('web-push');
const config = require('../config');
const db = require('../db');

const MAX_DEVICES = 10; // per person: older devices go when a new one comes
const MAX_FAILURES = 5; // in a row — the device is forgotten
const testOutbox = [];

function isConfigured() {
  return Boolean(config.vapidPublicKey && config.vapidPrivateKey);
}

let vapidSet = false;
function ensureVapid() {
  if (vapidSet || !isConfigured()) return isConfigured();
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
  vapidSet = true;
  return true;
}

class PushError extends Error {
  constructor(message, status = 400, code = 'PUSH') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const deviceOf = (ua) => {
  const s = String(ua || '');
  const os = /iphone|ipad|ipod/i.test(s) ? 'iOS' : /android/i.test(s) ? 'Android' : /mac os/i.test(s) ? 'Mac' : /windows/i.test(s) ? 'Windows' : /linux/i.test(s) ? 'Linux' : 'Другое';
  const browser = /edg\//i.test(s) ? 'Edge' : /firefox/i.test(s) ? 'Firefox' : /chrome|crios/i.test(s) ? 'Chrome' : /safari/i.test(s) ? 'Safari' : '';
  return `${os}${browser ? ` · ${browser}` : ''}`;
};

/** Saves this device for the person (the same device again — just refreshed). */
async function subscribe(userId, sub = {}, userAgent = '') {
  const endpoint = String(sub.endpoint || '');
  const p256dh = String((sub.keys && sub.keys.p256dh) || '');
  const auth = String((sub.keys && sub.keys.auth) || '');
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) {
    throw new PushError('Браузер не дал адрес для уведомлений — попробуйте ещё раз', 400, 'BAD_SUBSCRIPTION');
  }
  const device = deviceOf(userAgent);
  const existing = await db.get('SELECT id FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
  if (existing) {
    // The same device: it may now belong to another person who signed in on it
    await db.run('UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth = ?, device = ?, failures = 0 WHERE id = ?', [userId, p256dh, auth, device, existing.id]);
  } else {
    await db.run(
      'INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, device) VALUES (?, ?, ?, ?, ?, ?)',
      [`psh_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`, userId, endpoint, p256dh, auth, device]
    );
    const extra = await db.all('SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC, id DESC', [userId]);
    for (const row of extra.slice(MAX_DEVICES)) await db.run('DELETE FROM push_subscriptions WHERE id = ?', [row.id]);
  }
  return { device };
}

/** This device turned off (or the person signed out on it). */
async function unsubscribe(userId, endpoint) {
  const res = await db.run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', [userId, String(endpoint || '')]);
  return { removed: res.changes || 0 };
}

async function devicesOf(userId) {
  return db.all('SELECT id, device, created_at, last_ok_at FROM push_subscriptions WHERE user_id = ? AND failures < ? ORDER BY created_at DESC', [userId, MAX_FAILURES]);
}

const appUrl = (startParam) => `${config.webAppUrl}/${startParam ? `?startapp=${encodeURIComponent(startParam)}` : ''}`;

/**
 * The delivery channel for notify-service: to every device of the person. Returns true if at least one got it.
 * Never throws.
 */
async function sendPush(userId, { text, startParam } = {}) {
  try {
    if (!userId) return false;
    const subs = await db.all('SELECT * FROM push_subscriptions WHERE user_id = ? AND failures < ?', [userId, MAX_FAILURES]);
    if (!subs.length) return false;
    const body = String(text || '');
    // The red number on the app icon (installed SmartFlow): how much is unread now
    const badge = await require('./badge-service').count(userId).catch(() => null);
    const payload = JSON.stringify({
      title: 'SmartFlow',
      body: body.length > 240 ? `${body.slice(0, 239)}…` : body,
      // Relative: the device opens it on the address it was installed from (app.… or the reserve one)
      url: `/${startParam ? `?startapp=${encodeURIComponent(startParam)}` : ''}`,
      tag: startParam || 'smartflow',
      badge
    });
    if (config.isTest) {
      for (const s of subs) testOutbox.push({ userId, endpoint: s.endpoint, payload: JSON.parse(payload) });
      return true;
    }
    if (!ensureVapid()) return false;
    let delivered = false;
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 24 * 3600, timeout: 10000 });
        delivered = true;
        await db.run('UPDATE push_subscriptions SET failures = 0, last_ok_at = CURRENT_TIMESTAMP WHERE id = ?', [s.id]);
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          // The browser forgot this device (notifications turned off, app removed)
          await db.run('DELETE FROM push_subscriptions WHERE id = ?', [s.id]);
        } else {
          await db.run('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?', [s.id]);
          console.warn(`[SmartFlow Push] not delivered (${err.statusCode || err.message})`);
        }
      }
    }
    return delivered;
  } catch (err) {
    console.warn('[SmartFlow Push] failed:', err.message);
    return false;
  }
}

/** A new key pair for the owner to put into Railway (not saved anywhere). */
function newKeys() {
  return webpush.generateVAPIDKeys();
}

module.exports = { PushError, isConfigured, subscribe, unsubscribe, devicesOf, sendPush, newKeys, appUrl, deviceOf, testOutbox, MAX_FAILURES };
