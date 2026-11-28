// server/services/payments/events.js - Что сервер делает по вебхукам Whop (шаг 3).
//
//  payment.succeeded  — заказ находится по metadata.smartflow_order (Whop копирует её из страницы оплаты в платежи
//                       и подписки), иначе по странице оплаты или подписке. Списание записывается один раз
//                       (payment_charges, уникально по номеру платежа) с удержанной комиссией SmartFlow (строка
//                       application_fee в /payments/:id/fees) и долями продавца и платформы; предмет открывает или
//                       продлевает доступ. Продление без комиссии SmartFlow — предупреждение в панели поддержки.
//  dispute.created    — спор: заказ «спор», продавцу уведомление, доступ НЕ закрывается (решение владелицы 28 нояб.:
//                       сначала продавец пытается договориться).
//  dispute.updated    — спор проигран (деньги вернулись покупателю) → доступ закрывается; выигран → «оплачено».
//  refund.created/updated (succeeded) — сколько вернули, берём из самого платежа (refunded_amount); вернули всё →
//                       доступ закрывается автоматически, продавцу и покупателю уведомления; частично — только уведомление.
// Тестовая подписка «Проверка оплат» (kind = fee_test) здесь не обрабатывается.
const crypto = require('crypto');
const db = require('../../db');
const { moneyToMinor, feeOf } = require('./ledger');
const checkout = require('./checkout');

const RENEWAL = new Set(['subscription_cycle', 'subscription']);
const DISPUTE_LOST = new Set(['lost']);
const DISPUTE_OVER = new Set(['won', 'prevented', 'warning_closed', 'closed']);

function provider() {
  return require('./index').provider('whop');
}

function notify(userId, text, startParam) {
  if (!userId) return;
  require('../notify-service').notifyUser(userId, text, { important: true, buttonText: { ru: 'Открыть', en: 'Open' }, startParam })
    .catch(err => console.warn('[SmartFlow Payments] not notified:', err.message));
}

async function findOrder(data) {
  const meta = (data && data.metadata) || {};
  if (meta.smartflow_order) {
    const o = await db.get('SELECT * FROM payment_orders WHERE id = ?', [String(meta.smartflow_order)]);
    if (o) return o;
  }
  if (data.checkout_configuration_id) {
    const o = await db.get('SELECT * FROM payment_orders WHERE provider = ? AND provider_checkout_id = ?', ['whop', data.checkout_configuration_id]);
    if (o) return o;
  }
  const membership = data.membership_id || (data.membership && data.membership.id);
  if (membership) {
    const o = await db.get('SELECT * FROM payment_orders WHERE provider = ? AND provider_membership_id = ? ORDER BY created_at DESC LIMIT 1', ['whop', membership]);
    if (o) return o;
  }
  return null;
}

function applicationFeeMinor(fees) {
  const line = (fees || []).find(f => String(f.origin || '') === 'application_fee');
  return line ? (moneyToMinor(line.amount) ?? moneyToMinor(line.settlement_amount) ?? 0) : 0;
}

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

async function onPaymentSucceeded(event) {
  const data = event.data || {};
  if (!data.id) return;
  const order = await findOrder(data);
  if (!order || order.kind === 'fee_test') return;
  if (await db.get('SELECT id FROM payment_charges WHERE provider = ? AND provider_payment_id = ?', ['whop', data.id])) return;

  const adapter = provider();
  const amount = moneyToMinor(data.total) ?? moneyToMinor(data.subtotal) ?? Number(order.amount_minor);
  // Удержания — до записи списания: если Whop не ответил, событие придёт снова и мы попробуем ещё раз
  const fee = applicationFeeMinor(await adapter.paymentFees(data.id));
  const renewal = RENEWAL.has(String(data.billing_reason || '')) || (order.status !== 'pending' && Number(order.recurring) === 1);
  const paidAt = toDate(data.paid_at) || new Date();
  const now = checkout.sqlTime();
  const chargeId = `chg_${crypto.randomBytes(12).toString('hex')}`;
  const inserted = await db.run(
    `INSERT INTO payment_charges (id, order_id, provider, provider_payment_id, billing_reason, amount_minor, application_fee_minor, currency, status, paid_at, created_at, updated_at)
     VALUES (?, ?, 'whop', ?, ?, ?, ?, ?, 'paid', ?, ?, ?) ON CONFLICT DO NOTHING`,
    [chargeId, order.id, data.id, data.billing_reason || (renewal ? 'subscription_cycle' : null), amount, fee, order.currency, checkout.sqlTime(paidAt), now, now]
  );
  if (!inserted.changes) return;
  // Доли: продавцу — всё, кроме комиссии (Whop платит ему напрямую), SmartFlow — удержанная комиссия
  for (const [role, recipient, value] of [['seller', order.seller_user_id, amount - fee], ['platform', null, fee]]) {
    await db.run(
      `INSERT INTO payment_shares (id, charge_id, order_id, role, recipient_user_id, amount_minor, currency, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?)`,
      [`shr_${crypto.randomBytes(12).toString('hex')}`, chargeId, order.id, role, recipient, value, order.currency, now, now]
    );
  }
  const until = checkout.accessUntil(order, paidAt);
  const membership = data.membership_id || (data.membership && data.membership.id) || order.provider_membership_id || null;
  await db.run(
    `UPDATE payment_orders SET status = 'paid', paid_at = COALESCE(paid_at, ?), access_until = ?, provider_membership_id = ?, updated_at = ? WHERE id = ?`,
    [checkout.sqlTime(paidAt), until ? checkout.sqlTime(until) : null, membership, now, order.id]
  );
  const expected = feeOf(amount, Number(order.platform_fee_bps) || 0);
  if (renewal && fee < expected) {
    console.warn(`[SmartFlow Payments] renewal without the SmartFlow fee: order=${order.id} payment=${data.id} fee=${fee} expected=${expected}`);
  }
  const impl = checkout.subject(order.subject_type);
  if (impl) await impl.onPaid({ ...order, status: 'paid', access_until: until }, { renewal, accessUntil: until });
}

