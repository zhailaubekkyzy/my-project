-- SmartFlow Migration 007: business and one assistant.
-- A business is the expert's company above their SI-sellers (projects): SI-sellers, clients and
-- conversations belong to it. Members are rows (one per person, role owner / assistant); the server
-- allows at most one assistant (business-service.js, MAX_ASSISTANTS). Every message gets an author
-- and its type, every dialog (a row in clients) a responsible: the SI or a person — the SI pause
-- is "responsible = person". Base for the event journal and the funnel (scenarios come later).
-- Works on SQLite and PostgreSQL. Existing data is moved into businesses at the end.

CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- One row per person. role: owner | assistant. status: active | removed (kept for history)
CREATE TABLE IF NOT EXISTS business_members (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  invited_by TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_business_members_user ON business_members(user_id, status);

ALTER TABLE projects ADD COLUMN business_id TEXT REFERENCES businesses(id);
ALTER TABLE clients ADD COLUMN business_id TEXT REFERENCES businesses(id);
ALTER TABLE conversations ADD COLUMN business_id TEXT REFERENCES businesses(id);
ALTER TABLE direct_inquiries ADD COLUMN business_id TEXT REFERENCES businesses(id);

-- Message author: si | client | owner | assistant (+ the person's id for owner / assistant)
ALTER TABLE conversations ADD COLUMN author_type TEXT;
ALTER TABLE conversations ADD COLUMN author_user_id TEXT;

-- Dialog responsible: 'si' or 'human' (+ which person). The SI answers only when it is 'si'.
ALTER TABLE clients ADD COLUMN responsible_type TEXT NOT NULL DEFAULT 'si';
ALTER TABLE clients ADD COLUMN responsible_user_id TEXT;

-- Funnel: not_finished (не дообщались) | talked (пообщались, но не купили) | waiting_human (ждут
-- человека) | bought (купили) | refused (отказ). The goal-offer of an SI-seller's funnel is
-- projects.offer; offer_answered_at = the client answered the offer ("пообщались").
ALTER TABLE clients ADD COLUMN funnel_status TEXT NOT NULL DEFAULT 'not_finished';
ALTER TABLE clients ADD COLUMN offer_answered_at TIMESTAMP;
ALTER TABLE clients ADD COLUMN funnel_updated_at TIMESTAMP;

-- Event journal: one row per action (client wrote, objection, handed to a person, booked, paid,
-- refused / left, SI paused / resumed...). "If…, then…" scenarios will run on these events.
CREATE TABLE IF NOT EXISTS client_events (
  id TEXT PRIMARY KEY,
  business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_user_id TEXT,
  data TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_client_events_client ON client_events(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_client_events_business ON client_events(business_id, type, created_at);

CREATE INDEX IF NOT EXISTS idx_projects_business ON projects(business_id);
CREATE INDEX IF NOT EXISTS idx_clients_business_funnel ON clients(business_id, funnel_status);
CREATE INDEX IF NOT EXISTS idx_conversations_business ON conversations(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_direct_inquiries_business ON direct_inquiries(business_id, status);

-- ---------- Move existing data into businesses ----------
-- A business appears when the expert turned an SI-seller on: accepted the Office terms
-- (profile.businessAgreedAt) or their SI-seller already talks to clients. Demo records stay out.
-- The same rule runs in code for later experts (business-service.js).
INSERT INTO businesses (id, owner_id)
  SELECT 'biz_' || u.id, u.id FROM users u
  WHERE u.is_demo = 0
    AND u.id NOT IN (SELECT owner_id FROM businesses)
    AND EXISTS (SELECT 1 FROM projects p WHERE p.owner_id = u.id AND p.is_demo = 0)
    AND (u.profile LIKE '%"businessAgreedAt":"%'
      OR EXISTS (SELECT 1 FROM clients c JOIN projects p ON p.id = c.project_id WHERE p.owner_id = u.id AND p.is_demo = 0));

INSERT INTO business_members (id, business_id, user_id, role, status)
  SELECT 'bm_' || b.owner_id, b.id, b.owner_id, 'owner', 'active' FROM businesses b
  WHERE NOT EXISTS (SELECT 1 FROM business_members m WHERE m.business_id = b.id AND m.user_id = b.owner_id);

-- SI-sellers, clients, conversations and "Мне написали" requests move into the owner's business
UPDATE projects SET business_id = (SELECT b.id FROM businesses b WHERE b.owner_id = projects.owner_id)
  WHERE business_id IS NULL AND is_demo = 0;
UPDATE clients SET business_id = (SELECT p.business_id FROM projects p WHERE p.id = clients.project_id)
  WHERE business_id IS NULL;
UPDATE conversations SET business_id = (SELECT p.business_id FROM projects p WHERE p.id = conversations.project_id)
  WHERE business_id IS NULL;
UPDATE direct_inquiries SET business_id = (SELECT p.business_id FROM projects p WHERE p.id = direct_inquiries.project_id)
  WHERE business_id IS NULL;

-- Authors of old messages: the SI, the client, or the expert (the owner) personally
UPDATE conversations SET author_type = 'si' WHERE sender = 'ai' AND author_type IS NULL;
UPDATE conversations SET author_type = 'client' WHERE sender = 'client' AND author_type IS NULL;
UPDATE conversations SET author_type = 'owner',
  author_user_id = (SELECT p.owner_id FROM projects p WHERE p.id = conversations.project_id)
  WHERE sender = 'expert_human' AND author_type IS NULL;

-- SI paused earlier (status human_needed) = the owner is responsible for the dialog.
-- From now on the pause lives only in responsible_type; status keeps new / active.
UPDATE clients SET responsible_type = 'human',
  responsible_user_id = (SELECT p.owner_id FROM projects p WHERE p.id = clients.project_id)
  WHERE status = 'human_needed';
UPDATE clients SET status = 'active' WHERE status = 'human_needed';
UPDATE clients SET funnel_status = 'waiting_human'
  WHERE id IN (SELECT client_id FROM direct_inquiries WHERE status = 'waiting');

-- postgres-only:begin
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_events ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
