// server/services/payments/checkout.js - Оплата через Whop (шаг 3): заказ → страница оплаты Whop.
//
// Покупатель нажимает «Оплатить» (в Telegram — «Оплатить на сайте», страница Whop во внешнем браузере):
// сервер создаёт заказ в payment_orders, «продукт» у Whop на подаккаунте продавца (один раз на товар) и страницу
// оплаты с прямым списанием на подаккаунт продавца и комиссией SmartFlow (application_fee_amount). В metadata
// страницы — номер нашего заказа: Whop копирует её в платежи и подписки, и вебхук находит заказ (payments/events.js).
// Доступ открывает только вебхук «оплачено», не возврат с сайта.
//
// Что продаётся — «предметы» (subjects), каждый со своим файлом: ready_funnel (подписка эксперта на шаблон,
// сценарий 2) и community (платное сообщество, сценарий 3). Предмет знает цену, продавца и что открыть/закрыть.
const crypto = require('crypto');
const db = require('../../db');
const config = require('../../config');
const appInfo = require('../app-info');
const { feeOf } = require('./ledger');

const FLAG = 'payments_whop';
const CURRENCY = 'usd'; // только доллары (решение владелицы 28 нояб.)
const MONTH_DAYS = 30;
// Продление приходит в день окончания периода — 2 дня запаса, чтобы доступ не обрывался на час-другой
const GRACE_DAYS = 2;
const PRODUCT_TABLES = new Set(['ready_funnels', 'communities']);

class CheckoutError extends Error {
  constructor(message, status = 400, code = 'CHECKOUT') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const subjects = new Map();
function registerSubject(type, impl) {
  subjects.set(type, impl);
}
function subject(type) {
  return subjects.get(type) || null;
}

function provider() {
  return require('./index').provider('whop');
}

function sqlTime(date = new Date()) {
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

/** Подаккаунт продавца, готовый принимать оплату (флаг + Whop настроен + выплаты «готово»), или null */
async function sellerAccount(userId) {
  const adapter = provider();
  if (!userId || !adapter.isConfigured()) return null;
  if (!(await appInfo.isOn(FLAG, userId))) return null;
  const row = await db.get(
    `SELECT * FROM payment_accounts WHERE user_id = ? AND provider = ? AND provider_env = ? AND status = 'ready' AND provider_account_id IS NOT NULL`,
    [userId, adapter.name, adapter.settings().env]
  );
  return row || null;
}

async function canSell(userId) {
  return Boolean(await sellerAccount(userId));
}

// Цена из поля «Цена, $»: «29», «29.90», «29,9» → центы; пусто → null; ерунда или ≤ 0 → ошибка
function parsePrice(value) {
  const text = String(value == null ? '' : value).trim().replace(',', '.').replace(/^\$/, '');
  if (!text) return null;
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text)) throw new CheckoutError('Цена — число в долларах, например 29 или 29.90');
  const minor = Math.round(parseFloat(text) * 100);
  if (minor < 100) throw new CheckoutError('Цена — от $1');
  return minor;
}

function priceLabel(minor, recurring) {
  const usd = minor % 100 ? (minor / 100).toFixed(2) : String(minor / 100);
  return `$${usd}${recurring ? ' / мес' : ''}`;
}

// «Продукт» у Whop — один на товар, создаётся при первой оплате и запоминается в его строке
async function ensureProduct(adapter, accountId, { table, id, productId, title }) {
  if (productId) return productId;
  if (!PRODUCT_TABLES.has(table)) throw new Error(`checkout: unknown product table ${table}`);
  const created = await adapter.createProduct({ accountId, title, metadata: { smartflow_table: table, smartflow_id: id } });
  await db.run(`UPDATE ${table} SET whop_product_id = ? WHERE id = ? AND whop_product_id IS NULL`, [created, id]);
  const row = await db.get(`SELECT whop_product_id FROM ${table} WHERE id = ?`, [id]);
  return (row && row.whop_product_id) || created;
}

/**
 * Начать оплату: { subjectType, subjectId, buyerId } → { orderId, url }.
 * Предмет отвечает offer(subjectId, buyerId) → { kind, sellerId, title, priceMinor, currency, recurring,
 * accessDays, refundPolicy, product: { table, id, productId } } или бросает понятную ошибку.
 */
async function start({ subjectType, subjectId, buyerId }) {
  const impl = subject(subjectType);
  if (!impl) throw new CheckoutError('Неизвестная покупка', 404, 'NOT_FOUND');
  const offer = await impl.offer(String(subjectId || ''), buyerId);
  if (offer.sellerId === buyerId) throw new CheckoutError('Это ваше — покупать не нужно', 400, 'OWN');
  if (!offer.priceMinor || offer.currency !== CURRENCY) throw new CheckoutError('У продавца не указана цена в долларах', 400, 'NO_PRICE');
  if (!offer.refundPolicy) throw new CheckoutError('У продавца не указана политика возврата', 400, 'NO_REFUND_POLICY');
  const account = await sellerAccount(offer.sellerId);
  if (!account) throw new CheckoutError('Продавец пока не принимает оплату через SmartFlow', 409, 'SELLER_NOT_READY');
  const bps = config.payments.platformFeeBps;
  const fee = feeOf(offer.priceMinor, bps || 0);
  if (!bps || fee < 1 || fee >= offer.priceMinor) throw new CheckoutError('Оплата через SmartFlow сейчас недоступна', 503, 'NO_FEE');

  const adapter = provider();
  const productId = await ensureProduct(adapter, account.provider_account_id, { ...offer.product, title: offer.title });
  const id = `ord_${crypto.randomBytes(12).toString('hex')}`;
  await db.run(
    `INSERT INTO payment_orders (id, kind, provider, provider_env, seller_user_id, buyer_user_id, subject_type, subject_id, title,
       amount_minor, currency, recurring, platform_fee_bps, refund_policy, access_days, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [id, offer.kind, adapter.name, adapter.settings().env, offer.sellerId, buyerId, subjectType, offer.product.id, offer.title,
      offer.priceMinor, CURRENCY, offer.recurring ? 1 : 0, bps, offer.refundPolicy, offer.recurring ? MONTH_DAYS : (offer.accessDays || null), sqlTime(), sqlTime()]
  );
  const checkout = await adapter.createCheckout({
    accountId: account.provider_account_id,
    productId,
    title: offer.title,
    priceMinor: offer.priceMinor,
    feeMinor: fee,
    recurring: offer.recurring,
    billingPeriodDays: MONTH_DAYS,
    currency: CURRENCY,
    metadata: { smartflow_order: id },
    redirectUrl: `${config.webAppUrl}/?paid=1`
  });
  await db.run('UPDATE payment_orders SET provider_checkout_id = ?, updated_at = ? WHERE id = ?', [checkout.id, sqlTime(), id]);
  return { orderId: id, url: checkout.purchaseUrl };
}

// Время из базы: в PostgreSQL — Date, в SQLite — строка «2026-11-27 10:00:00» (UTC)
function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const text = String(value);
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : text.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

/** До какого времени открыт доступ после оплаты (null — навсегда) */
function accessUntil(order, paidAt = new Date()) {
  if (Number(order.recurring)) return new Date(paidAt.getTime() + (MONTH_DAYS + GRACE_DAYS) * 86400000);
  if (order.access_days) return new Date(paidAt.getTime() + Number(order.access_days) * 86400000);
  return null;
}

module.exports = {
  CheckoutError, FLAG, CURRENCY, MONTH_DAYS, GRACE_DAYS,
  registerSubject, subject, sellerAccount, canSell, parsePrice, priceLabel, start, accessUntil, sqlTime, toDate
};
