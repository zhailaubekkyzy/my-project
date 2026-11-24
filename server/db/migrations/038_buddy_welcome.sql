-- SmartFlow Migration 038: первый экран новичка — Маркетплейс, Бадди пишет через минуту (решение владелицы 24 нояб.).
--  - users.buddy_welcome_due_at: когда Бадди поздоровается (ставится один раз — новичку, пришедшему без ссылки).
--  - users.buddy_welcome_sent_at: когда поздоровался (больше никогда).
-- Works on SQLite and PostgreSQL.
ALTER TABLE users ADD COLUMN buddy_welcome_due_at TIMESTAMP;
ALTER TABLE users ADD COLUMN buddy_welcome_sent_at TIMESTAMP;
