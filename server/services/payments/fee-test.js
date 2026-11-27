// server/services/payments/fee-test.js - Шаг 2 оплат: берёт ли Whop комиссию SmartFlow с каждого продления подписки.
//
// Только владелица (панель поддержки → «Проверка оплат») и только в песочнице. На её подаккаунте создаётся
// тестовая подписка $5 раз в неделю с комиссией SmartFlow (PAYMENTS_PLATFORM_FEE_PERCENT, сейчас 1% = $0.05);
// она платит тестовой картой, через неделю Whop продлевает подписку. Подписку раз в день Whop не разрешает
// («You cannot offer daily subscriptions», песочница 27 нояб.); если откажет и неделю — берём месяц. «Проверить» спрашивает у Whop платежи
// по этому плану и удержания по каждому: первый платёж и продления — с комиссией или без.
//   passed  — хотя бы одно продление оплачено, и с каждого оплаченного продления удержана комиссия
//   failed  — оплаченное продление без комиссии (или меньше ожидаемой): шаги 3–4 — только после решения владелицы
//   waiting — продлений ещё не было
// Подписка хранится в payment_orders (kind = 'fee_test'), отдельной таблицы нет.
const crypto = require('crypto');
const db = require('../../db');
const config = require('../../config');
const { moneyToMinor, feeOf } = require('./ledger');

const KIND = 'fee_test';
const PRICE_MINOR = 500;           // $5
// Самый короткий срок, который разрешит Whop: неделя, иначе месяц (раз в день Whop не разрешает)
const BILLING_PERIODS = [7, 30];
const CURRENCY = 'usd';
const RENEWAL = new Set(['subscription_cycle', 'subscription']);
const FIRST = new Set(['subscription_create', 'one_time', 'manual']);
const PAID = new Set(['paid', 'succeeded']);

