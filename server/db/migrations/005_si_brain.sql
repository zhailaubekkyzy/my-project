-- SmartFlow Migration 005: SI-brain — the expert's materials (only the text taken from files)
-- and which SI-consultants may use them. Works on SQLite and PostgreSQL.

-- One uploaded file or pasted text. The original file is not stored.
CREATE TABLE IF NOT EXISTS brain_materials (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL,
  char_count INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- The material's text in pieces of ~1200 characters. embedding: the piece's meaning as numbers
-- (OpenAI, base64 of float32) for search by meaning; NULL until OpenAI has processed it.
CREATE TABLE IF NOT EXISTS brain_chunks (
  id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL REFERENCES brain_materials(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  embedding TEXT
);

-- Which materials each SI-consultant knows
CREATE TABLE IF NOT EXISTS consultant_materials (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  material_id TEXT NOT NULL REFERENCES brain_materials(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, material_id)
);

CREATE INDEX IF NOT EXISTS idx_brain_materials_owner ON brain_materials(owner_id);
CREATE INDEX IF NOT EXISTS idx_brain_chunks_material ON brain_chunks(material_id, position);
CREATE INDEX IF NOT EXISTS idx_consultant_materials_material ON consultant_materials(material_id);

-- postgres-only:begin
ALTER TABLE brain_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultant_materials ENABLE ROW LEVEL SECURITY;
-- postgres-only:end
