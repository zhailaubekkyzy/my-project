-- SmartFlow Migration 040: оплаты через Whop, шаг 3 — подписка эксперта на шаблон и платное сообщество
-- (решения владелицы 27–28 нояб.).
--  - Цена для оплаты через Whop — числом в центах и только в долларах (price_minor, currency = 'usd');
--    старое поле price_label (слова автора) остаётся для ручного режима и для подписи на карточке.
--  - refund_policy — политика возврата продавца: обязательна для продажи через Whop, видна в окне оплаты.
--  - whop_product_id — «продукт» на подаккаунте продавца у Whop (без него Whop не создаёт подписку).
--  - communities.access_days — срок доступа при разовой оплате; пусто = навсегда (решение владелицы 28 нояб.).
--  - funnel_purchases / community_members.payment_order_id — заказ, по которому открыт доступ
--    (покупка через Whop; у ручного режима пусто).
-- Works on SQLite and PostgreSQL.

ALTER TABLE ready_funnels ADD COLUMN price_minor BIGINT;
ALTER TABLE ready_funnels ADD COLUMN currency TEXT;
ALTER TABLE ready_funnels ADD COLUMN refund_policy TEXT;
ALTER TABLE ready_funnels ADD COLUMN whop_product_id TEXT;

ALTER TABLE communities ADD COLUMN price_minor BIGINT;
ALTER TABLE communities ADD COLUMN currency TEXT;
ALTER TABLE communities ADD COLUMN refund_policy TEXT;
ALTER TABLE communities ADD COLUMN access_days INTEGER;
ALTER TABLE communities ADD COLUMN whop_product_id TEXT;

ALTER TABLE funnel_purchases ADD COLUMN payment_order_id TEXT;
ALTER TABLE community_members ADD COLUMN payment_order_id TEXT;

CREATE INDEX IF NOT EXISTS idx_payment_orders_subject ON payment_orders(subject_type, subject_id, buyer_user_id);
