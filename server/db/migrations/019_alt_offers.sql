-- SmartFlow Migration 019: alternative offers above the chat (owner's decision 15 Oct.).
-- When a client objects in the chat with an SI-seller, up to 3 SI-sellers of other experts from the
-- Marketplace that may solve the client's problem are shown above the chat (all listed SI-sellers take
-- part, the same niche included: the goal is the client's solution). The picked ones are kept on the
-- client row: ids (JSON), the objection they answer, when picked. Works on SQLite and PostgreSQL.

ALTER TABLE clients ADD COLUMN alt_offers TEXT;
ALTER TABLE clients ADD COLUMN alt_offers_at TIMESTAMP;
