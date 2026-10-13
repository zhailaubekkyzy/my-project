-- SmartFlow Migration 012: the calendar of a business — free windows and meetings with clients.
-- Owner's decisions: the expert sets free windows for himself and for the assistant; the client books
-- right in the chat with the SI-seller; a permanent Zoom link per person; no double booking; who may
-- cancel / reschedule and how many hours before — the expert decides. Empty fields for the call's
-- recording, transcript and analysis are kept for later. Works on SQLite and PostgreSQL.

-- Rules of the business. Windows are in the business's time (tz_offset_minutes east of UTC).
CREATE TABLE IF NOT EXISTS calendar_settings (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  tz_offset_minutes INTEGER NOT NULL DEFAULT 300,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  client_can_cancel INTEGER NOT NULL DEFAULT 1,
  client_can_reschedule INTEGER NOT NULL DEFAULT 1,
  change_hours_before INTEGER NOT NULL DEFAULT 3,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Who takes meetings: the owner and the assistant, each with own windows and Zoom link.
-- windows: JSON [{ "day": 1, "from": "10:00", "to": "13:00" }], day 0 = Sunday … 6 = Saturday
CREATE TABLE IF NOT EXISTS calendar_hosts (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 1,
  zoom_url TEXT,
  windows TEXT NOT NULL DEFAULT '[]',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, user_id)
);

-- status: booked | cancelled | rescheduled | done | no_show
CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  host_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at TIMESTAMP NOT NULL,
  ends_at TIMESTAMP NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked',
  zoom_url TEXT,
  booked_by TEXT,
  cancelled_by TEXT,
  cancelled_at TIMESTAMP,
  reminded_at TIMESTAMP,
  recording_url TEXT,
  transcript TEXT,
  analysis TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_meetings_business ON meetings(business_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_meetings_client ON meetings(client_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_meetings_reminders ON meetings(status, reminded_at, starts_at);
-- No double booking: one booked meeting per person per start time (also checked for overlaps in code)
CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_no_double ON meetings(host_user_id, starts_at) WHERE status = 'booked';

-- postgres-only:begin
ALTER TABLE calendar_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
