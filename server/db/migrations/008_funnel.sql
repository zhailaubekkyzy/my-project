-- SmartFlow Migration 008: funnel statuses renamed by the owner, objections, contact, payment receipts.
-- "Пообщались, но не купили" is now "Есть возражения" (key objections instead of talked);
-- "Не дообщались" is now "Не дошли до конца воронки" (key not_finished stays).
-- The last objection of a client is kept on the client row for the funnel list; every objection
-- is also a row in client_events. Also: shared contact, access link after payment, payment receipts.
-- Works on SQLite and PostgreSQL.

UPDATE clients SET funnel_status = 'objections' WHERE funnel_status = 'talked';

ALTER TABLE clients ADD COLUMN last_objection TEXT;
ALTER TABLE clients ADD COLUMN objection_at TIMESTAMP;
-- The client shared their contact with the expert (Telegram's own "Поделиться контактом", signed
-- by Telegram): the moment of consent and the phone number. Empty = not shared.
ALTER TABLE clients ADD COLUMN contact_consent_at TIMESTAMP;
ALTER TABLE clients ADD COLUMN contact_phone TEXT;

-- Funnel list: business + status, newest activity first, filter 7 / 30 days
CREATE INDEX IF NOT EXISTS idx_clients_business_funnel_activity ON clients(business_id, funnel_status, last_activity);

-- Access link the expert gives after a confirmed payment (sent to the client only after a person
-- of the business confirmed the receipt; the SI never sees or gives it)
ALTER TABLE projects ADD COLUMN access_url TEXT;

-- Payment receipts (photo or PDF) a client sends in the chat. Private: only the client and the
-- people of the business see them (never through the public /api/media). status: new | confirmed | rejected
CREATE TABLE IF NOT EXISTS payment_receipts (
  id TEXT PRIMARY KEY,
  business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  data_base64 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  reviewed_by TEXT,
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_client ON payment_receipts(client_id, created_at);

-- postgres-only:begin
ALTER TABLE payment_receipts ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
