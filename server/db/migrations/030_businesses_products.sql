-- SmartFlow Migration 030: «Бизнес-режим 2.0», шаг 1 — основа данных (решения владелицы 21–22 нояб.).
--  - До 3 бизнесов у одного человека (было: один, UNIQUE owner_id). Бизнес, который был у человека, становится
--    главным (is_primary): всё, что уже работает, продолжает работать с ним.
--  - У бизнеса — описание и ниша (идут в сведения AI-продавца).
--  - Продукты внутри бизнеса; AI-продавец может быть привязан к продукту (projects.product_id).
--  - SI-мозг принадлежит бизнесу (brain_materials.business_id; был только у человека).
-- Данные передаются вниз: бизнес → продукт → продавец; заполненное у продавца главнее (server/services/inheritance.js).
-- Перед вливанием — резервная копия businesses, projects, brain_materials (docs/ARCHITECTURE.md, «Бизнес-режим 2.0»).
-- Works on SQLite and PostgreSQL.

-- 1. UNIQUE owner_id goes away. SQLite cannot drop a constraint: the table is rebuilt (same columns and ids, the
--    tables that point to it stay as they are). PostgreSQL drops the constraint by its standard name.
-- sqlite-only:begin
PRAGMA foreign_keys = OFF;
CREATE TABLE businesses_new (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO businesses_new (id, owner_id, name, created_at, updated_at) SELECT id, owner_id, name, created_at, updated_at FROM businesses;
DROP TABLE businesses;
ALTER TABLE businesses_new RENAME TO businesses;
PRAGMA foreign_keys = ON;
-- sqlite-only:end
-- postgres-only:begin
ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_owner_id_key;
-- postgres-only:end

ALTER TABLE businesses ADD COLUMN about TEXT NOT NULL DEFAULT '';
ALTER TABLE businesses ADD COLUMN niche TEXT;
ALTER TABLE businesses ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0;
-- Every business that exists now was the only one of its owner: it is the main one
UPDATE businesses SET is_primary = 1;
-- One main business per person (two «first» businesses cannot appear at the same moment)
CREATE UNIQUE INDEX IF NOT EXISTS ux_businesses_primary ON businesses(owner_id) WHERE is_primary = 1;
CREATE INDEX IF NOT EXISTS idx_businesses_owner ON businesses(owner_id, created_at);

-- 2. Products of a business. price_mode: fixed | free | on_request (как на карточке AI-продавца).
--    status: active | archived (an archived product is not offered to AI-продавцы any more).
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT '',
  duration TEXT NOT NULL DEFAULT '',
  price_mode TEXT NOT NULL DEFAULT 'fixed',
  price_label TEXT,
  installment TEXT NOT NULL DEFAULT '',
  guarantee TEXT NOT NULL DEFAULT '',
  payment_url TEXT,
  access_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_products_business ON products(business_id, status, position);

ALTER TABLE projects ADD COLUMN product_id TEXT REFERENCES products(id) ON DELETE SET NULL;

-- 3. SI-мозг belongs to a business; materials of people who already have a business go to it,
--    the rest join it when the business appears (business-service.attachOwnerData)
ALTER TABLE brain_materials ADD COLUMN business_id TEXT REFERENCES businesses(id) ON DELETE SET NULL;
UPDATE brain_materials SET business_id = (SELECT b.id FROM businesses b WHERE b.owner_id = brain_materials.owner_id AND b.is_primary = 1)
WHERE business_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_brain_materials_business ON brain_materials(business_id);

-- postgres-only:begin
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
