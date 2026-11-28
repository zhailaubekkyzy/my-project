// server/services/payments/index.js - Модуль оплат SmartFlow (не привязан к провайдеру).
//
// Решения владелицы (27 нояб.): провайдер — Whop for Platforms, прямое списание на подаккаунт продавца
// с комиссией платформы; учёт — в наших таблицах (миграция 039); оплата — только на сайте
// app.techsmartflow.com (в Telegram — кнопка «Оплатить на сайте»); ручной режим (ссылка эксперта + чек +
// «Подтвердить оплату») остаётся запасным и работает всегда. Whop включается флагом `payments_whop`
// для конкретного продавца (FEATURES / BETA_USERS) и только если провайдер настроен.
// Подробно — docs/ARCHITECTURE.md, «Оплаты».
const crypto = require('crypto');
const db = require('../../db');
const appInfo = require('../app-info');
const { assertProvider } = require('./provider');

const FLAG = 'payments_whop';
const providers = new Map();
function registerProvider(adapter) {
  assertProvider(adapter);
  providers.set(adapter.name, adapter);
  return adapter;
}
registerProvider(require('./whop'));

function provider(name) {
  return providers.get(String(name || '').toLowerCase()) || null;
}

// Обработчики событий по нашему словарю (шаг 1 и дальше добавляют свои: 'payment.succeeded' → «Купили» …)
const handlers = new Map();
function onEvent(type, fn) {
  if (!handlers.has(type)) handlers.set(type, []);
  handlers.get(type).push(fn);
}

function status() {
  const whop = provider('whop');
  return { whop: whop.status(), flag: FLAG };
}

// Можно ли этому продавцу принимать оплату через платформу: провайдер настроен и флаг включён ему.
// Иначе — ручной режим, как раньше.
async function isEnabledForSeller(userId, providerName = 'whop') {
  const adapter = provider(providerName);
  if (!adapter || !adapter.isConfigured()) return false;
  return appInfo.isOn(FLAG, userId);
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

function sqlNow() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

/**
 * Принять вебхук провайдера. → { status, body } для ответа.
 * 503 — оплаты не настроены; 401 — нет или неверная подпись; 200 — принят (повтор — тоже 200, без второй обработки);
 * 500 — обработчик упал: событие помечено failed, провайдер пришлёт его снова и мы обработаем заново.
 */
async function receiveWebhook(providerName, rawBody, headers) {
  const adapter = provider(providerName);
  if (!adapter) return { status: 404, body: { error: 'not_found' } };
  const s = adapter.status();
  if (!s.env || !s.webhookSecretSet) return { status: 503, body: { error: 'payments_off' } };

  const verified = adapter.verifyWebhook(rawBody, headers);
  if (!verified.ok) {
    console.warn(`[SmartFlow Payments] ${adapter.name} webhook rejected: ${verified.reason}`);
    return { status: 401, body: { error: 'bad_signature' } };
  }

  const normalized = adapter.normalizeEvent(verified.event);
  const existing = await db.get(
    'SELECT id, status FROM payment_events WHERE provider = ? AND provider_env = ? AND event_id = ?',
    [adapter.name, s.env, verified.eventId]
  );
  let eventRowId = existing && existing.id;
  if (existing && existing.status !== 'failed') return { status: 200, body: { ok: true, duplicate: true } };
  if (!existing) {
    eventRowId = newId('pev');
    const inserted = await db.run(
      `INSERT INTO payment_events (id, provider, provider_env, event_id, type, payload, status, received_at)
       VALUES (?, ?, ?, ?, ?, ?, 'received', ?) ON CONFLICT DO NOTHING`,
      [eventRowId, adapter.name, s.env, verified.eventId, normalized.providerType || normalized.type, JSON.stringify(verified.event), sqlNow()]
    );
    // Два одинаковых вебхука одновременно: обрабатывает только первый
    if (!inserted.changes) return { status: 200, body: { ok: true, duplicate: true } };
  }

  const list = handlers.get(normalized.type) || [];
  try {
    for (const fn of list) await fn(normalized, { provider: adapter.name, env: s.env, eventId: verified.eventId });
    await db.run('UPDATE payment_events SET status = ?, error = NULL, processed_at = ? WHERE id = ?',
      [list.length ? 'processed' : 'ignored', sqlNow(), eventRowId]);
    return { status: 200, body: { ok: true } };
  } catch (err) {
    const message = adapter.redact ? adapter.redact(err && err.message) : String(err && err.message);
    console.error(`[SmartFlow Payments] ${adapter.name} ${normalized.type} failed: ${message}`);
    await db.run('UPDATE payment_events SET status = ?, error = ?, processed_at = ? WHERE id = ?',
      ['failed', message.slice(0, 500), sqlNow(), eventRowId]);
    return { status: 500, body: { error: 'processing_failed' } };
  }
}

module.exports = {
  checkout: require('./checkout'),
  FLAG,
  registerProvider,
  provider,
  onEvent,
  status,
  isEnabledForSeller,
  receiveWebhook,
  ledger: require('./ledger')
};

// Шаг 3: что делать по вебхукам (оплачено, возврат, спор) и что можно купить через Whop
require('./events').register(module.exports);
require('./subjects/ready-funnel').register();
