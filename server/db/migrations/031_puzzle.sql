-- SmartFlow Migration 031: «Бизнес-режим 2.0», шаг 3 — «пазл» (решения владелицы 22 нояб.).
-- Из Мозга AI-продавец берёт только то, на что эксперт дал разрешение:
--  - knows_business: сведения «о бизнесе» (по умолчанию да — так работало с шага 1);
--  - knows_profile: «обо мне» из Профиля — чем занимаюсь, о себе, регалии, результаты (по умолчанию нет).
--  Продукт (projects.product_id) и материалы SI-мозга (consultant_materials) уже выбираются у каждого продавца.
-- Дополнения эксперта (seller_notes): «тема → как отвечать», эксперт дописывает по мере проблем из аналитики
-- («Мне написали», о чём спрашивают). Они свои у продавца и работают и с купленной воронкой; step_id — к какому
-- шагу относится (пусто — ко всему разговору). Позже автор шаблона увидит только темы, без имён и внутрянки.
-- Works on SQLite and PostgreSQL.

ALTER TABLE projects ADD COLUMN knows_business INTEGER NOT NULL DEFAULT 1;
ALTER TABLE projects ADD COLUMN knows_profile INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS seller_notes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  step_id TEXT,
  topic TEXT NOT NULL,
  text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_seller_notes_project ON seller_notes(project_id, created_at);

-- postgres-only:begin
ALTER TABLE seller_notes ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
