-- SmartFlow Migration 014: steps of an SI-seller's funnel.
-- The expert builds the client's path in the methodology (custom_ai_settings.steps: знакомство →
-- материал → вопросы → встреча или оффер → оплата). Every client is on one step: step_id (empty =
-- the first step) and the moment they came to it. The SI moves the client forward when the step's
-- "пройден, когда…" is met; a person of the business can move them by hand. Every move is also a
-- 'step_reached' row in client_events. The old column funnel_step ('step-1') is not used.
-- Works on SQLite and PostgreSQL.

ALTER TABLE clients ADD COLUMN step_id TEXT;
ALTER TABLE clients ADD COLUMN step_at TIMESTAMP;

-- Funnel screen "По шагам": clients of one SI-seller per step
CREATE INDEX IF NOT EXISTS idx_clients_project_step ON clients(project_id, step_id);
