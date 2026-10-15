-- SmartFlow Migration 016: reviews of real clients (owner's decision 15 Oct.).
-- Only a client marked "Купили" leaves a review, one per SI-seller (they may edit it): a rating 1–5 and
-- a text. Everybody sees only a short name ("Анна К."). The expert may answer, never delete. The team
-- hides a bad review after a complaint (support panel, hidden_at). Works on SQLite and PostgreSQL.

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  business_id TEXT REFERENCES businesses(id) ON DELETE SET NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  reply_text TEXT,
  reply_at TIMESTAMP,
  hidden_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- One review per person per SI-seller
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_author ON reviews(project_id, author_user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_project ON reviews(project_id, created_at);

-- postgres-only:begin
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
