// server/services/slug-service.js - The short link of an SI-seller («aliya-nutri») and its old addresses.
// The expert may change the address; the old one stays in project_slug_aliases so every link already
// sent still opens the same SI-seller (owner's decision 21 Nov.).
const db = require('../db');

// Latin letters, digits and single hyphens; starts with a letter; 3–32 characters.
// Lowercase only: the uppercase prefixes of other links (C_, P_, R_…) can never clash,
// and no «__» (that separates the source code in «<slug>__<code>» links).
const SLUG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

class SlugError extends Error {
  constructor(message, status = 400, code = 'BAD_SLUG') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function validate(slug) {
  if (slug.length < 3 || slug.length > 32 || !SLUG_RE.test(slug)) {
    throw new SlugError('Адрес — от 3 до 32 латинских букв и цифр, можно дефис между словами. Например: aliya-nutri');
  }
}

/**
 * The project's current slug for any of its addresses (current or old); null if none.
 */
async function canonical(slug) {
  const s = normalize(slug);
  if (!s) return null;
  const direct = await db.get('SELECT slug FROM projects WHERE slug = ?', [s]);
  if (direct) return direct.slug;
  const alias = await db.get(
    'SELECT p.slug FROM project_slug_aliases a JOIN projects p ON p.id = a.project_id WHERE a.slug = ?', [s]);
  return alias ? alias.slug : null;
}

/**
 * Give the project a new address; the old one keeps working. Returns the new slug.
 */
async function change(project, value) {
  const slug = normalize(value);
  if (slug === project.slug) return slug;
  validate(slug);
  const taken = await db.get('SELECT id FROM projects WHERE slug = ? AND id <> ?', [slug, project.id]);
  const takenOld = await db.get('SELECT project_id FROM project_slug_aliases WHERE slug = ? AND project_id <> ?', [slug, project.id]);
  if (taken || takenOld) throw new SlugError('Такой адрес уже занят. Попробуйте другой, например с вашим именем.', 409, 'SLUG_TAKEN');
  // Back to one of its own old addresses: that one is no longer «old»
  await db.run('DELETE FROM project_slug_aliases WHERE slug = ? AND project_id = ?', [slug, project.id]);
  const keepOld = await db.get('SELECT slug FROM project_slug_aliases WHERE slug = ?', [project.slug]);
  if (!keepOld) await db.run('INSERT INTO project_slug_aliases (slug, project_id) VALUES (?, ?)', [project.slug, project.id]);
  await db.run('UPDATE projects SET slug = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [slug, project.id]);
  return slug;
}

module.exports = { SLUG_RE, SlugError, canonical, change, validate };
