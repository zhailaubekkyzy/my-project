-- SmartFlow Migration 017: broadcasts of an SI-seller (announcements: an event, news, a promotion).
-- Owner's decisions: the expert writes in words whom and what to send, SI picks the clients and drafts
-- the text, nothing is sent before the expert confirms; the assistant prepares, the owner approves.
-- A broadcast lands in the client's chat with the SI-seller (inside SmartFlow) and Buddy/Telegram tell
-- them about it. Recipients are a snapshot taken when sending starts; the alarm clock sends them
-- in portions, only 9:00–21:00 by the client's time. Works on SQLite and PostgreSQL.

-- status: draft | pending_approval | sending | sent | cancelled
CREATE TABLE IF NOT EXISTS broadcasts (
  id TEXT PRIMARY KEY,
  business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  request TEXT,
  audience TEXT NOT NULL DEFAULT '{}',
  text TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  finished_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_broadcasts_project ON broadcasts(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_broadcasts_status ON broadcasts(status);

-- status: pending | sent | skipped (opted out or refused meanwhile)
CREATE TABLE IF NOT EXISTS broadcast_recipients (
  broadcast_id TEXT NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMP,
  PRIMARY KEY (broadcast_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_pending ON broadcast_recipients(status, broadcast_id);

-- The client said "Не присылать рассылки" in the chat with this SI-seller (empty = gets them)
ALTER TABLE clients ADD COLUMN broadcasts_off_at TIMESTAMP;
-- A broadcast message in the chat is marked, so the client sees "Рассылка · не присылать"
ALTER TABLE conversations ADD COLUMN is_broadcast INTEGER NOT NULL DEFAULT 0;

-- postgres-only:begin
ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcast_recipients ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
