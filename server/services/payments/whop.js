// server/services/payments/whop.js - Адаптер Whop for Platforms (сначала только песочница).
//
// Адрес API выбирается только по явному WHOP_ENV (settings.js): sandbox → sandbox-api.whop.com,
// production → api.whop.com. Ключ (WHOP_API_KEY) уходит только в заголовке Authorization к Whop:
// в логи, ответы, ошибки, PostHog и Амплитуду он не попадает (redact).
//
// Вебхуки Whop подписаны по стандарту Standard Webhooks: заголовки webhook-id, webhook-timestamp,
// webhook-signature ("v1,<base64>" через пробел), подпись — HMAC-SHA256 от "<id>.<timestamp>.<тело>",
// ключ — сами байты секрета (так делает официальная библиотека Whop @whop/sdk, verifyWebhook).
// Тело проверяется ровно таким, каким пришло (поэтому маршрут вебхука стоит до express.json).
const crypto = require('crypto');
const config = require('../../config');
const { PaymentProviderError } = require('./provider');

const name = 'whop';
const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;
const REQUEST_TIMEOUT_MS = 20000;

function settings() {
  return config.payments.whop;
}

function isConfigured() {
  const s = settings();
  return Boolean(s.env && s.apiBase && s.apiKey && s.webhookSecret);
}

// Для /api/health и панели поддержки: только «задано / не задано», сами значения — никогда
function status() {
  const s = settings();
  return {
    provider: name,
    env: s.env,
    configured: isConfigured(),
    apiKeySet: Boolean(s.apiKey),
    webhookSecretSet: Boolean(s.webhookSecret),
    companyIdSet: Boolean(s.companyId),
    problem: s.envProblem || null
  };
}

// Убирает ключ и секрет из любого текста (сообщения об ошибках, ответы Whop)
function redact(text) {
  let out = String(text == null ? '' : text);
  const s = settings();
  for (const secret of [s.apiKey, s.webhookSecret]) {
    if (secret && secret.length >= 6) out = out.split(secret).join('[скрыто]');
  }
  return out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [скрыто]');
}

async function request(method, path, body = null) {
  const s = settings();
  if (!s.env || !s.apiBase) throw new PaymentProviderError(s.envProblem || 'WHOP_ENV не задан: оплаты выключены', { provider: name });
  if (!s.apiKey) throw new PaymentProviderError('WHOP_API_KEY не задан', { provider: name });
  let res;
  try {
    res = await fetch(s.apiBase + path, {
      method,
      headers: {
        Authorization: `Bearer ${s.apiKey}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (err) {
    throw new PaymentProviderError(`Whop не отвечает: ${redact(err && err.message)}`, { provider: name });
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const detail = data && (data.error && (data.error.message || data.error) || data.message);
    throw new PaymentProviderError(`Whop ответил ${res.status}${detail ? `: ${redact(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300)}` : ''}`, { status: res.status, provider: name });
  }
  return data;
}

function header(headers, key) {
  if (!headers) return '';
  const value = typeof headers.get === 'function' ? headers.get(key) : headers[key] ?? headers[key.toLowerCase()];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

/**
 * Проверка подписи вебхука. rawBody — тело ровно как пришло (Buffer или строка).
 * → { ok: true, eventId, timestamp, event } или { ok: false, reason }
 */
function verifyWebhook(rawBody, headers, { now = Date.now() } = {}) {
  const secret = settings().webhookSecret;
  if (!secret) return { ok: false, reason: 'no_secret' };
  const id = header(headers, 'webhook-id');
  const timestamp = header(headers, 'webhook-timestamp');
  const signatures = header(headers, 'webhook-signature');
  if (!id || !timestamp || !signatures) return { ok: false, reason: 'no_signature' };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: 'bad_timestamp' };
  if (Math.abs(Math.floor(now / 1000) - parseInt(timestamp, 10)) > TIMESTAMP_TOLERANCE_SECONDS) return { ok: false, reason: 'old_timestamp' };

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody == null ? '' : rawBody), 'utf8');
  const signed = Buffer.concat([Buffer.from(`${id}.${timestamp}.`, 'utf8'), body]);
  const expected = crypto.createHmac('sha256', Buffer.from(secret, 'utf8')).update(signed).digest();
  const matches = signatures.split(' ').some(entry => {
    const [version, value] = entry.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
  if (!matches) return { ok: false, reason: 'bad_signature' };

  let event;
  try { event = JSON.parse(body.toString('utf8')); } catch { return { ok: false, reason: 'bad_json' }; }
  if (!event || typeof event !== 'object') return { ok: false, reason: 'bad_json' };
  return { ok: true, eventId: id, timestamp: parseInt(timestamp, 10), event };
}

// Подпись для тестов и проверки вручную (тем же способом, что Whop)
function signWebhook(rawBody, { id, timestamp, secret = settings().webhookSecret }) {
  const signed = `${id}.${timestamp}.${Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody}`;
  return 'v1,' + crypto.createHmac('sha256', Buffer.from(secret, 'utf8')).update(signed, 'utf8').digest('base64');
}

const KNOWN_TYPES = new Set([
  'payment.succeeded', 'payment.failed', 'payment.pending',
  'refund.created', 'refund.updated', 'dispute.created', 'dispute.updated',
  'membership.activated', 'membership.deactivated'
]);

// Событие Whop → наш словарь (provider.js, EVENT_TYPES)
function normalizeEvent(event) {
  const rawType = String(event.type || event.action || '');
  const data = event.data && typeof event.data === 'object' ? event.data : {};
  return {
    type: KNOWN_TYPES.has(rawType) ? rawType : 'other',
    providerType: rawType || null,
    objectId: data.id ? String(data.id) : null,
    data
  };
}

module.exports = {
  name,
  settings,
  isConfigured,
  status,
  redact,
  request,
  verifyWebhook,
  signWebhook,
  normalizeEvent,
  TIMESTAMP_TOLERANCE_SECONDS
};
