-- SmartFlow Migration 025: the expert chooses a short link of the SI-seller («aliya-nutri»).
-- The old address keeps working: links already sent to clients, posted in Instagram or printed
-- still open the same chat. One row per old address.
-- Works on SQLite and PostgreSQL.

CREATE TABLE IF NOT EXISTS project_slug_aliases (
  slug TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_project_slug_aliases_project ON project_slug_aliases(project_id);

-- postgres-only:begin
ALTER TABLE project_slug_aliases ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
