-- SmartFlow Migration 018: the language of a person for the client screens and messages (RU/EN, owner's
-- decision 15 Oct.). lang = chosen in Профиль → «Язык» (empty = automatic); tg_lang = Telegram's
-- language_code from the last sign-in. Russian for ru, kk, uk and neighbours, English for the rest.
-- Works on SQLite and PostgreSQL.

ALTER TABLE users ADD COLUMN lang TEXT;
ALTER TABLE users ADD COLUMN tg_lang TEXT;
