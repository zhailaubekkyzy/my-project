-- SmartFlow Migration 013: people write to each other inside SmartFlow.
-- Owner's decisions (14 Oct.): anyone can be found and written to; the first message arrives with
-- the question «Принять / Заблокировать»; nothing to set up about who may write. The goal is that
-- people get used to talking here, so nobody is sent to Telegram. A person may hide from search.
-- Works on SQLite and PostgreSQL.

ALTER TABLE users ADD COLUMN hidden_from_search INTEGER NOT NULL DEFAULT 0;

-- One conversation per pair of people: user_a < user_b (sorted ids).
-- status: pending (the first messages are waiting for «Принять») | accepted | blocked
CREATE TABLE IF NOT EXISTS dm_threads (
  id TEXT PRIMARY KEY,
  user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  blocked_by TEXT,
  last_message TEXT,
  last_sender TEXT,
  last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  a_read_at TIMESTAMP,
  b_read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_a, user_b)
);
CREATE INDEX IF NOT EXISTS idx_dm_threads_a ON dm_threads(user_a, last_activity);
CREATE INDEX IF NOT EXISTS idx_dm_threads_b ON dm_threads(user_b, last_activity);
CREATE INDEX IF NOT EXISTS idx_dm_threads_started ON dm_threads(started_by, created_at);

-- kind: text | voice (up to 1.5 min) | photo | video (a round video up to 30 s); the file is in dm_files
CREATE TABLE IF NOT EXISTS dm_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  file_id TEXT,
  seconds INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Files of private conversations: only the two people of the conversation get them
-- (kept in the database for now, like voice messages; later — Supabase Storage)
CREATE TABLE IF NOT EXISTS dm_files (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  data_base64 TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_dm_files_sender ON dm_files(sender_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dm_messages_thread ON dm_messages(thread_id, created_at);

-- postgres-only:begin
ALTER TABLE dm_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE dm_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE dm_files ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
