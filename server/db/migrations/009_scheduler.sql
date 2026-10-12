-- SmartFlow Migration 009: the server "alarm clock" (scheduler) and notifications in Buddy.
-- Once a minute the server runs its jobs (now: "клиент замолчал" scenarios; later: reminders about
-- meetings and webinars). One row per job: a lease (locked_until) so that two copies of the server
-- never run the same job at once, and the last run / last error for the support panel.
-- Works on SQLite and PostgreSQL.

CREATE TABLE IF NOT EXISTS scheduler_jobs (
  name TEXT PRIMARY KEY,
  locked_until TIMESTAMP,
  locked_by TEXT,
  last_started_at TIMESTAMP,
  last_finished_at TIMESTAMP,
  last_error TEXT,
  last_result TEXT,
  runs INTEGER NOT NULL DEFAULT 0
);

-- Notifications inside the app (owner's decision: every notification comes through Buddy first,
-- then the same text goes to Telegram if the person allowed the bot to write). start_param = where
-- the notification leads (the same as the bot button: I_<projectId>, <slug>, S_support...).
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  start_param TEXT,
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);

-- postgres-only:begin
ALTER TABLE scheduler_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
