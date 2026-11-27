// server/services/payments/payouts.js - «Подключить выплаты» (шаг 1 оплат через платформу).
//
// Продавец (эксперт, маркетолог, автор сообщества) подключает выплаты один раз — подаккаунт один на человека,
// даже если у него несколько бизнесов. Сервер создаёт подаккаунт у провайдера (Whop) и даёт ссылку на проверку
// личности на странице провайдера: документы SmartFlow не видит и не хранит. Статус спрашиваем у провайдера,
// когда человек открывает «Выплаты» (не чаще раза в 20 секунд), и храним в payment_accounts:
//   not_connected — не подключено (подаккаунта нет или проверка не начата)
//   pending       — на проверке
//   ready         — готово: можно принимать оплату
//   rejected      — провайдер не подтвердил данные (человек пишет в поддержку)
// Доступно только тому, кому включён флаг payments_whop и у кого бизнес-профиль (помощник подключить не может).
const crypto = require('crypto');
const db = require('../../db');
const config = require('../../config');
const appInfo = require('../app-info');
const businessService = require('../business-service');

const FLAG = 'payments_whop';
const REFRESH_EVERY_MS = 20 * 1000;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;

class PayoutsError extends Error {
  constructor(message, status = 400, code = 'PAYOUTS_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function provider() {
  return require('./index').provider('whop');
}

// Время из базы: в PostgreSQL — Date, в SQLite — строка «2026-11-27 10:00:00» (UTC)
function timeMs(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const t = Date.parse(String(value).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(value)) ? '' : 'Z'));
  return Number.isFinite(t) ? t : 0;
}

function sqlNow() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

// Кто может подключать выплаты: флаг + провайдер настроен + бизнес-профиль или свой бизнес
async function access(userId) {
  const adapter = provider();
  if (!adapter.isConfigured()) return { allowed: false, reason: 'off' };
  if (!(await appInfo.isOn(FLAG, userId))) return { allowed: false, reason: 'off' };
  const owns = (await businessService.businessesOfOwner(userId)).length > 0;
  if (!owns && !(await businessService.hasBusinessProfile(userId))) return { allowed: false, reason: 'not_business' };
  return { allowed: true, adapter };
}

async function requireAccess(userId) {
  const a = await access(userId);
  if (a.reason === 'off') throw new PayoutsError('Выплаты через SmartFlow пока не включены. Продажи идут как раньше — по вашей ссылке на оплату.', 403, 'PAYOUTS_OFF');
  if (a.reason === 'not_business') throw new PayoutsError('Выплаты подключает владелец бизнеса в своём Офисе.', 403, 'NOT_BUSINESS');
  return a.adapter;
}

async function accountRow(userId, adapter) {
  return db.get('SELECT * FROM payment_accounts WHERE user_id = ? AND provider = ? AND provider_env = ?',
    [userId, adapter.name, adapter.settings().env]);
}

function view(row) {
  return {
    available: true,
    status: row ? row.status : 'not_connected',
    connected: Boolean(row && row.provider_account_id),
    env: provider().settings().env,
    updatedAt: row ? row.updated_at : null
  };
}

async function saveStatus(row, status, detail) {
  if (row.status === status && (row.status_detail || null) === (detail || null)) {
    await db.run('UPDATE payment_accounts SET updated_at = ? WHERE id = ?', [sqlNow(), row.id]);
    return { ...row, updated_at: sqlNow() };
  }
  await db.run('UPDATE payment_accounts SET status = ?, status_detail = ?, updated_at = ? WHERE id = ?', [status, detail || null, sqlNow(), row.id]);
  return { ...row, status, status_detail: detail || null, updated_at: sqlNow() };
}

/**
 * Статус выплат человека. Если подаккаунт есть и статус не «готово» — спрашиваем провайдера (не чаще раза в 20 с).
 * Провайдер не ответил — отдаём последний известный статус (stale: true), экран не ломается.
 */
async function getStatus(userId, { now = Date.now() } = {}) {
  const a = await access(userId);
  if (!a.allowed) return { available: false, reason: a.reason };
  const adapter = a.adapter;
  let row = await accountRow(userId, adapter);
  if (row && row.provider_account_id && row.status !== 'ready') {
    const fresh = now - timeMs(row.updated_at) < REFRESH_EVERY_MS;
    if (!fresh) {
      try {
        const s = adapter.sellerStatus(await adapter.getAccount(row.provider_account_id));
        row = await saveStatus(row, s.status, s.detail);
      } catch (err) {
        console.warn(`[SmartFlow Payments] payout status for ${userId}: ${adapter.redact(err.message)}`);
        return { ...view(row), stale: true };
      }
    }
  }
  return view(row);
}

function returnUrl() {
  return `${config.webAppUrl}/?payouts=1`;
}

async function emailOf(userId, given) {
  const user = await db.get('SELECT email FROM users WHERE id = ?', [userId]);
  const email = String(given || (user && user.email) || '').trim().toLowerCase();
  if (!email) throw new PayoutsError('Впишите почту: Whop пришлёт на неё письма о выплатах.', 400, 'EMAIL_REQUIRED');
  if (!EMAIL_RE.test(email)) throw new PayoutsError('Почта выглядит неправильно. Проверьте и впишите ещё раз.', 400, 'BAD_EMAIL');
  return email;
}

/**
 * «Подключить выплаты»: подаккаунт (если ещё нет) + ссылка на проверку личности.
 * → { url, status }
 */
async function connect(userId, { email } = {}) {
  const adapter = await requireAccess(userId);
  let row = await accountRow(userId, adapter);
  if (!row || !row.provider_account_id) {
    const user = await db.get('SELECT id, display_name, profile FROM users WHERE id = ?', [userId]);
    let title = user && user.display_name;
    try { title = JSON.parse((user && user.profile) || '{}').displayName || title; } catch (e) { /* the Telegram name */ }
    const account = await adapter.createSellerAccount({ email: await emailOf(userId, email), externalId: userId, title: title ? String(title).slice(0, 80) : undefined });
    if (row) {
      await db.run('UPDATE payment_accounts SET provider_account_id = ?, status = ?, updated_at = ? WHERE id = ?', [account.id, 'not_connected', sqlNow(), row.id]);
    } else {
      // Два нажатия одновременно: вторая строка не появится (уникальный индекс), подаккаунт у Whop тот же
      await db.run(
        `INSERT INTO payment_accounts (id, user_id, provider, provider_env, provider_account_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'not_connected', ?, ?) ON CONFLICT DO NOTHING`,
        [`pac_${crypto.randomBytes(12).toString('hex')}`, userId, adapter.name, adapter.settings().env, account.id, sqlNow(), sqlNow()]
      );
    }
    row = await accountRow(userId, adapter);
  }
  const link = await adapter.accountLink(row.provider_account_id, { purpose: 'onboarding', returnUrl: returnUrl() });
  return { url: link.url, status: row.status };
}

// «Мои выплаты в Whop»: баланс и вывод денег — на странице провайдера
async function dashboard(userId) {
  const adapter = await requireAccess(userId);
  const row = await accountRow(userId, adapter);
  if (!row || !row.provider_account_id) throw new PayoutsError('Сначала подключите выплаты.', 400, 'NOT_CONNECTED');
  const link = await adapter.accountLink(row.provider_account_id, { purpose: 'payouts', returnUrl: returnUrl() });
  return { url: link.url };
}

module.exports = { getStatus, connect, dashboard, access, PayoutsError, FLAG };
