-- SmartFlow Migration 027: ready-made funnels, part 2 — buying, the marketer's confirmation and
-- connecting a funnel to the expert's SI-seller (owner's decisions 21 Nov.).
--
-- funnel_purchases: one row per expert and funnel.
--   status: 'pending' (the expert said they paid / asked to connect on a percentage — waiting for
--   the marketer), 'active' (the marketer confirmed), 'declined' (the payment did not come; with a
--   reason), 'ended' (a percentage stopped by the marketer, with a reason).
--   snapshot: the funnel as it was published when the expert bought it (later edits of the funnel
--   do not change what was bought).
--   paid_until: for a monthly payment — until when it is paid; after that the SI-seller goes back to
--   the expert's own methodology by itself. renewal_*: the expert said they paid the next month.
--   project_id / applied_at: which SI-seller the funnel is connected to (one at a time).
-- projects.funnel_settings / funnel_until / funnel_purchase_id: the connected funnel. The SI uses it
--   instead of the expert's own methodology while funnel_until is empty or in the future. The texts
--   are never sent to the expert's phone (the marketer's work); the expert's own methodology stays
--   as it was and works again when the funnel is disconnected or not renewed.
-- Works on SQLite and PostgreSQL.

CREATE TABLE IF NOT EXISTS funnel_purchases (
  id TEXT PRIMARY KEY,
  funnel_id TEXT NOT NULL,
  expert_id TEXT NOT NULL,
  marketer_id TEXT NOT NULL,
  price_type TEXT NOT NULL,
  price_label TEXT,
  snapshot TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT,
  reason TEXT,
  paid_until TIMESTAMP,
  renewal_requested_at TIMESTAMP,
  renewal_note TEXT,
  project_id TEXT,
  applied_at TIMESTAMP,
  confirmed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_funnel_purchases_expert ON funnel_purchases (expert_id);
CREATE INDEX IF NOT EXISTS idx_funnel_purchases_marketer ON funnel_purchases (marketer_id, status);
CREATE INDEX IF NOT EXISTS idx_funnel_purchases_funnel ON funnel_purchases (funnel_id, status);

ALTER TABLE projects ADD COLUMN funnel_settings TEXT;
ALTER TABLE projects ADD COLUMN funnel_until TIMESTAMP;
ALTER TABLE projects ADD COLUMN funnel_purchase_id TEXT;

-- postgres-only:begin
ALTER TABLE funnel_purchases ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
