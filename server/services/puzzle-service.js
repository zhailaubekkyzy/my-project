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
const spec = require('./puzzle-spec');

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
  const fpz = spec.funnelPuzzleOf(project);
  if (fpz) return funnelPuzzle(project, fpz);
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
    mode: 'own',
    access: { knowsBusiness: Boolean(project.knows_business), knowsProfile: Boolean(project.knows_profile) },
    items,
    done: items.filter(i => i.done).length,
    total: items.length,
    missingRequired: items.filter(i => i.required && !i.done).map(i => i.id),
    notes: await notesOf(project.id),
    maxNotes: MAX_NOTES
  };
}

// ---------------- The funnel author's puzzle (owner's decisions 22 Nov.) ----------------
// The pieces and their questions come from the author of the connected funnel. What is already in the
// expert's Brain is filled in by itself (the expert may change it); «Сохранить» at the bottom of a piece.
// The funnel starts selling only when the author's condition is met (puzzle-spec.releaseMet).

async function answersOf(projectId) {
  const rows = await db.all('SELECT question_id, answer FROM seller_answers WHERE project_id = ?', [projectId]);
  const out = {};
  for (const r of rows) out[r.question_id] = r.answer;
  return out;
}

function parseProfile(raw) {
  try { return JSON.parse(raw || '{}') || {}; } catch (e) { return {}; }
}

// What the Brain already has for each source of a question (as the expert typed it; empty — nothing)
async function brainValues(project) {
  const seen = await inheritance.withInherited({ ...project, knows_business: 1, knows_profile: 1 });
  const business = project.business_id ? await db.get('SELECT about, niche FROM businesses WHERE id = ?', [project.business_id]) : null;
  const product = project.product_id ? await db.get(`SELECT * FROM products WHERE id = ? AND status = 'active'`, [project.product_id]) : null;
  const owner = await db.get('SELECT profile FROM users WHERE id = ?', [project.owner_id]);
  const profile = parseProfile(owner && owner.profile);
  const v = {};
  v['business.about'] = (business && business.about) || '';
  v['business.niche'] = (business && business.niche) || '';
  for (const col of ['name', 'description', 'result', 'format', 'duration', 'price_label', 'installment', 'guarantee']) v[`product.${col}`] = (product && product[col]) || '';
  v['seller.payment_url'] = seen.payment_url || '';
  v['seller.access_url'] = seen.access_url || '';
  for (const key of ['headline', 'bio', 'regalia', 'results']) v[`profile.${key}`] = text(profile[key], 2000);
  for (const k of Object.keys(v)) v[k] = text(v[k], 2000);
  return v;
}

const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

async function funnelPuzzle(project, fpz) {
  const answers = await answersOf(project.id);
  const brainAccess = Number(project.funnel_brain_access) !== 0;
  const values = brainAccess ? await brainValues(project) : {};
  let funnel = {};
  try { funnel = JSON.parse(project.funnel_settings) || {}; } catch (e) { funnel = {}; }
  const items = fpz.pieces.map(p => {
    const done = spec.pieceDone(p, answers);
    const left = p.questions.filter(q => !text(answers[q.id], 4000)).length;
    return {
      id: p.id,
      label: p.title,
      required: p.required,
      done,
      place: 'piece',
      hint: done ? 'Собран. Ответы можно изменить.' : `${left} ${plural(left, 'вопрос', 'вопроса', 'вопросов')} — ответьте, и кусочек встанет на место.`,
      questions: p.questions.map(q => {
        const saved = text(answers[q.id], 4000);
        const prefill = !saved && q.source && q.source !== 'brain' ? (values[q.source] || '') : '';
        return { id: q.id, text: q.text, hint: q.hint, source: q.source, sourceLabel: q.source ? spec.SOURCES[q.source] : '', answer: saved, prefill };
      })
    };
  });
  return {
    mode: 'funnel',
    funnelTitle: funnel.title || '',
    access: { knowsBusiness: Boolean(project.knows_business), knowsProfile: Boolean(project.knows_profile), brain: brainAccess },
    items,
    done: items.filter(i => i.done).length,
    total: items.length,
    missingRequired: items.filter(i => i.required && !i.done).map(i => i.id),
    release: { text: spec.releaseText(fpz), met: spec.releaseMet(fpz, answers), released: Number(project.funnel_released) !== 0 },
    notes: await notesOf(project.id),
    maxNotes: MAX_NOTES
  };
}

