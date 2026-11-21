-- SmartFlow Migration 028: group conversations in «Чаты» (owner's decisions 21 Nov.).
-- A group is a plain conversation of several people; anyone can create one (a community with a feed,
-- courses and points is a different thing, made only by a business profile — later).
--  - up to 50 people; the creator adds people, each gets an invitation «Вступить / Отказаться»;
--    there is also an invitation link (invite_code);
--  - roles: owner (one), admin (up to 2), member;
--  - text, voice (1.5 min), photo, round video (30 s), a reply to a message, one pinned message;
--  - reactions; the author of the message gets a notification about them;
--  - the only SI here: a short summary of the conversation on request.
-- Works on SQLite and PostgreSQL.

-- changed_at moves on any change people should see at once (message, reaction, pin, members):
-- the app's «пульс» watches it. last_activity is the last message (order of the chat list).
CREATE TABLE IF NOT EXISTS chat_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  photo_media_id TEXT,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invite_code TEXT NOT NULL UNIQUE,
  pinned_message_id TEXT,
  last_message TEXT,
  last_sender TEXT,
  last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_groups_owner ON chat_groups(owner_id, created_at);

-- status: invited (waiting for «Вступить») | active | removed (by an admin: cannot come back by the link)
-- notified_at: told about new messages and has not opened the group since (one notification per unread run;
-- cleared when the person opens the group or writes there)
CREATE TABLE IF NOT EXISTS chat_group_members (
  group_id TEXT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'invited',
  invited_by TEXT,
  muted INTEGER NOT NULL DEFAULT 0,
  read_at TIMESTAMP,
  notified_at TIMESTAMP,
  joined_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_group_members_user ON chat_group_members(user_id, status);

-- kind: text | voice | photo | video; reply_to: the message this one answers; deleted_at: removed
-- by its author or an admin (the text is erased)
CREATE TABLE IF NOT EXISTS chat_group_messages (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  file_id TEXT,
  seconds INTEGER,
  reply_to TEXT,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_group_messages_group ON chat_group_messages(group_id, created_at);

-- Files of a group: only its active members get them (in the database for now, like private ones)
CREATE TABLE IF NOT EXISTS chat_group_files (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  data_base64 TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_group_files_sender ON chat_group_files(sender_id, created_at);

-- One reaction of a person on a message (a new one replaces the old)
CREATE TABLE IF NOT EXISTS chat_group_reactions (
  message_id TEXT NOT NULL REFERENCES chat_group_messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_group_reactions_group ON chat_group_reactions(group_id);

-- «Кратко» by SI: when a person asked (a daily limit protects the OpenAI bill)
CREATE TABLE IF NOT EXISTS chat_group_summaries (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_group_summaries_user ON chat_group_summaries(user_id, created_at);

-- postgres-only:begin
ALTER TABLE chat_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_group_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_group_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_group_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_group_summaries ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
