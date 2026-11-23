-- SmartFlow Migration 036: вход через браузер, часть 1 — по почте и коду (решения владелицы 23 нояб.).
-- Человек вписывает почту → приходит письмо с 6 цифрами → вводит их → входит. Новый человек — новый аккаунт
-- (auth_identities: provider 'email', provider_user_id — почта маленькими буквами). Telegram-вход работает как раньше.
--  - email_codes: выданные коды; хранится только отпечаток кода (code_hash), не сам код; 10 минут, до 5 попыток;
--    не чаще раза в минуту и 5 раз в час на одну почту, 20 раз в час с одного адреса (ip).
--  - users.email: почта человека (для входа и, во 2-й части, для важных уведомлений на почту).
-- Works on SQLite and PostgreSQL.

CREATE TABLE IF NOT EXISTS email_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  ip TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_codes_email ON email_codes(email, created_at);
CREATE INDEX IF NOT EXISTS idx_email_codes_ip ON email_codes(ip, created_at);

ALTER TABLE users ADD COLUMN email TEXT;

-- postgres-only:begin
ALTER TABLE email_codes ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
