-- SmartFlow Migration 035: «Бизнес-режим 2.0», шаг 5 — конструктор шаблона (решения владелицы 22 нояб.).
-- Автор проверяет шаблон на демо-бизнесах SmartFlow (server/services/demo-businesses.js): в своём проверочном чате
-- («Вы (проверка)», entry 'self') выбирает пример бизнеса, и SI отвечает так, будто шаблон купил этот бизнес.
-- clients.demo_id — какой пример выбран в этом проверочном чате (у настоящих клиентов всегда пусто).
-- Бриф шаблона хранится в методологии продавца (custom_ai_settings.brief), отдельная таблица не нужна.
-- Works on SQLite and PostgreSQL.

ALTER TABLE clients ADD COLUMN demo_id TEXT;
