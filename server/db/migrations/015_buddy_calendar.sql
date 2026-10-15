-- SmartFlow Migration 015: Buddy's calendar "for the whole life" (owner's decision 15 Oct.).
-- The person tells Buddy plans in words ("в четверг в 18:00 ужин с Айнур"); a plan is a row in
-- buddy_reminders with kind 'plan' and the time it happens (starts_at). A reminder is sent only if
-- the person asked for it (notify = 1, at remind_at). Old rows are reminders that happen at remind_at.
-- Meetings with experts come from `meetings` (012) and are shown next to the plans.
-- Works on SQLite and PostgreSQL.

ALTER TABLE buddy_reminders ADD COLUMN kind TEXT NOT NULL DEFAULT 'reminder';
ALTER TABLE buddy_reminders ADD COLUMN starts_at TIMESTAMP;
ALTER TABLE buddy_reminders ADD COLUMN notify INTEGER NOT NULL DEFAULT 1;

UPDATE buddy_reminders SET starts_at = remind_at WHERE starts_at IS NULL;

-- The calendar: one person's plans by day
CREATE INDEX IF NOT EXISTS idx_buddy_reminders_calendar ON buddy_reminders(user_id, starts_at);
