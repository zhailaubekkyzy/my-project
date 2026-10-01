-- SmartFlow Migration 001: Initial Core Schema
-- Supports both SQLite (local/testing) and PostgreSQL (Supabase/production)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  username TEXT,
  avatar_url TEXT,
  roles TEXT NOT NULL DEFAULT '["expert"]',
  status TEXT NOT NULL DEFAULT 'active',
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  metadata TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS platform_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL DEFAULT 'founder_free_100',
  status TEXT NOT NULL DEFAULT 'active',
  trial_ends_at TIMESTAMP,
  current_period_starts_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  current_period_ends_at TIMESTAMP,
  auto_renew INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS funnel_templates (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  niche TEXT NOT NULL,
  tagline TEXT,
  description TEXT,
  monthly_price INTEGER NOT NULL DEFAULT 9900,
  currency TEXT NOT NULL DEFAULT 'RUB',
  trial_days INTEGER NOT NULL DEFAULT 14,
  badge TEXT,
  ai_clone_settings TEXT,
  steps TEXT,
  is_published INTEGER NOT NULL DEFAULT 1,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS funnel_subscriptions (
  id TEXT PRIMARY KEY,
  expert_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  marketer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  funnel_template_id TEXT NOT NULL REFERENCES funnel_templates(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  price INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RUB',
  trial_ends_at TIMESTAMP,
  current_period_starts_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  current_period_ends_at TIMESTAMP,
  auto_renew INTEGER NOT NULL DEFAULT 1,
  custom_payment_url TEXT,
  cancellation_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id TEXT REFERENCES funnel_templates(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  niche TEXT,
  custom_ai_settings TEXT,
  pricing_options TEXT,
  stats TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Future collaborator / marketer invitation table
CREATE TABLE IF NOT EXISTS project_members (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'collaborator',
  permissions TEXT NOT NULL DEFAULT '[]',
  invited_by TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, user_id)
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  external_client_id TEXT,
  name TEXT NOT NULL,
  username TEXT,
  avatar_url TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  funnel_step TEXT NOT NULL DEFAULT 'step-1',
  deal_value INTEGER DEFAULT 0,
  tags TEXT DEFAULT '[]',
  qualification_answers TEXT DEFAULT '{}',
  last_message TEXT,
  last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,
  text TEXT NOT NULL,
  is_voice INTEGER NOT NULL DEFAULT 0,
  voice_duration TEXT,
  voice_transcription TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS direct_inquiries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  lead_name TEXT NOT NULL,
  lead_username TEXT,
  lead_avatar TEXT,
  reason TEXT NOT NULL,
  urgency TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'waiting',
  last_user_voice_transcription TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_auth_identities_user ON auth_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_clients_project ON clients(project_id);
CREATE INDEX IF NOT EXISTS idx_conversations_client ON conversations(client_id);
CREATE INDEX IF NOT EXISTS idx_direct_inquiries_project ON direct_inquiries(project_id);