class FeeTestError extends Error {
  constructor(message, status = 400, code = 'FEE_TEST') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function provider() {
  return require('./index').provider('whop');
}

function sqlNow() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

function expectedFeeMinor() {
  return feeOf(PRICE_MINOR, config.payments.platformFeeBps || 0);
}

// Почему проверку нельзя запустить (null — можно)
async function blocker(userId) {
  const adapter = provider();
  const s = adapter.settings();
  if (s.env !== 'sandbox' || !adapter.isConfigured()) return { code: 'NOT_SANDBOX', message: 'Проверка работает только в песочнице Whop (WHOP_ENV=sandbox).' };
  if (!config.payments.platformFeeBps || expectedFeeMinor() < 1) return { code: 'NO_FEE', message: 'Впишите процент SmartFlow в Railway: PAYMENTS_PLATFORM_FEE_PERCENT = 1.' };
  const account = await db.get('SELECT * FROM payment_accounts WHERE user_id = ? AND provider = ? AND provider_env = ?', [userId, adapter.name, s.env]);
  if (!account || account.status !== 'ready' || !account.provider_account_id) {
    return { code: 'NOT_READY', message: 'Сначала подключите выплаты: Офис → «Выплаты» должно показывать «Выплаты подключены».' };
  }
  return null;
}

async function accountOf(userId) {
  const adapter = provider();
  return db.get('SELECT * FROM payment_accounts WHERE user_id = ? AND provider = ? AND provider_env = ?', [userId, adapter.name, adapter.settings().env]);
}

async function latestTest(userId) {
  return db.get(`SELECT * FROM payment_orders WHERE kind = ? AND seller_user_id = ? AND provider_env = 'sandbox'
                 ORDER BY CASE WHEN status = 'canceled' THEN 1 ELSE 0 END, created_at DESC, id DESC LIMIT 1`, [KIND, userId]);
}

function applicationFeeMinor(payment, fees) {
  const line = fees.find(f => String(f.origin || '') === 'application_fee');
  if (line) return moneyToMinor(line.amount) ?? moneyToMinor(line.settlement_amount);
  // Старый вид ответа: application_fee прямо в платеже (число в основных единицах)
  if (payment.application_fee && payment.application_fee.amount != null) return moneyToMinor(String(payment.application_fee.amount));
  return 0;
}

function verdictOf(rows, expected) {
  const renewals = rows.filter(r => r.kind === 'renewal' && r.paid);
  if (!renewals.length) return 'waiting';
  return renewals.every(r => (r.feeMinor || 0) >= expected) ? 'passed' : 'failed';
}

/**
 * Состояние проверки: подписка, ссылка на оплату, платежи с комиссией и итог.
 */
async function status(userId) {
  const block = await blocker(userId);
  const order = await latestTest(userId);
  const base = { available: !block, blocker: block, expectedFeeMinor: expectedFeeMinor(), priceMinor: PRICE_MINOR, currency: CURRENCY };
  if (!order) return { ...base, test: null, payments: [], verdict: null };
  const adapter = provider();
  const account = await accountOf(userId);
  const test = { id: order.id, createdAt: order.created_at, canceled: order.status === 'canceled', variantId: order.subject_id,
    billingPeriodDays: order.access_days ? Number(order.access_days) : null, purchaseUrl: null };
  if (!account || !account.provider_account_id) return { ...base, test, payments: [], verdict: null };
  if (!test.canceled && order.provider_checkout_id) {
    test.purchaseUrl = (await adapter.getCheckout(order.provider_checkout_id)).purchaseUrl;
  }
  const list = await adapter.listPayments({ accountId: account.provider_account_id, variantId: order.subject_id });
  const rows = [];
  for (const p of list) {
    const reason = String(p.billing_reason || '');
    const paid = PAID.has(String(p.status || '').toLowerCase()) || Boolean(p.paid_at);
    const fees = paid ? await adapter.paymentFees(p.id) : [];
    rows.push({
      id: p.id,
      at: p.paid_at || p.created_at || null,
      kind: RENEWAL.has(reason) ? 'renewal' : FIRST.has(reason) ? 'first' : (reason || 'other'),
      billingReason: reason || null,
      paid,
      status: p.status || null,
      amountMinor: moneyToMinor(p.total) ?? moneyToMinor(p.subtotal) ?? null,
      feeMinor: paid ? applicationFeeMinor(p, fees) : null,
      membershipId: p.membership_id || (p.membership && p.membership.id) || null
    });
  }
  rows.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  return { ...base, test, payments: rows, verdict: verdictOf(rows, expectedFeeMinor()) };
}

// «Создать тестовую подписку»: $5 в день на подаккаунте владелицы с комиссией SmartFlow
async function create(userId) {
  const block = await blocker(userId);
  if (block) throw new FeeTestError(block.message, 400, block.code);
  const adapter = provider();
  const account = await accountOf(userId);
  const fee = expectedFeeMinor();
  let checkout = null;
  let period = null;
  for (const days of BILLING_PERIODS) {
    try {
      checkout = await adapter.createSubscriptionCheckout({
        accountId: account.provider_account_id,
        title: 'SmartFlow: проверка комиссии',
        priceMinor: PRICE_MINOR,
        feeMinor: fee,
        billingPeriodDays: days,
        currency: CURRENCY,
        metadata: { smartflow: KIND }
      });
      period = days;
      break;
    } catch (err) {
      // Whop не разрешил такой срок — пробуем следующий; другие ошибки — сразу наверх
      const periodRefused = err.providerStatus === 400 && /billing period|subscriptions/i.test(String(err.message));
      if (!periodRefused || days === BILLING_PERIODS[BILLING_PERIODS.length - 1]) throw err;
    }
  }
  const id = `ord_${crypto.randomBytes(12).toString('hex')}`;
  await db.run(
    `INSERT INTO payment_orders (id, kind, provider, provider_env, seller_user_id, subject_type, subject_id, title,
       amount_minor, currency, recurring, platform_fee_bps, refund_policy, access_days, status, provider_checkout_id, created_at, updated_at)
     VALUES (?, ?, ?, 'sandbox', ?, 'variant', ?, ?, ?, ?, 1, ?, ?, ?, 'created', ?, ?, ?)`,
    [id, KIND, adapter.name, userId, checkout.variantId, 'SmartFlow: проверка комиссии', PRICE_MINOR, CURRENCY,
      config.payments.platformFeeBps, 'Тестовая подписка в песочнице', period, checkout.id, sqlNow(), sqlNow()]
  );
  return { id, purchaseUrl: checkout.purchaseUrl, billingPeriodDays: period };
}

// «Отменить тестовую подписку»: отменяет подписки покупателей этого плана сразу, без продлений
async function cancel(userId) {
  const order = await latestTest(userId);
  if (!order || order.status === 'canceled') throw new FeeTestError('Тестовой подписки нет.', 400, 'NO_TEST');
  const adapter = provider();
  const account = await accountOf(userId);
  const memberships = new Set();
  if (account && account.provider_account_id) {
    for (const p of await adapter.listPayments({ accountId: account.provider_account_id, variantId: order.subject_id })) {
      const m = p.membership_id || (p.membership && p.membership.id);
      if (m) memberships.add(m);
    }
  }
  for (const m of memberships) await adapter.cancelMembership(m);
  await db.run(`UPDATE payment_orders SET status = 'canceled', updated_at = ? WHERE id = ?`, [sqlNow(), order.id]);
  return { canceled: memberships.size };
}

module.exports = { status, create, cancel, FeeTestError, verdictOf, KIND, PRICE_MINOR };
