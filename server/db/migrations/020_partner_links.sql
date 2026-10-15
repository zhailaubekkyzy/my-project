-- SmartFlow Migration 020: links with a traffic source and the partner programme (owner's decision 15 Oct.).
-- tracked_links: kind 'source' — a link to one SI-seller with the source the expert wrote ("Instagram"),
-- up to 3 per SI-seller; kind 'referral' — a person's own invitation to SmartFlow (one per person).
-- The code is in the Telegram start parameter (<slug>__<code> or R_<code>); the server reads it from the
-- signed sign-in data, so a visit cannot be faked. link_visits: who opened which link (once in 12 hours).
-- users.referred_by_link: the link that brought a new person (first sign-in only);
-- clients.source_link_id: the link a client of an SI-seller came by (first one). Works on SQLite and PostgreSQL.

CREATE TABLE IF NOT EXISTS tracked_links (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  label TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tracked_links_owner ON tracked_links(owner_user_id, kind);
CREATE INDEX IF NOT EXISTS idx_tracked_links_project ON tracked_links(project_id);

CREATE TABLE IF NOT EXISTS link_visits (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL REFERENCES tracked_links(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  is_new_user INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_link_visits_link ON link_visits(link_id, created_at);
CREATE INDEX IF NOT EXISTS idx_link_visits_user ON link_visits(user_id, created_at);

ALTER TABLE users ADD COLUMN referred_by_link TEXT;
ALTER TABLE clients ADD COLUMN source_link_id TEXT;
CREATE INDEX IF NOT EXISTS idx_users_referred ON users(referred_by_link);
CREATE INDEX IF NOT EXISTS idx_clients_source_link ON clients(source_link_id);

-- postgres-only:begin
ALTER TABLE tracked_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE link_visits ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
