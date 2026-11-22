-- SmartFlow Migration 032: пазл от автора воронки (решения владелицы 22 нояб.).
-- Какие кусочки нужны для воронки, решает её автор (маркетолог): у каждой воронки свой набор, и у каждого
-- кусочка — вопросы, чтобы достать нужное из эксперта. Набор лежит в методологии автора
-- (custom_ai_settings.puzzle) и замораживается вместе с воронкой (ready_funnels.snapshot → projects.funnel_settings).
--  - seller_answers: ответы эксперта на вопросы кусочков (свои у каждого продавца). Что есть в Мозге,
--    подставляется само; эксперт может изменить. Ответы идут и в Мозг (пустые поля бизнеса, продукта, Профиля;
--    остальное — материалом «Ответы для воронки…», projects.puzzle_material_id).
--  - funnel_released: купленная воронка включается, только когда выполнено условие автора (например, собраны
--    все обязательные кусочки). До этого продавец работает по своей методологии. 1 — как раньше (без пазла).
--  - funnel_brain_access: при подключении воронка спрашивает доступ к Мозгу (1 — да, 0 — нет).
-- Works on SQLite and PostgreSQL.

CREATE TABLE IF NOT EXISTS seller_answers (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  piece_id TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, question_id)
);

ALTER TABLE projects ADD COLUMN funnel_released INTEGER NOT NULL DEFAULT 1;
ALTER TABLE projects ADD COLUMN funnel_brain_access INTEGER NOT NULL DEFAULT 1;
ALTER TABLE projects ADD COLUMN puzzle_material_id TEXT;

-- postgres-only:begin
ALTER TABLE seller_answers ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
