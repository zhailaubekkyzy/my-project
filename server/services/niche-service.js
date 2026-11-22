// server/services/niche-service.js - Ниши Маркетплейса (решения владелицы 22 нояб., миграция 034).
// Как в маркетплейсах: крупные разделы (список ниже, в коде) и ниши внутри (таблица niches).
//  - Человек пишет свою нишу: такая уже есть (без разницы в регистре, «ё»/«е», лишних пробелах) — берётся она;
//    нет — создаётся в выбранном разделе и сразу видна всем в фильтрах (без проверки).
//  - Команда может переименовать нишу или объединить похожие («нутрициолог» → «Нутрициология»): у объединённой
//    merged_into, её SI-продавцы и шаблоны переходят в главную.
// Ниша есть у SI-продавца (projects.niche_id) и у шаблона (ready_funnels.niche_id).
const crypto = require('crypto');
const db = require('../db');

const SECTIONS = [
  { id: 'health', label: 'Здоровье и питание', icon: 'heart-pulse' },
  { id: 'sport', label: 'Спорт и фитнес', icon: 'dumbbell' },
  { id: 'psychology', label: 'Психология и отношения', icon: 'brain' },
  { id: 'beauty', label: 'Красота и стиль', icon: 'sparkles' },
  { id: 'business', label: 'Бизнес и карьера', icon: 'briefcase' },
  { id: 'marketing', label: 'Маркетинг и продажи', icon: 'megaphone' },
  { id: 'finance', label: 'Финансы', icon: 'wallet' },
  { id: 'education', label: 'Образование и языки', icon: 'graduation-cap' },
  { id: 'kids', label: 'Дети и родители', icon: 'baby' },
  { id: 'creative', label: 'Творчество и хобби', icon: 'palette' },
  { id: 'it', label: 'IT и технологии', icon: 'laptop' },
  { id: 'spirit', label: 'Духовность и саморазвитие', icon: 'sun' },
  { id: 'home', label: 'Дом и недвижимость', icon: 'home' },
  { id: 'other', label: 'Другое', icon: 'layout-grid' }
];
const SECTION_IDS = new Set(SECTIONS.map(s => s.id));
const MAX_NAME = 60;

