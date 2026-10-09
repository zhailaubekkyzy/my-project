-- SmartFlow Migration 006: support. A short user number people can dictate (SF-48213),
-- error codes in a log the team can search, details attached to complaints, the support team
-- and a record of every fix the team makes. Works on SQLite and PostgreSQL.

-- Short number shown in Profile (SF-48213): finds the person's usr_... id without mistakes
ALTER TABLE users ADD COLUMN support_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_support_code ON users(support_code);
ALTER TABLE users ADD COLUMN last_seen_at TIMESTAMP;
-- Telegram: may the bot write to this person (from the last login)
ALTER TABLE users ADD COLUMN telegram_write_allowed INTEGER;
-- The team pressed "Очистить данные на телефоне": the app clears its cache on next open
ALTER TABLE users ADD COLUMN client_reset_at TEXT;

-- Complaint details: phone and system, Telegram version, screen, last error codes (JSON)
ALTER TABLE feedback ADD COLUMN context TEXT;
-- Team's internal note and the answer sent to the person
ALTER TABLE feedback ADD COLUMN note TEXT;
ALTER TABLE feedback ADD COLUMN reply TEXT;
ALTER TABLE feedback ADD COLUMN replied_at TIMESTAMP;
ALTER TABLE feedback ADD COLUMN replied_by TEXT;
ALTER TABLE feedback ADD COLUMN updated_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id);

-- Errors shown to people with a code ("Ошибка, код K7P2"). No personal data: user id,
-- address of the request and the technical message only.
CREATE TABLE IF NOT EXISTS error_log (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  source TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  method TEXT,
  path TEXT,
  status INTEGER,
  message TEXT,
  context TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_error_log_code ON error_log(code);
CREATE INDEX IF NOT EXISTS idx_error_log_user ON error_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_error_log_created ON error_log(created_at);

-- Support team added in the app by the owner (owners themselves come from ADMIN_USERS)
CREATE TABLE IF NOT EXISTS staff (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'support',
  added_by TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Every fix, reply and look into someone's data made from the support panel
CREATE TABLE IF NOT EXISTS admin_actions (
  id TEXT PRIMARY KEY,
  staff_user_id TEXT NOT NULL,
  target_user_id TEXT,
  action TEXT NOT NULL,
  details TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_actions_target ON admin_actions(target_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_actions_created ON admin_actions(created_at);

-- postgres-only:begin
ALTER TABLE error_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
