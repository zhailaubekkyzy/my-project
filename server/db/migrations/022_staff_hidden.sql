-- SmartFlow Migration 022: the support team hid an SI-seller from the Marketplace.
-- While it is 1 the expert cannot show the SI-seller in the Marketplace again; only the team can.
-- (Turning an SI-seller off is projects.status = 'paused': the expert cannot change status at all.)
-- Works on SQLite and PostgreSQL.

ALTER TABLE projects ADD COLUMN hidden_by_staff INTEGER DEFAULT 0;