// Answers go to the Brain too: an empty field of the business, the product, the Profile or the seller's
// card gets the answer (what the expert has there already is never overwritten); the rest becomes one
// Brain material «Ответы для воронки…» (replaced on every save), which the expert can give other sellers.
const WRITE_BACK = {
  business: { table: 'businesses', idOf: (p) => p.business_id, cols: ['about', 'niche'] },
  product: { table: 'products', idOf: (p) => p.product_id, cols: ['name', 'description', 'result', 'format', 'duration', 'price_label', 'installment', 'guarantee'] },
  seller: { table: 'projects', idOf: (p) => p.id, cols: ['payment_url', 'access_url'] }
};

async function writeToBrain(project, fpz, answers, values) {
  const loose = [];
  for (const piece of fpz.pieces) {
    for (const q of piece.questions) {
      const answer = text(answers[q.id], 2000);
      if (!answer) continue;
      const [kind, col] = String(q.source || '').split('.');
      if (q.source && q.source !== 'brain' && !values[q.source]) {
        try {
          if (kind === 'profile') {
            const owner = await db.get('SELECT profile FROM users WHERE id = ?', [project.owner_id]);
            const profile = parseProfile(owner && owner.profile);
            if (!text(profile[col], 2000)) await db.run('UPDATE users SET profile = ? WHERE id = ?', [JSON.stringify({ ...profile, [col]: answer.slice(0, 1000) }), project.owner_id]);
          } else if (WRITE_BACK[kind] && WRITE_BACK[kind].cols.includes(col) && WRITE_BACK[kind].idOf(project)) {
            const w = WRITE_BACK[kind];
            await db.run(`UPDATE ${w.table} SET ${col} = ? WHERE id = ? AND COALESCE(${col}, '') = ''`, [answer, w.idOf(project)]);
          }
        } catch (err) { console.warn('[SmartFlow puzzle] write to Brain failed:', err.message); }
        continue;
      }
      if (!q.source || q.source === 'brain') loose.push({ piece: piece.title, q: q.text, a: answer });
    }
  }
  const brain = require('./brain-service');
  let funnel = {};
  try { funnel = JSON.parse(project.funnel_settings) || {}; } catch (e) { funnel = {}; }
  try {
    if (project.puzzle_material_id) await brain.deleteMaterial(project.owner_id, project.puzzle_material_id);
    let materialId = null;
    if (loose.length) {
      const body = [`Ответы эксперта для воронки «${funnel.title || ''}» (SI-продавец «${project.name}»)`, '']
        .concat(loose.map(x => `${x.piece}. ${x.q}\n${x.a}\n`)).join('\n');
      const m = await brain.addMaterial(project.owner_id, {
        buffer: Buffer.from(body, 'utf8'), filename: 'answers.txt', title: `Ответы для воронки «${String(funnel.title || project.name).slice(0, 80)}»`,
        consultantIds: [], businessId: project.business_id || null
      });
      materialId = m && m.id;
    }
    await db.run('UPDATE projects SET puzzle_material_id = ? WHERE id = ?', [materialId, project.id]);
  } catch (err) {
    // The Brain is full or the material could not be read — the answers are still saved on the seller
    console.warn('[SmartFlow puzzle] answers material failed:', err.message);
  }
}

/** Starts or stops the bought funnel by the author's condition. Returns true when it has just started. */
async function checkRelease(project, fpz, answers) {
  const met = spec.releaseMet(fpz, answers);
  const was = Number(project.funnel_released) !== 0;
  if (met !== was) await db.run('UPDATE projects SET funnel_released = ? WHERE id = ?', [met ? 1 : 0, project.id]);
  return met && !was;
}

/**
 * «Сохранить» at the bottom of a piece: { answers: { questionId: text } }. An empty answer removes it.
 * Returns the puzzle plus saved: { pieceId, done, newlyDone, released }.
 */
