-- SmartFlow Migration 039: оплаты через платформу, шаг 0 — таблицы учёта (решения владелицы 27 нояб.).
-- Учёт денег ведёт SmartFlow; провайдер (сейчас Whop for Platforms, сначала песочница) только проводит деньги.
-- Все суммы — целые числа в минимальных единицах валюты (центы): без дробей и округлений «на лету».
--  - payment_accounts: подаккаунт продавца у провайдера (эксперт, маркетолог, автор сообщества) и его проверка личности:
--    not_connected / pending (на проверке) / ready (готово). Песочница и боевой режим — разные строки (provider_env).
--  - payment_orders: заказ (одна покупка или одна подписка). kind — один из пяти сценариев:
--    platform_subscription (1) · template_subscription (2) · community (3) · template_purchase (4) · expert_sale (5).
--    seller_user_id — продавец по платежу (возвраты и споры на нём); пусто — продаёт сама SmartFlow (сценарий 1).
--    platform_fee_bps / marketer_fee_bps — проценты на момент заказа в сотых долях процента (1000 = 10%): заказ живёт на своём снимке.
--    refund_policy и access_days обязательны для продажи (срок доступа не «навсегда») — проверяет сервер.
--    status: created → pending → paid → refunded / partially_refunded / disputed; failed / canceled.
--  - payment_charges: каждое списание по заказу (первый платёж и каждое продление подписки отдельно) —
--    сколько взято, сколько удержала платформа (application_fee), причина (первый / продление).
--  - payment_shares: доли каждого получателя по списанию: role seller / platform / marketer, сумма и статус
--    pending (ждёт перевода) · reserved (в резерве) · payable · paid · canceled (возврат/спор) · clawback (удержать из следующих).
--  - payment_payouts: переводы, которые делает сама SmartFlow (доля маркетолога, раз в неделю) — со статусом и причиной ошибки.
--    Неудачный перевод автоматически не повторяется (видно в панели поддержки).
--  - payment_reserves: резерв по получателю (10% за 90 дней, не меньше самой дорогой продажи) и когда он освобождается.
--  - payment_events: каждый принятый вебхук провайдера (после проверки подписи) — один раз по его номеру.
-- Works on SQLite and PostgreSQL.

CREATE TABLE IF NOT EXISTS payment_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_env TEXT NOT NULL,
  provider_account_id TEXT,
  status TEXT NOT NULL DEFAULT 'not_connected',
  status_detail TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_accounts_user ON payment_accounts(user_id, provider, provider_env);
CREATE INDEX IF NOT EXISTS idx_payment_accounts_provider_id ON payment_accounts(provider, provider_account_id);

CREATE TABLE IF NOT EXISTS payment_orders (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_env TEXT NOT NULL,
  seller_user_id TEXT,
  buyer_user_id TEXT,
  marketer_user_id TEXT,
  subject_type TEXT,
  subject_id TEXT,
  title TEXT,
  amount_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  recurring INTEGER NOT NULL DEFAULT 0,
  platform_fee_bps INTEGER,
  marketer_fee_bps INTEGER,
  refund_policy TEXT,
  access_days INTEGER,
  status TEXT NOT NULL DEFAULT 'created',
  provider_checkout_id TEXT,
  provider_membership_id TEXT,
  paid_at TIMESTAMP,
  access_until TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payment_orders_seller ON payment_orders(seller_user_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_orders_buyer ON payment_orders(buyer_user_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_orders_checkout ON payment_orders(provider, provider_checkout_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_membership ON payment_orders(provider, provider_membership_id);

CREATE TABLE IF NOT EXISTS payment_charges (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_payment_id TEXT NOT NULL,
  billing_reason TEXT,
  amount_minor BIGINT NOT NULL,
  application_fee_minor BIGINT,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'paid',
  refunded_minor BIGINT NOT NULL DEFAULT 0,
  paid_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_charges_provider_id ON payment_charges(provider, provider_payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_charges_order ON payment_charges(order_id);

CREATE TABLE IF NOT EXISTS payment_shares (
  id TEXT PRIMARY KEY,
  charge_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  role TEXT NOT NULL,
  recipient_user_id TEXT,
  amount_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payout_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payment_shares_charge ON payment_shares(charge_id);
CREATE INDEX IF NOT EXISTS idx_payment_shares_recipient ON payment_shares(recipient_user_id, role, status);

CREATE TABLE IF NOT EXISTS payment_payouts (
  id TEXT PRIMARY KEY,
  recipient_user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_env TEXT NOT NULL,
  provider_transfer_id TEXT,
  amount_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  period_start TIMESTAMP,
  period_end TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'planned',
  failure_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payment_payouts_recipient ON payment_payouts(recipient_user_id, status);

CREATE TABLE IF NOT EXISTS payment_reserves (
  id TEXT PRIMARY KEY,
  recipient_user_id TEXT NOT NULL,
  share_id TEXT,
  amount_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  release_at TIMESTAMP NOT NULL,
  status TEXT NOT NULL DEFAULT 'held',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payment_reserves_recipient ON payment_reserves(recipient_user_id, status, release_at);

CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_env TEXT NOT NULL,
  event_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  error TEXT,
  received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_events_event ON payment_events(provider, provider_env, event_id);

-- postgres-only:begin
ALTER TABLE payment_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_reserves ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
