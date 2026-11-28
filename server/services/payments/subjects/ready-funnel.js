// server/services/payments/subjects/ready-funnel.js - Сценарий 2: эксперт подписывается на шаблон маркетолога.
//
// Ежемесячное списание через Whop на подаккаунт маркетолога, 1% — SmartFlow. Продаётся шаблон с оплатой «подписка»,
// у которого маркетолог указал цену в долларах и политику возврата, если у маркетолога выплаты «готово» и флаг
// payments_whop. Остальные шаблоны покупаются как раньше — «Я оплатил(а)» и подтверждение автором.
// После оплаты покупка (funnel_purchases) становится активной сама, оплачено до — конец месяца (+2 дня запаса);
// каждое продление сдвигает срок. Снимок шаблона — на момент первой оплаты (покупка живёт на своём снимке).
// Деньги вернулись (возврат целиком или проигранный спор) — покупка закрывается, SI возвращается к методологии эксперта.
const crypto = require('crypto');
const db = require('../../../db');
const checkout = require('../checkout');

const TYPE = 'ready_funnel';

function purchases() {
  return require('../../funnel-purchase-service');
}

function notify(userId, text, startParam) {
  require('../../notify-service').notifyUser(userId, text, { important: true, buttonText: 'Открыть', startParam })
    .catch(err => console.warn('[SmartFlow Payments] not notified:', err.message));
}

// Можно ли купить этот шаблон через Whop (для страницы шаблона): цена, политика возврата и готовый продавец
async function onlineOffer(funnel) {
  if (!funnel || funnel.price_type !== 'monthly' || !funnel.price_minor || !funnel.refund_policy) return null;
  if (!(await checkout.canSell(funnel.author_id))) return null;
  return {
    priceMinor: Number(funnel.price_minor),
    currency: funnel.currency || checkout.CURRENCY,
    priceLabel: checkout.priceLabel(Number(funnel.price_minor), true),
    refundPolicy: funnel.refund_policy,
    recurring: true
  };
}

async function offer(funnelId, buyerId) {
  const funnel = await db.get('SELECT * FROM ready_funnels WHERE id = ?', [funnelId]);
  if (!funnel || funnel.status !== 'published') throw new checkout.CheckoutError('Шаблон не найден или снят с публикации', 404, 'NOT_FOUND');
  if (funnel.author_id === buyerId) throw new checkout.CheckoutError('Это ваш шаблон', 400, 'OWN');
  if (funnel.price_type !== 'monthly') throw new checkout.CheckoutError('Этот шаблон оплачивается автору напрямую', 400, 'NOT_ONLINE');
  const active = await db.get(
    `SELECT * FROM funnel_purchases WHERE funnel_id = ? AND expert_id = ? AND status = 'active' AND payment_order_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
    [funnel.id, buyerId]
  );
  if (active && active.paid_until && checkout.toDate(active.paid_until) > new Date()) {
    throw new checkout.CheckoutError('Подписка уже оформлена — продлевается сама каждый месяц', 409, 'ALREADY');
  }
  return {
    kind: 'template_subscription',
    sellerId: funnel.author_id,
    title: `Шаблон «${funnel.title}»`.slice(0, 80),
    priceMinor: Number(funnel.price_minor) || 0,
    currency: funnel.currency || checkout.CURRENCY,
    recurring: true,
    accessDays: null,
    refundPolicy: funnel.refund_policy || '',
    product: { table: 'ready_funnels', id: funnel.id, productId: funnel.whop_product_id || null }
  };
}

async function onPaid(order, { renewal, accessUntil }) {
  const until = accessUntil ? checkout.sqlTime(accessUntil) : null;
  const now = checkout.sqlTime();
  let row = await db.get('SELECT * FROM funnel_purchases WHERE payment_order_id = ?', [order.id]);
  if (!row) {
    // Оплата пришла впервые: покупка по ручной заявке того же шаблона (ждала автора) — становится этой
    row = await db.get(`SELECT * FROM funnel_purchases WHERE funnel_id = ? AND expert_id = ? AND status IN ('pending', 'active') ORDER BY created_at DESC LIMIT 1`,
      [order.subject_id, order.buyer_user_id]);
    const funnel = await db.get('SELECT * FROM ready_funnels WHERE id = ?', [order.subject_id]);
    if (row) {
      await db.run(
        `UPDATE funnel_purchases SET status = 'active', payment_order_id = ?, price_type = 'monthly', price_label = ?, paid_until = ?, reason = NULL,
           renewal_requested_at = NULL, confirmed_at = COALESCE(confirmed_at, ?), updated_at = ? WHERE id = ?`,
        [order.id, checkout.priceLabel(Number(order.amount_minor), true), until, now, now, row.id]
      );
    } else {
      const id = `fpu_${crypto.randomBytes(8).toString('hex')}`;
      await db.run(
        `INSERT INTO funnel_purchases (id, funnel_id, expert_id, marketer_id, price_type, price_label, snapshot, status, paid_until, confirmed_at, payment_order_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'monthly', ?, ?, 'active', ?, ?, ?, ?, ?)`,
        [id, order.subject_id, order.buyer_user_id, order.seller_user_id, checkout.priceLabel(Number(order.amount_minor), true),
          funnel ? funnel.snapshot : null, until, now, order.id, now, now]
      );
      row = { id, project_id: null };
    }
    notify(order.buyer_user_id, `✅ Оплата прошла — шаблон «${funnel ? funnel.title : ''}» ваш. Запустите его SI-продавцом: Маркетплейс → «Шаблоны ИИ-продавцов» → шаблон. Подписка продлевается сама каждый месяц.`, `F_${order.subject_id}`);
    notify(order.seller_user_id, `💳 Новая подписка на ваш шаблон «${funnel ? funnel.title : ''}»: ${checkout.priceLabel(Number(order.amount_minor), true)}. Деньги придут на ваш счёт Whop.`, 'FSALES');
  } else {
    await db.run(`UPDATE funnel_purchases SET status = 'active', paid_until = ?, reason = NULL, updated_at = ? WHERE id = ?`, [until, now, row.id]);
  }
  // Шаблон уже работает в SI-продавце — продлеваем и там
  const fresh = await db.get('SELECT project_id FROM funnel_purchases WHERE id = ?', [row.id]);
  if (fresh && fresh.project_id) {
    await db.run('UPDATE projects SET funnel_until = ? WHERE id = ? AND funnel_purchase_id = ?', [until, fresh.project_id, row.id]);
  }
}

async function onRevoked(order, why) {
  const row = await db.get('SELECT * FROM funnel_purchases WHERE payment_order_id = ?', [order.id]);
  if (!row) return;
  const now = checkout.sqlTime();
  const reason = why === 'dispute' ? 'Спор закрыт в пользу покупателя — деньги вернулись' : 'Возврат — деньги вернулись';
  await db.run(`UPDATE funnel_purchases SET status = 'ended', reason = ?, paid_until = ?, updated_at = ? WHERE id = ?`, [reason, now, now, row.id]);
  if (row.project_id) await db.run('UPDATE projects SET funnel_until = ? WHERE id = ? AND funnel_purchase_id = ?', [now, row.project_id, row.id]);
  notify(order.buyer_user_id, `↩️ Деньги за шаблон «${order.title}» вернулись вам — шаблон отключён, SI вернулся к вашей методологии.`, `F_${order.subject_id}`);
}

function register() {
  checkout.registerSubject(TYPE, { offer, onPaid, onRevoked });
}

module.exports = { TYPE, register, onlineOffer, offer, onPaid, onRevoked, purchases };
