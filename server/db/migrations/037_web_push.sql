-- SmartFlow Migration 037: вход через браузер, часть 2 — уведомления на телефон и компьютер (Web Push)
-- и важное на почту, если уведомления не разрешены (решения владелицы 23 нояб.).
--  - push_subscriptions: устройства человека, которым браузер разрешил уведомления (одна строка — одно устройство).
--    Адрес устройства (endpoint) выдаёт браузер; p256dh и auth — ключи шифрования этого устройства.
--    failures — сколько раз подряд не доставилось; устройство, которое браузер «забыл» (404/410), удаляется.
--  - email_notifications: когда уходили письма о важном (только время, без текста) — не больше 20 в сутки.
--  - users.email_notify: «Важное на почту» (1 — да, по умолчанию; 0 — человек выключил в Настройках).
-- Works on SQLite and PostgreSQL.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  device TEXT,
  failures INTEGER NOT NULL DEFAULT 0,
  last_ok_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS email_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_notifications_user ON email_notifications(user_id, created_at);

ALTER TABLE users ADD COLUMN email_notify INTEGER NOT NULL DEFAULT 1;

-- postgres-only:begin
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_notifications ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