async function savePiece(ownerId, projectId, pieceId, input = {}) {
  const project = await ownProject(ownerId, projectId);
  const fpz = spec.funnelPuzzleOf(project);
  if (!fpz) throw new PuzzleError('У этого SI-продавца нет пазла воронки', 404, 'NO_FUNNEL_PUZZLE');
  const piece = fpz.pieces.find(p => p.id === String(pieceId || ''));
  if (!piece) throw new PuzzleError('Кусочек не найден — обновите экран', 404, 'NOT_FOUND');
  const given = input.answers && typeof input.answers === 'object' ? input.answers : {};
  const before = await answersOf(project.id);
  const wasDone = spec.pieceDone(piece, before);
  const brainAccess = Number(project.funnel_brain_access) !== 0;
  const values = brainAccess ? await brainValues(project) : {};
  for (const q of piece.questions) {
    if (given[q.id] === undefined) continue;
    const answer = text(given[q.id], 2000);
    if (answer) {
      await db.run(
        `INSERT INTO seller_answers (project_id, question_id, piece_id, answer) VALUES (?, ?, ?, ?)
         ON CONFLICT (project_id, question_id) DO UPDATE SET answer = excluded.answer, piece_id = excluded.piece_id, updated_at = CURRENT_TIMESTAMP`,
        [project.id, q.id, piece.id, answer]
      );
    } else {
      await db.run('DELETE FROM seller_answers WHERE project_id = ? AND question_id = ?', [project.id, q.id]);
    }
  }
  const after = await answersOf(project.id);
  if (brainAccess) await writeToBrain(project, fpz, after, values);
  const released = await checkRelease(project, fpz, after);
  const done = spec.pieceDone(piece, after);
  return { ...(await puzzle(ownerId, projectId)), saved: { pieceId: piece.id, done, newlyDone: done && !wasDone, released } };
}

/**
 * «SI найдёт сам»: answers to the questions of a piece that point to the Brain's materials, found in the
 * materials of this seller. Only with the access to the Brain and OpenAI; nothing found — empty.
 */
async function suggest(ownerId, projectId, pieceId) {
  const project = await ownProject(ownerId, projectId);
  const fpz = spec.funnelPuzzleOf(project);
  const piece = fpz && fpz.pieces.find(p => p.id === String(pieceId || ''));
  if (!piece) throw new PuzzleError('Кусочек не найден — обновите экран', 404, 'NOT_FOUND');
  if (Number(project.funnel_brain_access) === 0) return { suggestions: {} };
  const answers = await answersOf(project.id);
  const wanted = piece.questions.filter(q => q.source === 'brain' && !text(answers[q.id], 4000));
  const siEngine = require('./si-engine');
  if (!wanted.length || !siEngine.isConfigured()) return { suggestions: {} };
  const brain = require('./brain-service');
  const pieces = await brain.contextFor(project.id, wanted.map(q => q.text).join('\n'));
  if (!pieces.length) return { suggestions: {} };
  const reply = await siEngine.callOpenAI([
    {
      role: 'system',
      content: [
        'Ты помогаешь эксперту заполнить анкету воронки по его собственным материалам.',
        'Отвечай на каждый вопрос только тем, что прямо есть в материалах, коротко и своими словами, от лица эксперта.',
        'Если в материалах ответа нет — пустая строка. Ничего не придумывай.',
        'Ответь только JSON {"answers": {"<id вопроса>": "<ответ>"}}.',
        '',
        'Материалы:',
        ...pieces.map(p => `[${p.title}] ${String(p.text).slice(0, 1500)}`)
      ].join('\n')
    },
    { role: 'user', content: wanted.map(q => `${q.id}: ${q.text}`).join('\n') }
  ], { response_format: { type: 'json_object' } });
  let parsed = {};
  try { parsed = reply ? JSON.parse(reply) : {}; } catch (e) { parsed = {}; }
  const out = {};
  for (const q of wanted) {
    const a = text(parsed && parsed.answers && parsed.answers[q.id], 2000);
    if (a) out[q.id] = a;
  }
  return { suggestions: out };
}

/** The bought funnel asked for the access to the Brain: the expert's answer (may be changed later). */
async function setBrainAccess(ownerId, projectId, on) {
  const project = await ownProject(ownerId, projectId);
  await db.run('UPDATE projects SET funnel_brain_access = ? WHERE id = ?', [on ? 1 : 0, project.id]);
  return puzzle(ownerId, projectId);
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

module.exports = { PuzzleError, MAX_NOTES, puzzle, setAccess, addNote, updateNote, deleteNote, notesOf, answersOf, savePiece, suggest, setBrainAccess, checkRelease };
