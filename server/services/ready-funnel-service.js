// server/services/ready-funnel-service.js - Templates (ready-made funnels, migration 026; «шаблон» in the app):
// publishing from one's own SI-seller → the catalogue «Для бизнеса» in the Marketplace.
// Owner's decisions 20–22 Nov.:
//  - anyone can publish; since step 4 of «Бизнес-режим 2.0» (migration 033) without the team's review —
//    published at once, the team only hides one after a complaint (as communities);
//  - the author chooses who sells the template (their AI-продавец experts write to before buying) and may add a video;
//  - the template goes into the author's Brain as a product of their business;
//  - the marketer chooses the payment: once, monthly or a percentage of sales, by their own link;
//  - before buying the expert sees the description, the steps and the result — not the full texts;
//  - funnels live in the Office only: clients never see them.
// The funnel is frozen at submission: the team approves exactly what experts will get.
const crypto = require('crypto');
const db = require('../db');
const puzzleSpec = require('./puzzle-spec');
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
    scenarios: funnelService.normalizeScenarios(s.scenarios, steps),
    puzzle: puzzleSpec.normalizePuzzle(s.puzzle)
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
  LEFT JOIN users u ON u.id = f.author_id`
  .replace('FROM ready_funnels f', `, sp.slug AS seller_slug, sp.name AS seller_name, sp.photo_media_id AS seller_photo_media_id,
         sp.role_title AS seller_role_title, sp.status AS seller_status, nn.name AS niche_name, nn.section AS niche_section
  FROM ready_funnels f
  LEFT JOIN projects sp ON sp.id = f.seller_project_id
  LEFT JOIN niches nn ON nn.id = f.niche_id`);

/**
 * view: 'public' (the catalogue — no texts; the author's payment link to buy),
 *       'author' (their own: status and the team's note), 'staff' (everything, for the review).
 */
function toFunnel(row, view = 'public') {
  const snapshot = parseJson(row.snapshot);
  const result = {
    id: row.id,
    title: row.title,
    niche: row.niche_name || row.niche || '',
    // The niche from the list (migration 034): for the filters «раздел → ниша»
    nicheId: row.niche_id || null,
    nicheSection: row.niche_section || null,
    // «Вопросы и ответы» — seen by everyone
    faq: require('./faq').normalizeFaq(row.faq),
    description: row.description || '',
    result: row.result || '',
    priceType: row.price_type,
    priceTypeLabel: PRICE_TYPE_LABELS[row.price_type] || '',
    priceLabel: row.price_label || '',
    steps: publicSteps(snapshot),
    scenarioCount: (snapshot.scenarios || []).length,
    // What the expert will fill in after buying: only the pieces' names (the questions come after buying)
    puzzle: (() => {
      const pz = puzzleSpec.normalizePuzzle(snapshot.puzzle);
      return pz.pieces.length ? { pieces: pz.pieces.map(p => ({ title: p.title, required: p.required })), release: puzzleSpec.releaseText(pz) } : null;
    })(),
    author: {
      id: row.author_id,
      name: authorName(row),
      photoUrl: mediaUrl(row.author_photo_media_id) || row.author_avatar_url || null
    },
    publishedAt: row.status === 'published' ? (row.reviewed_at || row.submitted_at) : null,
    // The author's own link: the expert pays by it (part 2); the marketer confirms the payment
    paymentUrl: row.payment_url || null,
    videoUrl: row.video_url || null,
    // The author's AI-продавец of this template: experts write to it before buying (owner's decision 22 Nov.)
    seller: row.seller_slug && row.seller_status === 'active' ? {
      id: row.seller_project_id, slug: row.seller_slug, name: row.seller_name || '', photoUrl: mediaUrl(row.seller_photo_media_id), roleTitle: row.seller_role_title || 'SI-консультант'
    } : null
  };
  if (view === 'author' || view === 'staff') {
    Object.assign(result, {
      status: row.status,
      reviewNote: row.review_note || '',
      reviewedAt: row.reviewed_at || null,
      submittedAt: row.submitted_at,
      sourceProjectId: row.source_project_id || null,
      sellerProjectId: row.seller_project_id || null,
      productId: row.product_id || null
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

  if (!title) throw new FunnelError('Напишите название шаблона');
  if (!niche) throw new FunnelError('Напишите, для какой ниши шаблон');
  if (!description) throw new FunnelError('Опишите, что это за шаблон и как он ведёт клиента');
  if (!result) throw new FunnelError('Напишите, какой результат получит эксперт');
  if (!priceType) throw new FunnelError('Выберите, как вам платят: разово, подписка или процент с продаж');
  if (!priceLabel) throw new FunnelError(priceType === 'percent' ? 'Напишите процент, например «10% с продаж»' : 'Напишите цену, например «15 000 ₸»');
  if (rawUrl && !paymentUrl) throw new FunnelError('Ссылка на оплату должна начинаться с https://');
  if (priceType !== 'percent' && !paymentUrl) throw new FunnelError('Добавьте свою ссылку на оплату — деньги идут вам напрямую');
  const rawVideo = String(body.videoUrl || '').trim();
  const videoUrl = rawVideo && /^https:\/\//i.test(rawVideo) ? cleanUrl(rawVideo) : null;
  if (rawVideo && !videoUrl) throw new FunnelError('Ссылка на видео должна начинаться с https://');
  const faq = body.faq === undefined ? undefined : JSON.stringify(require('./faq').normalizeFaq(body.faq));
  return { title, niche, nicheSection: String(body.nicheSection || ''), description, result, priceType, priceLabel, paymentUrl, videoUrl, faq };
}

// The niche the author wrote: found in the list or created at once (niche-service)
async function nicheOf(userId, fields) {
  const n = await require('./niche-service').resolve(userId, fields.niche, fields.nicheSection);
  return n ? n.id : null;
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

// Who sells the template (owner's decision 22 Nov.): one of the author's own AI-продавцы — this same one, another
// made for it, or one bought in the Marketplace. Not given — the source seller; '' / 'none' — nobody.
async function sellerOf(userId, body, sourceProject) {
  if (body.sellerProjectId === undefined) return sourceProject.id;
  const id = String(body.sellerProjectId || '');
  if (!id || id === 'none') return null;
  const seller = await db.get('SELECT id, owner_id FROM projects WHERE id = ?', [id]);
  if (!seller || seller.owner_id !== userId) throw new FunnelError('Выберите своего AI-продавца, который будет продавать шаблон', 404, 'not_found');
  return seller.id;
}

// The template goes into the author's Brain as a product of the business of its seller (or source).
// Kept in step with the template; nothing breaks if the business has no room for one more product.
async function syncProduct(userId, row, fields, projectId) {
  const productService = require('./product-service');
  const data = {
    name: `Шаблон «${fields.title}»`.slice(0, 120),
    description: fields.description,
    result: fields.result,
    priceLabel: fields.priceLabel,
    paymentUrl: fields.paymentUrl || ''
  };
  try {
    if (row && row.product_id) {
      const p = await db.get(`SELECT id FROM products WHERE id = ? AND status = 'active'`, [row.product_id]);
      if (p) return (await productService.update(userId, p.id, data)).id;
    }
    const project = await db.get('SELECT business_id FROM projects WHERE id = ?', [projectId]);
    if (!project || !project.business_id) return null;
    return (await productService.create(userId, project.business_id, data)).id;
  } catch (err) {
    console.warn('[SmartFlow Templates] product not saved:', err.message);
    return (row && row.product_id) || null;
  }
}

async function submit(userId, body = {}) {
  const fields = readFields(body);
  const { project, snapshot } = await ownProject(userId, body.projectId);
  const mine = await db.get(
    `SELECT COUNT(*) AS count FROM ready_funnels WHERE author_id = ? AND status <> 'withdrawn'`,
    [userId]
  );
  if (Number(mine && mine.count) >= MAX_PER_AUTHOR) {
    throw new FunnelError(`Можно опубликовать до ${MAX_PER_AUTHOR} шаблонов. Уберите старый, чтобы добавить новый`);
  }
  const sellerId = await sellerOf(userId, body, project);
  const productId = await syncProduct(userId, null, fields, sellerId || project.id);
  const nicheId = await nicheOf(userId, fields);
  const id = `rf_${crypto.randomBytes(8).toString('hex')}`;
  // Published at once: no review by the team since step 4 (owner's decision 22 Nov.)
  await db.run(
    `INSERT INTO ready_funnels (id, author_id, source_project_id, seller_project_id, product_id, video_url, niche_id, faq, title, niche, description, result,
       price_type, price_label, payment_url, snapshot, status, submitted_at, reviewed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)`,
    [id, userId, project.id, sellerId, productId, fields.videoUrl, nicheId, fields.faq || '[]', fields.title, fields.niche, fields.description, fields.result,
      fields.priceType, fields.priceLabel, fields.paymentUrl, JSON.stringify(snapshot), sqlNow(), sqlNow()]
  );
  return getRow(id);
}

async function authorRow(userId, id) {
  const row = await getRow(id);
  if (!row || row.author_id !== userId || row.status === 'withdrawn') throw new FunnelError('Шаблон не найден', 404, 'not_found');
  return row;
}

// A change is published at once (taken again from the SI-seller); one the team hid stays hidden
async function update(userId, id, body = {}) {
  const row = await authorRow(userId, id);
  const fields = readFields(body);
  const { project, snapshot } = await ownProject(userId, body.projectId || row.source_project_id);
  const sellerId = body.sellerProjectId === undefined ? row.seller_project_id : await sellerOf(userId, body, project);
  const productId = await syncProduct(userId, row, fields, sellerId || project.id);
  const nicheId = await nicheOf(userId, fields);
  await db.run(
    `UPDATE ready_funnels SET niche_id = ?, faq = COALESCE(?, faq), source_project_id = ?, seller_project_id = ?, product_id = ?, video_url = ?, title = ?, niche = ?, description = ?, result = ?,
       price_type = ?, price_label = ?, payment_url = ?, snapshot = ?,
       status = CASE WHEN status = 'hidden' THEN 'hidden' ELSE 'published' END,
       review_note = CASE WHEN status = 'hidden' THEN review_note ELSE NULL END,
       reviewed_at = CASE WHEN status = 'published' THEN reviewed_at ELSE ? END, submitted_at = ?, updated_at = ?
     WHERE id = ?`,
    [nicheId, fields.faq === undefined ? null : fields.faq, project.id, sellerId, productId, fields.videoUrl, fields.title, fields.niche, fields.description, fields.result, fields.priceType,
      fields.priceLabel, fields.paymentUrl, JSON.stringify(snapshot), sqlNow(), sqlNow(), sqlNow(), id]
  );
  return getRow(id);
}

/** «Пожаловаться» on a template: goes to the team as a complaint (the team may hide it). */
async function report(userId, id, rawReason = '') {
  const row = await getRow(id);
  if (!row || row.status !== 'published') throw new FunnelError('Шаблон не найден', 404, 'not_found');
  const reason = cleanText(rawReason, 300);
  if (!reason) throw new FunnelError('Напишите, что не так — команда проверит');
  const text = `Жалоба на шаблон «${row.title}» (автор ${authorName(row)}${row.author_support_code ? `, ${row.author_support_code}` : ''}).\nПричина: ${reason}`;
  const fid = `fb_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await db.run('INSERT INTO feedback (id, user_id, text, context) VALUES (?, ?, ?, ?)', [
    fid, userId, text.slice(0, 4000), JSON.stringify({ screen: 'template', funnelId: row.id })
  ]);
  await require('./support-service').notifyStaffAboutFeedback(fid);
  return { reported: true };
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

// A funnel someone bought stays visible to them even if it was later taken down (they own it)
async function getBought(id) {
  const row = await getRow(id);
  return row ? { ...toFunnel(row, 'public'), paymentUrl: null, unpublished: row.status !== 'published' } : null;
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

// Since step 4 there is no review: the team hides a template after a complaint and may bring it back
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
  if (!before || before.status === 'withdrawn') throw new FunnelError('Шаблон не найден', 404, 'not_found');
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
  report,
  listMine,
  catalogue,
  getForUser,
  getBought,
  listForStaff,
  countForReview,
  getForStaff,
  decide
};