async function chargeOf(paymentId) {
  return paymentId ? db.get('SELECT * FROM payment_charges WHERE provider = ? AND provider_payment_id = ?', ['whop', paymentId]) : null;
}

async function revoke(order, why) {
  const impl = checkout.subject(order.subject_type);
  if (impl) await impl.onRevoked(order, why);
}

async function onRefund(event) {
  const data = event.data || {};
  if (String(data.status || '') !== 'succeeded') return;
  const charge = await chargeOf(data.payment_id);
  if (!charge) return;
  const order = await db.get('SELECT * FROM payment_orders WHERE id = ?', [charge.order_id]);
  if (!order) return;
  // Сколько вернули всего — из самого платежа: событие может прийти дважды (created + updated)
  const payment = await provider().getPayment(charge.provider_payment_id);
  const refunded = Math.min(Number(charge.amount_minor), moneyToMinor(payment && payment.refunded_amount) ?? moneyToMinor(data.amount) ?? 0);
  if (refunded <= Number(charge.refunded_minor || 0)) return;
  const full = refunded >= Number(charge.amount_minor);
  const now = checkout.sqlTime();
  await db.run('UPDATE payment_charges SET refunded_minor = ?, status = ?, updated_at = ? WHERE id = ?', [refunded, full ? 'refunded' : 'partially_refunded', now, charge.id]);
  if (full) await db.run(`UPDATE payment_shares SET status = 'canceled', updated_at = ? WHERE charge_id = ?`, [now, charge.id]);
  const money = `$${(refunded / 100).toFixed(2)}`;
  if (full && order.status !== 'refunded') {
    await db.run(`UPDATE payment_orders SET status = 'refunded', updated_at = ? WHERE id = ?`, [now, order.id]);
    await revoke(order, 'refund');
    notify(order.seller_user_id, `↩️ Возврат ${money} по «${order.title}»: деньги вернулись покупателю, доступ закрыт автоматически.`);
  } else if (!full) {
    await db.run(`UPDATE payment_orders SET status = 'partially_refunded', updated_at = ? WHERE id = ? AND status = 'paid'`, [now, order.id]);
    notify(order.seller_user_id, `↩️ Частичный возврат ${money} по «${order.title}». Доступ покупателя остаётся.`);
  }
}

async function onDispute(event) {
  const data = event.data || {};
  const paymentId = (data.payment && data.payment.id) || data.payment_id;
  const charge = await chargeOf(paymentId);
  if (!charge) return;
  const order = await db.get('SELECT * FROM payment_orders WHERE id = ?', [charge.order_id]);
  if (!order || order.status === 'refunded') return;
  const status = String(data.status || '');
  const now = checkout.sqlTime();
  if (DISPUTE_LOST.has(status)) {
    // Банк вернул деньги покупателю — доступ закрывается сам
    await db.run('UPDATE payment_charges SET refunded_minor = amount_minor, status = ?, updated_at = ? WHERE id = ?', ['disputed_lost', now, charge.id]);
    await db.run(`UPDATE payment_shares SET status = 'canceled', updated_at = ? WHERE charge_id = ?`, [now, charge.id]);
    await db.run(`UPDATE payment_orders SET status = 'refunded', updated_at = ? WHERE id = ?`, [now, order.id]);
    await revoke(order, 'dispute');
    notify(order.seller_user_id, `⚖️ Спор по «${order.title}» закрыт в пользу покупателя: деньги вернулись ему, доступ закрыт автоматически.`);
    return;
  }
  if (DISPUTE_OVER.has(status)) {
    if (order.status === 'disputed') {
      await db.run(`UPDATE payment_orders SET status = 'paid', updated_at = ? WHERE id = ?`, [now, order.id]);
      notify(order.seller_user_id, `⚖️ Спор по «${order.title}» закрыт в вашу пользу.`);
    }
    return;
  }
  if (order.status !== 'disputed') {
    await db.run(`UPDATE payment_orders SET status = 'disputed', updated_at = ? WHERE id = ?`, [now, order.id]);
    notify(order.seller_user_id, `⚖️ Покупатель открыл спор по оплате «${order.title}». Свяжитесь с ним и предложите решение — доступ пока остаётся. Если деньги вернутся покупателю, доступ закроется сам. Ответить на спор можно в «Мои выплаты в Whop».`);
  }
}

/**
 * Предупреждения для панели поддержки: продления, с которых Whop не удержал комиссию SmartFlow.
 */
async function renewalsWithoutFee() {
  const rows = await db.all(
    `SELECT c.amount_minor, c.application_fee_minor, o.platform_fee_bps FROM payment_charges c JOIN payment_orders o ON o.id = c.order_id
     WHERE c.billing_reason IN ('subscription_cycle', 'subscription') AND o.kind <> 'fee_test'`
  );
  return rows.filter(r => Number(r.application_fee_minor || 0) < feeOf(Number(r.amount_minor), Number(r.platform_fee_bps) || 0)).length;
}

function register(payments) {
  payments.onEvent('payment.succeeded', onPaymentSucceeded);
  payments.onEvent('refund.created', onRefund);
  payments.onEvent('refund.updated', onRefund);
  payments.onEvent('dispute.created', onDispute);
  payments.onEvent('dispute.updated', onDispute);
}

module.exports = { register, renewalsWithoutFee, onPaymentSucceeded, onRefund, onDispute };
