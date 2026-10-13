-- SmartFlow Migration 011: voice messages from clients in the chat with an SI-seller.
-- Up to 1.5 minutes (owner's decision). The recording is kept here (small: ~32 kbit/s, about 400 KB for
-- 1.5 min) and is private: only the client and the people of the business can play it. The text the SI
-- answers to is the OpenAI transcript, saved in the message itself (conversations.text).
-- Later the files can move to Supabase Storage without changing the rest (voice-service.js).
-- Works on SQLite and PostgreSQL.

CREATE TABLE IF NOT EXISTS voice_messages (
  id TEXT PRIMARY KEY,
  business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  data_base64 TEXT NOT NULL,
  transcript TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_voice_messages_client ON voice_messages(client_id, created_at);

ALTER TABLE conversations ADD COLUMN voice_id TEXT;
ALTER TABLE conversations ADD COLUMN voice_seconds INTEGER;

-- postgres-only:begin
ALTER TABLE voice_messages ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
