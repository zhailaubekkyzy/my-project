// server/services/review-service.js - Reviews of real clients about an SI-seller.
//
// Owner's decisions (15 Oct.): only a client marked "Купили" (by a person of the business) writes a
// review, one per SI-seller — a rating 1–5 and a text; they may change it later. Everybody sees only a
// short name ("Анна К."), never the full name or the profile. The expert answers a review but cannot
// delete it. A complaint about a review goes to the team; the team hides it in the support panel.
// No made-up reviews: the Marketplace shows only these rows.
const crypto = require('crypto');
const db = require('../db');
const telegramBot = require('./telegram-bot');
const supportService = require('./support-service');
const analytics = require('./analytics-service');

const MAX_TEXT = 1000;
const MAX_REPLY = 1000;
const PAGE = 20;

class ReviewError extends Error {
  constructor(message, status = 400, code = 'REVIEW_REFUSED') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const clean = (value, max) => String(value || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

function parseJson(str) {
  if (!str) return {};
  if (typeof str === 'object') return str;
  try { return JSON.parse(str) || {}; } catch (e) { return {}; }
}

/**
 * "Анна Каримова" → "Анна К."; one word stays as is. The name chosen in the app comes first.
 */
function shortName(user) {
  const full = ((parseJson(user && user.profile).displayName || '').trim() || (user && user.display_name) || '').trim();
  const parts = full.split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Клиент';
  return parts.length > 1 ? `${parts[0]} ${parts[1].charAt(0).toUpperCase()}.` : parts[0];
}

function toPublic(row) {
  return {
    id: row.id,
    name: shortName({ profile: row.author_profile, display_name: row.author_name }),
    rating: Number(row.rating),
    text: row.text || '',
    reply: row.reply_text || null,
    replyAt: row.reply_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const LIST_SQL = `SELECT r.*, u.display_name AS author_name, u.profile AS author_profile
  FROM reviews r JOIN users u ON u.id = r.author_user_id`;

// The person as a client of this SI-seller (their own client row)
async function clientOf(project, userId) {
  return db.get('SELECT * FROM clients WHERE project_id = ? AND external_client_id = ?', [project.id, userId]);
}

/**
 * In the chat: may this person write a review, and their own review if any.
 */
async function myReview(project, userId) {
  const client = await clientOf(project, userId);
  const mine = await db.get(`${LIST_SQL} WHERE r.project_id = ? AND r.author_user_id = ?`, [project.id, userId]);
  return {
    canReview: Boolean(client && client.funnel_status === 'bought'),
    review: mine ? { ...toPublic(mine), hidden: Boolean(mine.hidden_at) } : null
  };
}

/**
 * Writes or changes my review. Only after "Купили". The expert gets a message about a new review.
 */
async function saveReview(project, userId, { rating, text }) {
  const client = await clientOf(project, userId);
  if (!client || client.funnel_status !== 'bought') {
    throw new ReviewError('Отзыв можно оставить после покупки — когда эксперт подтвердит оплату.', 403, 'NOT_BOUGHT');
  }
  const stars = parseInt(rating, 10);
  if (!(stars >= 1 && stars <= 5)) throw new ReviewError('Поставьте оценку от 1 до 5.', 400, 'BAD_RATING');
  const body = clean(text, MAX_TEXT);
  const existing = await db.get('SELECT id FROM reviews WHERE project_id = ? AND author_user_id = ?', [project.id, userId]);
  if (existing) {
    await db.run('UPDATE reviews SET rating = ?, text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [stars, body, existing.id]);
    return { ...(await myReview(project, userId)), created: false };
  }
  const id = `rev_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await db.run(
    'INSERT INTO reviews (id, project_id, business_id, client_id, author_user_id, rating, text) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, project.id, client.business_id || null, client.id, userId, stars, body]
  );
  analytics.capture('review_created', userId, { project_id: project.id, rating: stars, with_text: Boolean(body) });
  const author = await db.get('SELECT display_name, profile FROM users WHERE id = ?', [userId]);
  await telegramBot.notifyUser(
    project.owner_id,
    `⭐ Новый отзыв о «${project.name}»: ${stars} из 5 от ${shortName(author)}.${body ? `\n\n«${body.slice(0, 300)}»` : ''}\n\nОтветить можно в Офисе → SI-продавец → «Аналитика».`,
    { buttonText: 'Открыть Офис', startParam: 'GO_office' }
  );
  return { ...(await myReview(project, userId)), created: true };
}

/**
 * Visible reviews of an SI-seller (newest first) with the average rating.
 */
async function publicReviews(projectId, { offset = 0 } = {}) {
  const summary = await db.get(
    'SELECT COUNT(*) AS count, AVG(rating) AS average FROM reviews WHERE project_id = ? AND hidden_at IS NULL',
    [projectId]
  );
  const rows = await db.all(
    `${LIST_SQL} WHERE r.project_id = ? AND r.hidden_at IS NULL ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`,
    [projectId, PAGE, Math.max(0, parseInt(offset, 10) || 0)]
  );
  const count = Number(summary.count) || 0;
  return {
    count,
    average: count ? Math.round(Number(summary.average) * 10) / 10 : null,
    reviews: rows.map(toPublic),
    pageSize: PAGE
  };
}

/**
 * For the expert in the Office: all reviews of the SI-seller, hidden ones marked.
 */
async function reviewsForOwner(projectId) {
  const rows = await db.all(`${LIST_SQL} WHERE r.project_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT 200`, [projectId]);
  return rows.map(r => ({ ...toPublic(r), hidden: Boolean(r.hidden_at) }));
}

/**
 * The expert answers a review (or changes the answer; empty = remove the answer). Never deletes it.
 */
async function reply(project, reviewId, text) {
  const review = await db.get('SELECT * FROM reviews WHERE id = ? AND project_id = ?', [String(reviewId || ''), project.id]);
  if (!review) throw new ReviewError('Отзыв не найден', 404, 'NOT_FOUND');
  const body = clean(text, MAX_REPLY);
  await db.run('UPDATE reviews SET reply_text = ?, reply_at = ? WHERE id = ?', [body || null, body ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null, review.id]);
  if (body && !review.reply_text) {
    await telegramBot.notifyUser(review.author_user_id, { ru: `💬 Эксперт ответил на ваш отзыв о «${project.name}».`, en: `💬 The expert replied to your review of «${project.name}».` }, { buttonText: { ru: 'Открыть', en: 'Open' }, startParam: `C_${project.id}` });
  }
  return { ...toPublic({ ...(await db.get(`${LIST_SQL} WHERE r.id = ?`, [review.id])) }) };
}

/**
 * "Пожаловаться" on a review: the team gets it with the review and the author's support number.
 */
async function report(reviewId, userId, reason) {
  const review = await db.get(
    `SELECT r.*, p.name AS project_name, u.support_code FROM reviews r JOIN projects p ON p.id = r.project_id
     JOIN users u ON u.id = r.author_user_id WHERE r.id = ? AND r.hidden_at IS NULL`,
    [String(reviewId || '')]
  );
  if (!review) throw new ReviewError('Отзыв не найден', 404, 'NOT_FOUND');
  const why = clean(reason, 300);
  const text = `Жалоба на отзыв о «${review.project_name}» (автор ${review.support_code || 'без номера'}, оценка ${review.rating}).` +
    `${why ? `\nПричина: ${why}` : ''}\n\nОтзыв: «${(review.text || '').slice(0, 1000)}»\n\nСкрыть: панель поддержки → найти автора по номеру → «Отзывы» → «Скрыть отзыв».`;
  const id = `fb_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await db.run('INSERT INTO feedback (id, user_id, text, context) VALUES (?, ?, ?, ?)', [
    id, userId, text.slice(0, 4000), JSON.stringify({ screen: 'marketplace/review', reviewId: review.id })
  ]);
  await supportService.notifyStaffAboutFeedback(id);
  return { reported: true };
}

module.exports = { ReviewError, shortName, myReview, saveReview, publicReviews, reviewsForOwner, reply, report };
