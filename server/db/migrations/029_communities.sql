-- SmartFlow Migration 029: communities in «Комьюнити», part 1 (owner's decisions 21 Nov., like Skool).
-- Only a business profile creates them (as many as it wants); anyone joins.
--  - public (in the catalog) or hidden (by its link only); the team may hide one (hidden_by_staff);
--  - entry: free · by request (1–3 questions, the owner or a moderator accepts) · paid by the expert's own
--    link («Я оплатил(а)» → the owner confirms), once or every month (30 days, then renewal the same way);
--  - a feed: posts with text and a photo, topics, pinned posts, announcements; comments with replies; likes;
--  - who posts: everyone, or only the owner and moderators (up to 3);
--  - notifications to the phone only, not to Buddy (as groups); no notification about likes.
-- Part 2 (later): courses, points, levels, leaderboard, reminders.
-- Works on SQLite and PostgreSQL.

-- questions / categories: JSON arrays of strings
-- changed_at moves on any change members should see at once (the app's «пульс» watches it)
CREATE TABLE IF NOT EXISTS communities (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  about TEXT NOT NULL DEFAULT '',
  rules TEXT NOT NULL DEFAULT '',
  cover_media_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'public',
  join_mode TEXT NOT NULL DEFAULT 'free',
  price_type TEXT,
  price_label TEXT,
  payment_url TEXT,
  questions TEXT NOT NULL DEFAULT '[]',
  posting TEXT NOT NULL DEFAULT 'all',
  categories TEXT NOT NULL DEFAULT '[]',
  hidden_by_staff INTEGER NOT NULL DEFAULT 0,
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_communities_owner ON communities(owner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_communities_catalog ON communities(visibility, hidden_by_staff, created_at);

-- status: requested (answers wait for the owner) · paying (said «Я оплатил(а)», waits for the owner) ·
--   active · removed (by the owner/moderator: may ask again) · banned (cannot come back)
-- paid_until: a monthly payment is valid until then (after it the member sees the «О сообществе» page and
--   «Я оплатил(а) за следующий месяц»); renewal_*: said they paid the next month
-- read_at: the feed was last opened (new posts after it are «new»)
CREATE TABLE IF NOT EXISTS community_members (
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active',
  answers TEXT,
  payment_note TEXT,
  decline_reason TEXT,
  paid_until TIMESTAMP,
  renewal_requested_at TIMESTAMP,
  renewal_note TEXT,
  read_at TIMESTAMP,
  joined_at TIMESTAMP,
  last_active_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (community_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_community_members_user ON community_members(user_id, status);
CREATE INDEX IF NOT EXISTS idx_community_members_status ON community_members(community_id, status);

CREATE TABLE IF NOT EXISTS community_posts (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT,
  text TEXT NOT NULL,
  file_id TEXT,
  announcement INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  deleted_at TIMESTAMP,
  last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_community_posts_feed ON community_posts(community_id, created_at);

-- parent_id: the comment this one answers (replies are one level deep under a comment)
CREATE TABLE IF NOT EXISTS community_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id TEXT,
  text TEXT NOT NULL,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_community_comments_post ON community_comments(post_id, created_at);

-- A like on a post or a comment (target_id), one per person
CREATE TABLE IF NOT EXISTS community_likes (
  target_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (target_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_community_likes_community ON community_likes(community_id, created_at);

-- Photos of posts: only members get them (a paid community stays paid); in the database for now
CREATE TABLE IF NOT EXISTS community_files (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  data_base64 TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_community_files_sender ON community_files(sender_id, created_at);

-- postgres-only:begin
ALTER TABLE communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_files ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
