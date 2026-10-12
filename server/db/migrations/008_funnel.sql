-- SmartFlow Migration 008: funnel statuses renamed by the owner, objections, contact consent.
-- "Пообщались, но не купили" is now "Есть возражения" (key objections instead of talked);
-- "Не дообщались" is now "Не дошли до конца воронки" (key not_finished stays).
-- The last objection of a client is kept on the client row for the funnel list; every objection
-- is also a row in client_events. Works on SQLite and PostgreSQL.

UPDATE clients SET funnel_status = 'objections' WHERE funnel_status = 'talked';

ALTER TABLE clients ADD COLUMN last_objection TEXT;
ALTER TABLE clients ADD COLUMN objection_at TIMESTAMP;
-- The client agreed that the expert gets their contacts (asked later in the chat; empty = no)
ALTER TABLE clients ADD COLUMN contact_consent_at TIMESTAMP;

-- Funnel list: business + status, newest activity first, filter 7 / 30 days
CREATE INDEX IF NOT EXISTS idx_clients_business_funnel_activity ON clients(business_id, funnel_status, last_activity);
