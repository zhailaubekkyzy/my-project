-- SmartFlow Migration 026: ready-made funnels from marketers (owner's decisions 20–21 Nov.), part 1 —
-- publishing, the team's review and the catalogue for experts in the Office.
--
-- Anyone can publish a funnel built in their own SI-seller; at the start the team approves every one.
-- The funnel is frozen at submission (snapshot): the team approves exactly what experts will get,
-- and a later edit goes back to review. Experts see the description, the steps and the result before
-- buying — never the full instructions and scenario texts (they are the marketer's work).
-- The marketer chooses how they are paid: once, monthly, or a percentage of sales; the payment goes
-- by the marketer's own link (SmartFlow does not take payments yet). Buying is part 2.
--
-- status: 'review' (waiting for the team), 'published' (in the catalogue), 'rejected' (with a reason),
--   'hidden' (taken down by the team), 'withdrawn' (removed by the author).
-- price_type: 'once' | 'monthly' | 'percent'; price_label — the marketer's words («15 000 ₸», «10% с продаж»).
-- snapshot: JSON { goal, instructions, methodology, steps, scenarios } of the SI-seller at submission.
-- The legacy tables funnel_templates / funnel_subscriptions (first version, demo data) are not used here.
-- Works on SQLite and PostgreSQL.

CREATE TABLE IF NOT EXISTS ready_funnels (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  source_project_id TEXT,
  title TEXT NOT NULL,
  niche TEXT,
  description TEXT,
  result TEXT,
  price_type TEXT NOT NULL,
  price_label TEXT,
  payment_url TEXT,
  snapshot TEXT,
  status TEXT NOT NULL DEFAULT 'review',
  review_note TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMP,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ready_funnels_status ON ready_funnels (status, submitted_at);
CREATE INDEX IF NOT EXISTS idx_ready_funnels_author ON ready_funnels (author_id);

-- postgres-only:begin
ALTER TABLE ready_funnels ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
