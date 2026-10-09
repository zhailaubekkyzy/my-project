-- SmartFlow Migration 004: SI-consultant card for the Marketplace (each consultant has its own
-- offer and payment link) and complaints/suggestions sent to the SI-assistant.

ALTER TABLE projects ADD COLUMN offer TEXT;
ALTER TABLE projects ADD COLUMN description TEXT;
ALTER TABLE projects ADD COLUMN price_label TEXT;
-- The author's own payment link: SmartFlow does not take payments
ALTER TABLE projects ADD COLUMN payment_url TEXT;
ALTER TABLE projects ADD COLUMN trial_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN category TEXT NOT NULL DEFAULT 'sales';
-- Shown in the Marketplace only when the owner turns it on
ALTER TABLE projects ADD COLUMN is_listed INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_projects_listed ON projects(is_listed);
CREATE INDEX IF NOT EXISTS idx_clients_external ON clients(external_client_id);

-- postgres-only:begin
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
