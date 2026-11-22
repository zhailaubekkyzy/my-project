-- SmartFlow Migration 033: «Бизнес-режим 2.0», шаг 4 — шаблон как продукт (решения владелицы 21–22 нояб.).
--  - Шаблоны (готовые воронки) публикуются сразу, без проверки командой; команда только скрывает по жалобе.
--    То, что ждало проверки, публикуется (status 'review' → 'published').
--  - seller_project_id: кто продаёт шаблон — AI-продавец автора, с которым эксперт переписывается до покупки
--    (решает автор: этот же продавец, другой свой или купленный); пусто — без переписки.
--  - video_url: видео-презентация шаблона (ссылка).
--  - product_id: шаблон сам попадает в Мозг автора — продуктом его бизнеса (название, описание, результат, цена).
--  - Купленный шаблон становится новым AI-продавцом эксперта (уже созданные работают дальше) — это делает сервер.
-- Works on SQLite and PostgreSQL.

ALTER TABLE ready_funnels ADD COLUMN seller_project_id TEXT;
ALTER TABLE ready_funnels ADD COLUMN video_url TEXT;
ALTER TABLE ready_funnels ADD COLUMN product_id TEXT;

UPDATE ready_funnels SET status = 'published', reviewed_at = COALESCE(reviewed_at, submitted_at) WHERE status = 'review';
