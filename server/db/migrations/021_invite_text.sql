-- SmartFlow Migration 021: the person's own invitation text (Профиль → «Пригласить в SmartFlow»).
-- Empty = the standard text on the phone. Kept apart from users.profile: that one is rewritten on every profile save.
-- Works on SQLite and PostgreSQL.

ALTER TABLE users ADD COLUMN invite_text TEXT;
