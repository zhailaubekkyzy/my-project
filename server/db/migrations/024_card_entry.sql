-- SmartFlow Migration 024: the expert's own offer button and price mode on the card; how the client came.
-- Owner's decisions 20 Nov.: two ways in — the Marketplace card (offer, price, a button the expert
-- chooses) for warm people and the chat link for cold ones; every step is counted for the expert and us.
--
-- projects.price_mode: 'fixed' (price_label), 'free' («Бесплатно»), 'on_request' («Цена по запросу»).
--   NULL = as before: 'fixed'.
-- projects.cta_kind: the card button — 'buy' (as before), 'free', 'book', 'price', 'ask'.
--   cta_label: the expert's own words on the button (empty = the standard label of the kind).
-- clients.entry: how the client came — 'card' (the Marketplace card or its link), 'link' (the chat
--   link), 'source' (a link with a source label). NULL for clients from before this migration.
-- card_views: who opened a card (once per person, with the number of opens) — for the expert's numbers.
-- Works on SQLite and PostgreSQL.

ALTER TABLE projects ADD COLUMN price_mode TEXT;
ALTER TABLE projects ADD COLUMN cta_kind TEXT;
ALTER TABLE projects ADD COLUMN cta_label TEXT;
ALTER TABLE clients ADD COLUMN entry TEXT;

CREATE TABLE IF NOT EXISTS card_views (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  views INTEGER DEFAULT 1,
  first_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, user_id)
);

-- postgres-only:begin
ALTER TABLE card_views ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