class NicheError extends Error {
  constructor(message, status = 400, code = 'NICHE') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const cleanName = (v) => String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
const keyOf = (v) => cleanName(v).toLowerCase().replace(/ё/g, 'е');
// The first letter capital, the rest as the person wrote it («SMM» stays «SMM»)
const prettyName = (v) => { const n = cleanName(v); return n ? n.charAt(0).toUpperCase() + n.slice(1) : n; };

function toNiche(r) {
  return r ? { id: r.id, name: r.name, section: r.section } : null;
}

// A merged niche leads to the one it was merged into
async function live(row, depth = 0) {
  if (!row || !row.merged_into || depth > 5) return row;
  return live(await db.get('SELECT * FROM niches WHERE id = ?', [row.merged_into]), depth + 1);
}

async function byId(id) {
  if (!id) return null;
  return toNiche(await live(await db.get('SELECT * FROM niches WHERE id = ?', [String(id)])));
}

/**
 * The niche a person wrote: an existing one with the same name, otherwise a new one in the section
 * (an unknown section — «Другое»). Empty name — null (no niche).
 */
async function resolve(userId, name, section) {
  const key = keyOf(name);
  if (!key) return null;
  if (key.length < 2) throw new NicheError('Название ниши слишком короткое');
  const found = await db.get('SELECT * FROM niches WHERE name_key = ?', [key]);
  if (found) return toNiche(await live(found));
  const id = `nch_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const sec = SECTION_IDS.has(section) ? section : 'other';
  try {
    await db.run('INSERT INTO niches (id, section, name, name_key, created_by) VALUES (?, ?, ?, ?, ?)', [id, sec, prettyName(name), key, userId || null]);
  } catch (err) {
    // Someone created the same niche a moment ago
    const again = await db.get('SELECT * FROM niches WHERE name_key = ?', [key]);
    if (again) return toNiche(await live(again));
    throw err;
  }
  return toNiche(await db.get('SELECT * FROM niches WHERE id = ?', [id]));
}

// Templates published before niches had only the words: link them once (cheap: only rows without a niche)
async function linkOldTemplates() {
  const rows = await db.all(`SELECT id, niche, author_id FROM ready_funnels WHERE niche_id IS NULL AND COALESCE(niche, '') <> '' LIMIT 200`);
  for (const r of rows) {
    const n = await resolve(r.author_id, r.niche, 'other');
    if (n) await db.run('UPDATE ready_funnels SET niche_id = ? WHERE id = ?', [n.id, r.id]);
  }
}

/**
 * Sections with their niches for the filters: how many listed SI-продавцы (experts) and published templates
 * each niche has. All niches go (also empty ones — for suggestions while typing).
 */
async function catalog() {
  await linkOldTemplates();
  const rows = await db.all(`
    SELECT n.id, n.section, n.name,
      (SELECT COUNT(*) FROM projects p WHERE p.niche_id = n.id AND p.is_listed = 1 AND p.status = 'active' AND p.is_demo = 0
         AND COALESCE(p.hidden_by_staff, 0) = 0 AND COALESCE(p.offer, '') <> '') AS experts,
      (SELECT COUNT(*) FROM ready_funnels f WHERE f.niche_id = n.id AND f.status = 'published') AS templates
    FROM niches n WHERE n.merged_into IS NULL ORDER BY n.name`);
  const niches = rows.map(r => ({ id: r.id, section: r.section, name: r.name, experts: Number(r.experts) || 0, templates: Number(r.templates) || 0 }));
  niches.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return { sections: SECTIONS, niches };
}

// ---------- The team ----------
async function rename(id, name, section) {
  const row = await db.get('SELECT * FROM niches WHERE id = ? AND merged_into IS NULL', [String(id || '')]);
  if (!row) throw new NicheError('Ниша не найдена', 404, 'NOT_FOUND');
  const key = keyOf(name);
  if (key.length < 2) throw new NicheError('Напишите название ниши');
  const other = await db.get('SELECT id FROM niches WHERE name_key = ? AND id <> ?', [key, row.id]);
  if (other) throw new NicheError('Такая ниша уже есть — объедините их', 409, 'EXISTS');
  await db.run('UPDATE niches SET name = ?, name_key = ?, section = ? WHERE id = ?', [prettyName(name), key, SECTION_IDS.has(section) ? section : row.section, row.id]);
  return toNiche(await db.get('SELECT * FROM niches WHERE id = ?', [row.id]));
}

/** «нутрициолог» into «Нутрициология»: its SI-продавцы and templates move, the old name leads to the main one. */
async function merge(id, intoId) {
  const from = await db.get('SELECT * FROM niches WHERE id = ? AND merged_into IS NULL', [String(id || '')]);
  const into = await db.get('SELECT * FROM niches WHERE id = ? AND merged_into IS NULL', [String(intoId || '')]);
  if (!from || !into) throw new NicheError('Ниша не найдена', 404, 'NOT_FOUND');
  if (from.id === into.id) throw new NicheError('Выберите другую нишу');
  const sellers = await db.run('UPDATE projects SET niche_id = ? WHERE niche_id = ?', [into.id, from.id]);
  const templates = await db.run('UPDATE ready_funnels SET niche_id = ? WHERE niche_id = ?', [into.id, from.id]);
  await db.run('UPDATE niches SET merged_into = ? WHERE id = ?', [into.id, from.id]);
  return { into: toNiche(into), sellers: sellers.changes || 0, templates: templates.changes || 0 };
}

module.exports = { SECTIONS, NicheError, keyOf, resolve, byId, catalog, rename, merge, linkOldTemplates };
