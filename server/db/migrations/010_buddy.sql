-- SmartFlow Migration 010: Buddy as a conversation (owner's decision: Buddy is a personal helper
-- for every day — plans, reminders, later the calendar; notifications are Buddy's messages).
-- The Buddy chat lives in `notifications` (009): sender 'buddy' (notifications, replies, reminders)
-- or 'user' (what the person wrote). Reminders the person asked for wait in buddy_reminders; the
-- alarm clock sends them as Buddy's messages (and to Telegram). Works on SQLite and PostgreSQL.

ALTER TABLE notifications ADD COLUMN sender TEXT NOT NULL DEFAULT 'buddy';
ALTER TABLE notifications ADD COLUMN kind TEXT NOT NULL DEFAULT 'notice';

-- The person's time zone from the phone (minutes east of UTC, e.g. +300 for Almaty), for
-- "напомни завтра в 9" and "сегодня"
ALTER TABLE users ADD COLUMN tz_offset_minutes INTEGER;

CREATE TABLE IF NOT EXISTS buddy_reminders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  remind_at TIMESTAMP NOT NULL,
  sent_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_buddy_reminders_due ON buddy_reminders(sent_at, cancelled_at, remind_at);
CREATE INDEX IF NOT EXISTS idx_buddy_reminders_user ON buddy_reminders(user_id, remind_at);

-- postgres-only:begin
ALTER TABLE buddy_reminders ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
