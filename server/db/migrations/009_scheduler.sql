-- SmartFlow Migration 009: the server "alarm clock" (scheduler).
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

-- postgres-only:begin
ALTER TABLE scheduler_jobs ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
