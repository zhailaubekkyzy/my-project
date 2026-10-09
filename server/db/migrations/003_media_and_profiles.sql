-- SmartFlow Migration 003: photos (users and SI-consultants) and profile-landing data.
-- Works on SQLite and PostgreSQL. Projects are the SI-consultants of the platform.

-- Uploaded images. Stored in the database for now (base64 text works on both drivers);
-- server/services/media-service.js is the one place to switch to object storage later.
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  data_base64 TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_media_owner ON media(owner_id);

-- Photo the user uploaded themselves (wins over the Telegram photo, which stays in avatar_url)
ALTER TABLE users ADD COLUMN photo_media_id TEXT;
-- Profile-landing fields as JSON: bio, regalia, results, links, offer button, language
ALTER TABLE users ADD COLUMN profile TEXT;

-- SI-consultant photo and role shown to clients ("SI-консультант", "SI-помощник", ...)
ALTER TABLE projects ADD COLUMN photo_media_id TEXT;
ALTER TABLE projects ADD COLUMN role_title TEXT;

-- postgres-only:begin
-- Supabase: keep the public Supabase API closed. The server owns the tables and bypasses RLS.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE direct_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE media ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
