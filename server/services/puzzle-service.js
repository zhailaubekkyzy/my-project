// server/services/puzzle-service.js - «Пазл» AI-продавца («Бизнес-режим 2.0», шаг 3, решения владелицы 22 нояб.).
//  - Разрешения: что продавец берёт из Мозга — «о бизнесе» (knows_business), «обо мне» из Профиля (knows_profile);
//    продукт и материалы SI-мозга выбираются отдельно (product_id, consultant_materials).
//  - «Что дополнить»: чек-лист того, чего продавцу не хватает, чтобы отвечать без выдумок. Считается по настоящим
//    данным (что видит SI после передачи вниз — inheritance.withInherited), ничего не придумывает.
//  - Дополнения эксперта (seller_notes): «тема → как отвечать», в том числе из «Мне написали». Работают и с
//    купленной воронкой (они не часть методологии, которую заменяет воронка).
// Only the owner of the SI-продавец.
const crypto = require('crypto');
const db = require('../db');
const inheritance = require('./inheritance');
const { settingsOf } = require('./ai-settings');

const MAX_NOTES = 40;

class PuzzleError extends Error {
  constructor(message, status = 400, code = 'PUZZLE') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const text = (v, max) => String(v === undefined || v === null ? '' : v).replace(/\r/g, '').trim().slice(0, max);

async function ownProject(ownerId, projectId) {
  const project = await db.get('SELECT * FROM projects WHERE id = ? AND owner_id = ?', [String(projectId || ''), ownerId]);
  if (!project) throw new PuzzleError('SI-продавец не найден', 404, 'NOT_FOUND');
  return project;
}

function toNote(r) {
  return { id: r.id, stepId: r.step_id || null, topic: r.topic, text: r.text, source: r.source, createdAt: r.created_at };
}

async function notesOf(projectId) {
  return (await db.all('SELECT * FROM seller_notes WHERE project_id = ? ORDER BY created_at, id', [projectId])).map(toNote);
}

/**
 * The puzzle of one SI-продавец: permissions, «что дополнить» and the expert's additions.
 * Each item: { id, label, done, required, hint, place } — place tells the app where to fill it in.
 */
async function puzzle(ownerId, projectId) {
  const project = await ownProject(ownerId, projectId);
  const seen = await inheritance.withInherited(project);
  const s = settingsOf(project);
  const owner = await db.get('SELECT profile FROM users WHERE id = ?', [ownerId]);
  let profile = {};
  try { profile = JSON.parse((owner && owner.profile) || '{}'); } catch (e) { profile = {}; }
  const business = project.business_id ? await db.get('SELECT about FROM businesses WHERE id = ?', [project.business_id]) : null;
  const materials = await db.get('SELECT COUNT(*) AS n FROM consultant_materials WHERE project_id = ?', [project.id]);
  const priced = Boolean(seen.price_label) || ['free', 'on_request'].includes(seen.price_mode);
  const sells = (project.cta_kind || 'buy') === 'buy' && seen.price_mode !== 'free';
  const items = [
    { id: 'offer', label: 'Что продаёт: продукт или оффер', done: Boolean(seen.offer), required: true, place: 'product',
      hint: 'Привяжите продукт из Мозга или напишите оффер в карточке.' },
    { id: 'price', label: 'Цена', done: priced, required: true, place: 'card',
      hint: 'Сумма, «бесплатно» или «по запросу» — в продукте или в карточке.' },
    { id: 'payment', label: 'Ссылка на оплату', done: Boolean(seen.payment_url), required: sells, place: 'card',
      hint: 'Куда клиент платит — в продукте или в карточке.' },
    { id: 'business', label: 'О бизнесе', done: Boolean(project.knows_business && business && business.about), required: false, place: 'business',
      hint: project.knows_business ? 'Расскажите в Мозге, что вы делаете и для кого.' : 'Выключено: включите «Знает о бизнесе».' },
    { id: 'profile', label: 'Обо мне (из Профиля)', done: Boolean(project.knows_profile && (profile.bio || profile.headline || profile.regalia || profile.results)), required: false, place: 'profile',
      hint: project.knows_profile ? 'Заполните Профиль: о себе, регалии, результаты.' : 'Выключено: включите «Знает обо мне», если хотите.' },
    { id: 'materials', label: 'Материалы SI-мозга', done: Number(materials.n) > 0, required: false, place: 'materials',
      hint: 'Программа, прайс, частые вопросы — SI будет отвечать по ним.' },
    { id: 'path', label: 'Путь клиента: шаги или методология', done: Boolean((s.steps || []).length || s.methodology), required: false, place: 'methodology',
      hint: 'Как SI ведёт клиента к покупке.' },
    { id: 'access', label: 'Ссылка на доступ после оплаты', done: Boolean(seen.access_url), required: false, place: 'card',
      hint: 'Клиент получит её, когда вы подтвердите оплату.' }
  ];
  return {
    access: { knowsBusiness: Boolean(project.knows_business), knowsProfile: Boolean(project.knows_profile) },
    items,
    done: items.filter(i => i.done).length,
    total: items.length,
    missingRequired: items.filter(i => i.required && !i.done).map(i => i.id),
    notes: await notesOf(project.id),
    maxNotes: MAX_NOTES
  };
}

async function setAccess(ownerId, projectId, { knowsBusiness, knowsProfile } = {}) {
  const project = await ownProject(ownerId, projectId);
  const fields = [];
  const values = [];
  if (knowsBusiness !== undefined) { fields.push('knows_business = ?'); values.push(knowsBusiness ? 1 : 0); }
  if (knowsProfile !== undefined) { fields.push('knows_profile = ?'); values.push(knowsProfile ? 1 : 0); }
  if (fields.length) await db.run(`UPDATE projects SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [...values, project.id]);
  return puzzle(ownerId, projectId);
}

function cleanNote(input = {}) {
  const topic = text(input.topic, 120);
  const body = text(input.text, 1500);
  if (!topic) throw new PuzzleError('Напишите тему: о чём спрашивают клиенты', 400, 'NO_TOPIC');
  if (!body) throw new PuzzleError('Напишите, как отвечать', 400, 'NO_TEXT');
  return { topic, text: body, step_id: text(input.stepId, 64) || null };
}

async function addNote(ownerId, projectId, input) {
  const project = await ownProject(ownerId, projectId);
  const n = cleanNote(input);
  const count = await db.get('SELECT COUNT(*) AS n FROM seller_notes WHERE project_id = ?', [project.id]);
  if (Number(count.n) >= MAX_NOTES) throw new PuzzleError(`Дополнений может быть до ${MAX_NOTES} — объедините похожие`, 409, 'LIMIT');
  await db.run(
    'INSERT INTO seller_notes (id, project_id, step_id, topic, text, source) VALUES (?, ?, ?, ?, ?, ?)',
    [`snt_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`, project.id, n.step_id, n.topic, n.text, input.source === 'inquiry' ? 'inquiry' : 'manual']
  );
  return puzzle(ownerId, projectId);
}

async function updateNote(ownerId, projectId, noteId, input) {
  const project = await ownProject(ownerId, projectId);
  const n = cleanNote(input);
  const res = await db.run(
    'UPDATE seller_notes SET topic = ?, text = ?, step_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?',
    [n.topic, n.text, n.step_id, String(noteId || ''), project.id]
  );
  if (!res.changes) throw new PuzzleError('Дополнение не найдено', 404, 'NOT_FOUND');
  return puzzle(ownerId, projectId);
}

async function deleteNote(ownerId, projectId, noteId) {
  const project = await ownProject(ownerId, projectId);
  await db.run('DELETE FROM seller_notes WHERE id = ? AND project_id = ?', [String(noteId || ''), project.id]);
  return puzzle(ownerId, projectId);
}

module.exports = { PuzzleError, MAX_NOTES, puzzle, setAccess, addNote, updateNote, deleteNote, notesOf };
