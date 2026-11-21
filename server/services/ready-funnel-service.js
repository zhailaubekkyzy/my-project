// server/services/ready-funnel-service.js - Ready-made funnels from marketers (migration 026), part 1:
// publishing from one's own SI-seller → the team's review → the catalogue for experts in the Office.
// Owner's decisions 20–21 Nov.:
//  - anyone can publish; at the start the team approves every funnel (a safety review);
//  - the marketer chooses the payment: once, monthly or a percentage of sales, by their own link;
//  - before buying the expert sees the description, the steps and the result — not the full texts;
//  - funnels live in the Office only: clients never see them.
// The funnel is frozen at submission: the team approves exactly what experts will get.
const crypto = require('crypto');
const db = require('../db');
const funnelService = require('./funnel-service');
const { mediaUrl } = require('./media-service');
const { cleanText, cleanUrl } = require('./profile-service');

const PRICE_TYPES = ['once', 'monthly', 'percent'];
const PRICE_TYPE_LABELS = { once: 'Разовая оплата', monthly: 'Подписка в месяц', percent: 'Процент с продаж' };
const STATUSES = ['review', 'published', 'rejected', 'hidden', 'withdrawn'];
const MAX_PER_AUTHOR = 10;
const MIN_STEPS = 2;

class FunnelError extends Error {
  constructor(message, status = 400, code = 'bad_request') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function parseJson(str, fallback = {}) {
  if (!str) return fallback;
  if (typeof str === 'object') return str;
  try { return JSON.parse(str); } catch (err) { return fallback; }
}

function sqlNow() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function authorName(row) {
  const profile = parseJson(row.author_profile);
  return (profile.displayName || row.author_display_name || '').trim() || 'Маркетолог';
}

// What the SI-seller does, frozen at submission
function snapshotOf(project) {
  const s = parseJson(project.custom_ai_settings);
  const steps = funnelService.normalizeSteps(s.steps);
  return {
    goal: cleanText(s.goal, 300),
    instructions: String(s.instructions || '').slice(0, 4000),
    methodology: String(s.methodology || '').slice(0, 3000),
    steps,
    scenarios: funnelService.normalizeScenarios(s.scenarios, steps)
  };
}

// What an expert sees before buying: the steps (name + what happens on it), the number of scenarios.
// Not the instructions, the methodology text, scenario texts or step materials.
function publicSteps(snapshot) {
  return (snapshot.steps || []).map(st => ({ title: st.title, goal: st.goal || '' }));
}

const SELECT = `
  SELECT f.*, u.display_name AS author_display_name, u.profile AS author_profile,
         u.photo_media_id AS author_photo_media_id, u.avatar_url AS author_avatar_url, u.support_code AS author_support_code
  FROM ready_funnels f
  LEFT JOIN users u ON u.id = f.author_id`;

/**
 * view: 'public' (the catalogue — no texts, no payment link yet: buying comes in part 2),
 *       'author' (their own: status and the team's note), 'staff' (everything, for the review).
 */
function toFunnel(row, view = 'public') {
  const snapshot = parseJson(row.snapshot);
  const result = {
    id: row.id,
    title: row.title,
    niche: row.niche || '',
    description: row.description || '',
    result: row.result || '',
    priceType: row.price_type,
    priceTypeLabel: PRICE_TYPE_LABELS[row.price_type] || '',
    priceLabel: row.price_label || '',
    steps: publicSteps(snapshot),
    scenarioCount: (snapshot.scenarios || []).length,
    author: {
      id: row.author_id,
      name: authorName(row),
      photoUrl: mediaUrl(row.author_photo_media_id) || row.author_avatar_url || null
    },
    publishedAt: row.status === 'published' ? (row.reviewed_at || row.submitted_at) : null
  };
  if (view === 'author' || view === 'staff') {
    Object.assign(result, {
      status: row.status,
      reviewNote: row.review_note || '',
      reviewedAt: row.reviewed_at || null,
      submittedAt: row.submitted_at,
      sourceProjectId: row.source_project_id || null,
      paymentUrl: row.payment_url || null
    });
  }
  if (view === 'staff') {
    result.author.supportCode = row.author_support_code || null;
    result.snapshot = snapshot;
  }
  return result;
}

function readFields(body) {
  const title = cleanText(body.title, 80);
  const niche = cleanText(body.niche, 60);
  const description = cleanText(body.description, 1500);
  const result = cleanText(body.result, 600);
  const priceType = PRICE_TYPES.includes(body.priceType) ? body.priceType : null;
  const priceLabel = cleanText(body.priceLabel, 60);
  const rawUrl = String(body.paymentUrl || '').trim();
  const paymentUrl = rawUrl && /^https:\/\//i.test(rawUrl) ? cleanUrl(rawUrl) : null;

  if (!title) throw new FunnelError('Напишите название воронки');
  if (!niche) throw new FunnelError('Напишите, для какой ниши воронка');
  if (!description) throw new FunnelError('Опишите, что это за воронка и как она ведёт клиента');
  if (!result) throw new FunnelError('Напишите, какой результат получит эксперт');
  if (!priceType) throw new FunnelError('Выберите, как вам платят: разово, подписка или процент с продаж');
  if (!priceLabel) throw new FunnelError(priceType === 'percent' ? 'Напишите процент, например «10% с продаж»' : 'Напишите цену, например «15 000 ₸»');
  if (rawUrl && !paymentUrl) throw new FunnelError('Ссылка на оплату должна начинаться с https://');
  if (priceType !== 'percent' && !paymentUrl) throw new FunnelError('Добавьте свою ссылку на оплату — деньги идут вам напрямую');
  return { title, niche, description, result, priceType, priceLabel, paymentUrl };
}

async function ownProject(userId, projectId) {
  const project = projectId ? await db.get('SELECT * FROM projects WHERE id = ?', [projectId]) : null;
  if (!project || project.owner_id !== userId) throw new FunnelError('Выберите своего SI-продавца', 404, 'not_found');
  const snapshot = snapshotOf(project);
  if (snapshot.steps.length < MIN_STEPS) {
    throw new FunnelError(`Сначала добавьте в методологию SI-продавца хотя бы ${MIN_STEPS} шага воронки`);
  }
  return { project, snapshot };
}

async function getRow(id) {
  return id ? db.get(`${SELECT} WHERE f.id = ?`, [id]) : null;
}

async function submit(userId, body = {}) {
  const fields = readFields(body);
  const { project, snapshot } = await ownProject(userId, body.projectId);
  const mine = await db.get(
    `SELECT COUNT(*) AS count FROM ready_funnels WHERE author_id = ? AND status <> 'withdrawn'`,
    [userId]
  );
  if (Number(mine && mine.count) >= MAX_PER_AUTHOR) {
    throw new FunnelError(`Можно опубликовать до ${MAX_PER_AUTHOR} воронок. Уберите старую, чтобы добавить новую`);
  }
  const id = `rf_${crypto.randomBytes(8).toString('hex')}`;
  await db.run(
    `INSERT INTO ready_funnels (id, author_id, source_project_id, title, niche, description, result,
       price_type, price_label, payment_url, snapshot, status, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'review', ?)`,
    [id, userId, project.id, fields.title, fields.niche, fields.description, fields.result,
      fields.priceType, fields.priceLabel, fields.paymentUrl, JSON.stringify(snapshot), sqlNow()]
  );
  return getRow(id);
}

async function authorRow(userId, id) {
  const row = await getRow(id);
  if (!row || row.author_id !== userId || row.status === 'withdrawn') throw new FunnelError('Воронка не найдена', 404, 'not_found');
  return row;
}

// Any change goes back to the team: experts must get exactly what was approved.
// projectId given → the steps and scenarios are taken again from that SI-seller.
async function update(userId, id, body = {}) {
  const row = await authorRow(userId, id);
  const fields = readFields(body);
  const { project, snapshot } = await ownProject(userId, body.projectId || row.source_project_id);
  await db.run(
    `UPDATE ready_funnels SET source_project_id = ?, title = ?, niche = ?, description = ?, result = ?,
       price_type = ?, price_label = ?, payment_url = ?, snapshot = ?, status = 'review', review_note = NULL,
       reviewed_by = NULL, reviewed_at = NULL, submitted_at = ?, updated_at = ?
     WHERE id = ?`,
    [project.id, fields.title, fields.niche, fields.description, fields.result, fields.priceType,
      fields.priceLabel, fields.paymentUrl, JSON.stringify(snapshot), sqlNow(), sqlNow(), id]
  );
  return getRow(id);
}

async function withdraw(userId, id) {
  await authorRow(userId, id);
  await db.run(`UPDATE ready_funnels SET status = 'withdrawn', updated_at = ? WHERE id = ?`, [sqlNow(), id]);
}

async function listMine(userId) {
  const rows = await db.all(
    `${SELECT} WHERE f.author_id = ? AND f.status <> 'withdrawn' ORDER BY f.submitted_at DESC`,
    [userId]
  );
  return rows.map(r => toFunnel(r, 'author'));
}

// The catalogue: published funnels, newest first; q searches the name, niche and description
async function catalogue({ q = '', niche = '' } = {}) {
  const rows = await db.all(`${SELECT} WHERE f.status = 'published' ORDER BY f.reviewed_at DESC LIMIT 200`);
  const query = String(q || '').trim().toLowerCase();
  const nicheQuery = String(niche || '').trim().toLowerCase();
  const list = rows.map(r => toFunnel(r, 'public')).filter(f => {
    if (nicheQuery && f.niche.toLowerCase() !== nicheQuery) return false;
    if (!query) return true;
    return [f.title, f.niche, f.description, f.result].some(v => v.toLowerCase().includes(query));
  });
  const niches = [...new Set(rows.map(r => (r.niche || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  return { funnels: list, niches };
}

// One funnel: published ones for everyone signed in, any of their own for the author
async function getForUser(userId, id) {
  const row = await getRow(id);
  if (!row) return null;
  if (row.author_id === userId && row.status !== 'withdrawn') return toFunnel(row, 'author');
  if (row.status === 'published') return toFunnel(row, 'public');
  return null;
}

// ---------- The team ----------
async function listForStaff(status = 'review') {
  const filter = STATUSES.includes(status) ? status : 'review';
  const rows = await db.all(`${SELECT} WHERE f.status = ? ORDER BY f.submitted_at ASC LIMIT 200`, [filter]);
  return rows.map(r => toFunnel(r, 'staff'));
}

async function countForReview() {
  const row = await db.get(`SELECT COUNT(*) AS count FROM ready_funnels WHERE status = 'review'`);
  return Number(row && row.count) || 0;
}

async function getForStaff(id) {
  const row = await getRow(id);
  return row ? toFunnel(row, 'staff') : null;
}

const DECISIONS = {
  approve: { from: ['review', 'hidden'], to: 'published', needsNote: false },
  reject: { from: ['review'], to: 'rejected', needsNote: true },
  hide: { from: ['published'], to: 'hidden', needsNote: true }
};

/**
 * The team's decision. Returns { before, after } rows. A reason is required to reject or hide:
 * the author sees it and can fix the funnel.
 */
async function decide(staffUserId, id, decision, rawNote = '') {
  const rule = DECISIONS[decision];
  if (!rule) throw new FunnelError('Неизвестное решение');
  const before = await getRow(id);
  if (!before || before.status === 'withdrawn') throw new FunnelError('Воронка не найдена', 404, 'not_found');
  if (!rule.from.includes(before.status)) throw new FunnelError('Воронка уже в другом статусе — обновите экран', 409, 'conflict');
  const note = cleanText(rawNote, 600);
  if (rule.needsNote && !note) throw new FunnelError('Напишите причину — автор увидит её и сможет исправить');
  const changed = await db.run(
    `UPDATE ready_funnels SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
     WHERE id = ? AND status = ?`,
    [rule.to, note || null, staffUserId, sqlNow(), sqlNow(), id, before.status]
  );
  if (changed && changed.changes === 0) throw new FunnelError('Воронка уже в другом статусе — обновите экран', 409, 'conflict');
  return { before, after: await getRow(id) };
}

module.exports = {
  PRICE_TYPES,
  PRICE_TYPE_LABELS,
  STATUSES,
  MAX_PER_AUTHOR,
  MIN_STEPS,
  FunnelError,
  snapshotOf,
  toFunnel,
  submit,
  update,
  withdraw,
  listMine,
  catalogue,
  getForUser,
  listForStaff,
  countForReview,
  getForStaff,
  decide
};
