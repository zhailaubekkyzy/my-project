// server/services/community-service.js - Communities in «Комьюнити», part 1 (owner's decisions 21 Nov., like Skool).
//
//  - Only a business profile creates them (the Office terms accepted), as many as it wants; anyone joins.
//  - Public (in the catalog — every one whose author made it public) or hidden (by its link K_<id> only).
//    The team may hide one (hidden_by_staff): out of the catalog, no new members.
//  - Entry: free · by request (1–3 questions; the owner or a moderator accepts) · paid by the expert's own
//    link: «Я оплатил(а)» → the owner confirms; once, or every month (30 days, renewal the same way).
//    There is no payment through SmartFlow (owner's decision): the money goes to the expert directly.
//  - Feed: posts (text, a photo, a topic), pinned posts, announcements by the owner/moderators; comments
//    with replies (one level); likes on posts and comments. Posting: everyone, or the owner and moderators.
//  - Roles: owner (one) · moderator (up to MAX_MODERATORS, named by the owner) · member.
//  - Notifications to the phone only, not to Buddy (like groups, owner's decision): a comment on my post,
//    a reply to my comment, a mention, an announcement, my request / payment answered; the owner — new
//    requests and payments. No notification about likes.
//  - No SI here for now; no chat (comments under posts are the conversation).
// Identity always comes from the login, never from the request body.
const crypto = require('crypto');
const db = require('../db');
const analytics = require('./analytics-service');
const notifyService = require('./notify-service');
const profileService = require('./profile-service');
const supportService = require('./support-service');
const mediaService = require('./media-service');
const { detectImageType } = require('./media-service');

const MAX_MODERATORS = 3;
const NEW_PER_DAY = 20;
const MAX_QUESTIONS = 3;
const MAX_CATEGORIES = 8;
const MAX_POST = 5000;
const MAX_COMMENT = 2000;
const POSTS_PAGE = 30;
const POSTS_PER_DAY = 30;
const COMMENTS_PER_DAY = 300;
const FILES_PER_DAY = 40;
const PHOTO_MAX_BYTES = 3 * 1024 * 1024;
const MONTH_MS = 30 * 24 * 3600 * 1000;
const MAX_MENTIONS = 10;

class CommunityError extends Error {
  constructor(message, status = 400, code = 'COMMUNITY') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Milliseconds: «what is new since I looked» compares moments that easily fall into one second
const sqlTime = (date = new Date()) => date.toISOString().slice(0, 23).replace('T', ' ');
const toIso = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value).replace(' ', 'T') + (/[Z+]/.test(String(value)) ? '' : 'Z'));
  return isNaN(d) ? null : d.toISOString();
};
const daysAgo = (n) => sqlTime(new Date(Date.now() - n * 24 * 3600000));
const newId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
let counter = 0;
// Ids that sort by time
function newPostId(prefix) {
  counter = (counter + 1) % 1679616;
  return `${prefix}_${Date.now().toString(36).padStart(9, '0')}${counter.toString(36).padStart(4, '0')}${crypto.randomBytes(3).toString('hex')}`;
}

function parseJson(str, fallback) {
  if (!str) return fallback;
  if (typeof str === 'object') return str;
  try { return JSON.parse(str); } catch (e) { return fallback; }
}
const clean = (v, max) => String(v || '').replace(/\r/g, '').trim().slice(0, max);
const cleanLine = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);

function personOf(user) {
  if (!user) return null;
  const u = profileService.toPublicUser(user);
  return { id: u.id, displayName: u.displayName || 'Без имени', photoUrl: u.photoUrl, headline: (u.profile && u.profile.headline) || '' };
}
const userById = (id) => db.get('SELECT * FROM users WHERE id = ?', [id]);

async function communityById(id) {
  return db.get('SELECT * FROM communities WHERE id = ?', [String(id || '')]);
}
async function memberOf(communityId, userId) {
  return db.get('SELECT * FROM community_members WHERE community_id = ? AND user_id = ?', [communityId, userId]);
}
const touch = (id) => db.run('UPDATE communities SET changed_at = ? WHERE id = ?', [sqlTime(), id]);

const isStaff = (m) => Boolean(m && m.status === 'active' && ['owner', 'moderator'].includes(m.role));

// Inside: active, and a monthly payment still valid (the owner and moderators — always)
function hasAccess(c, m) {
  if (!m || m.status !== 'active') return false;
  if (isStaff(m)) return true;
  if (c.join_mode === 'paid' && c.price_type === 'monthly') {
    const until = toIso(m.paid_until);
    return Boolean(until && until > new Date().toISOString());
  }
  return true;
}

async function requireAccess(meId, communityId) {
  const c = await communityById(communityId);
  const m = c ? await memberOf(c.id, meId) : null;
  if (!c || !hasAccess(c, m)) throw new CommunityError('Сообщество доступно участникам', 403, 'NO_ACCESS');
  return { c, m };
}

async function requireStaff(meId, communityId) {
  const ctx = await requireAccess(meId, communityId);
  if (!isStaff(ctx.m)) throw new CommunityError('Это может только автор или модератор сообщества', 403, 'NOT_STAFF');
  return ctx;
}

async function requireOwner(meId, communityId) {
  const ctx = await requireAccess(meId, communityId);
  if (ctx.m.role !== 'owner') throw new CommunityError('Это может только автор сообщества', 403, 'NOT_OWNER');
  return ctx;
}

const notify = (userId, text, startParam) => notifyService.notifyUser(userId, text, {
  buttonText: { ru: 'Открыть', en: 'Open' }, startParam, buddy: false
});

// ---------- Settings ----------
function cleanSettings(input = {}, { partial = false } = {}) {
  const out = {};
  const has = (k) => !partial || Object.prototype.hasOwnProperty.call(input, k);
  if (has('name')) {
    out.name = cleanLine(input.name, 60);
    if (!out.name) throw new CommunityError('Напишите название сообщества', 400, 'NO_NAME');
  }
  if (has('about')) out.about = clean(input.about, 2000);
  if (has('rules')) out.rules = clean(input.rules, 2000);
  if (has('visibility')) out.visibility = input.visibility === 'hidden' ? 'hidden' : 'public';
  if (has('posting')) out.posting = input.posting === 'staff' ? 'staff' : 'all';
  if (has('questions')) {
    out.questions = JSON.stringify((Array.isArray(input.questions) ? input.questions : []).map(q => cleanLine(q, 200)).filter(Boolean).slice(0, MAX_QUESTIONS));
  }
  if (has('categories')) {
    out.categories = JSON.stringify([...new Set((Array.isArray(input.categories) ? input.categories : []).map(t => cleanLine(t, 30)).filter(Boolean))].slice(0, MAX_CATEGORIES));
  }
  if (has('joinMode')) {
    out.join_mode = ['free', 'request', 'paid'].includes(input.joinMode) ? input.joinMode : 'free';
    if (out.join_mode === 'paid') {
      out.price_type = input.priceType === 'monthly' ? 'monthly' : 'once';
      out.price_label = cleanLine(input.priceLabel, 60);
      out.payment_url = profileService.cleanUrl(input.paymentUrl);
      if (!out.price_label) throw new CommunityError('Напишите цену, например «5 000 ₸ в месяц»', 400, 'NO_PRICE');
      if (!out.payment_url) throw new CommunityError('Добавьте ссылку на оплату (начинается с https://)', 400, 'NO_PAYMENT_URL');
    } else {
      out.price_type = null;
      out.price_label = null;
      out.payment_url = null;
    }
  }
  if (out.join_mode === 'request' && has('questions') && out.questions === '[]') {
    throw new CommunityError('Для входа по заявке нужен хотя бы один вопрос', 400, 'NO_QUESTIONS');
  }
  return out;
}

async function isBusiness(userId) {
  const user = await userById(userId);
  const profile = user ? profileService.toPublicUser(user).profile : {};
  return Boolean(profile && profile.businessAgreedAt);
}

/**
 * A new community: only a business profile; I am its owner.
 */
async function create(meId, input) {
  if (!await isBusiness(meId)) throw new CommunityError('Сообщества создаёт бизнес-профиль: включите его в Профиле', 403, 'NOT_BUSINESS');
  const s = cleanSettings({ joinMode: 'free', questions: [], categories: [], ...input });
  const today = await db.get('SELECT COUNT(*) AS n FROM communities WHERE owner_id = ? AND created_at >= ?', [meId, daysAgo(1)]);
  if (Number(today.n) >= NEW_PER_DAY) throw new CommunityError('Сегодня вы уже создали достаточно сообществ — продолжите завтра 🙂', 429, 'LIMIT');
  const id = newId('com');
  const now = sqlTime();
  await db.run(
    `INSERT INTO communities (id, owner_id, name, about, rules, visibility, join_mode, price_type, price_label, payment_url, questions, posting, categories, changed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, meId, s.name, s.about || '', s.rules || '', s.visibility, s.join_mode, s.price_type, s.price_label, s.payment_url, s.questions, s.posting, s.categories, now, now, now]
  );
  await db.run(
    `INSERT INTO community_members (community_id, user_id, role, status, joined_at, read_at, last_active_at, created_at) VALUES (?, ?, 'owner', 'active', ?, ?, ?, ?)`,
    [id, meId, now, now, now, now]
  );
  analytics.capture('community_created', meId, { join_mode: s.join_mode, visibility: s.visibility });
  return { communityId: id };
}

async function update(meId, communityId, input) {
  const { c } = await requireOwner(meId, communityId);
  const s = cleanSettings(input, { partial: true });
  // Request mode needs questions (the saved ones count when not changed)
  if ((s.join_mode || c.join_mode) === 'request' && parseJson(s.questions || c.questions, []).length === 0) {
    throw new CommunityError('Для входа по заявке нужен хотя бы один вопрос', 400, 'NO_QUESTIONS');
  }
  const keys = Object.keys(s);
  if (keys.length) {
    await db.run(
      `UPDATE communities SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ?, changed_at = ? WHERE id = ?`,
      [...keys.map(k => s[k]), sqlTime(), sqlTime(), c.id]
    );
  }
  return view(meId, c.id);
}

async function setCover(meId, communityId, buffer) {
  const { c } = await requireOwner(meId, communityId);
  const saved = await mediaService.saveImage(meId, buffer, 'community_cover');
  await db.run('UPDATE communities SET cover_media_id = ?, changed_at = ? WHERE id = ?', [saved.id, sqlTime(), c.id]);
  if (c.cover_media_id) await mediaService.deleteImage(c.cover_media_id);
  return { coverUrl: saved.url };
}

// ---------- What people see ----------
async function counts(communityId) {
  const row = await db.get(
    `SELECT
       (SELECT COUNT(*) FROM community_members WHERE community_id = ? AND status = 'active') AS members,
       (SELECT COUNT(*) FROM community_posts WHERE community_id = ? AND deleted_at IS NULL) AS posts`,
    [communityId, communityId]
  );
  return { members: Number(row.members) || 0, posts: Number(row.posts) || 0 };
}

function card(c, owner, n) {
  return {
    id: c.id,
    name: c.name,
    about: c.about,
    coverUrl: mediaService.mediaUrl(c.cover_media_id) || null,
    owner: owner ? { id: owner.id, displayName: owner.displayName, photoUrl: owner.photoUrl } : null,
    visibility: c.visibility,
    joinMode: c.join_mode,
    priceType: c.price_type,
    priceLabel: c.price_label,
    memberCount: n.members,
    postCount: n.posts
  };
}

/**
 * The catalog: public communities (not hidden by the team), with a search; the newest and fullest first.
 */
async function catalog(meId, query) {
  const q = String(query || '').trim().toLowerCase().slice(0, 60);
  const rows = await db.all(
    `SELECT c.*, (SELECT COUNT(*) FROM community_members m WHERE m.community_id = c.id AND m.status = 'active') AS member_count
     FROM communities c WHERE c.visibility = 'public' AND c.hidden_by_staff = 0
     ORDER BY member_count DESC, c.created_at DESC LIMIT 200`
  );
  const result = [];
  for (const c of rows) {
    if (q && ![c.name, c.about].some(v => String(v || '').toLowerCase().includes(q))) continue;
    const owner = personOf(await userById(c.owner_id));
    result.push(card(c, owner, await counts(c.id)));
    if (result.length >= 50) break;
  }
  return result;
}

/**
 * Mine: where I am (or wait to be), with what is new since I looked, and the owner's numbers.
 */
async function mine(meId) {
  const rows = await db.all(
    `SELECT c.*, m.role AS m_role, m.status AS m_status, m.read_at AS m_read, m.paid_until AS m_paid_until
     FROM community_members m JOIN communities c ON c.id = m.community_id
     WHERE m.user_id = ? AND m.status IN ('active', 'requested', 'paying')
     ORDER BY c.changed_at DESC LIMIT 100`,
    [meId]
  );
  const result = [];
  for (const c of rows) {
    const m = { role: c.m_role, status: c.m_status, paid_until: c.m_paid_until };
    const v = card(c, personOf(await userById(c.owner_id)), await counts(c.id));
    v.role = c.m_role;
    v.status = c.m_status;
    v.access = hasAccess(c, m);
    const fresh = v.access && c.m_read ? await db.get(
      'SELECT COUNT(*) AS n FROM community_posts WHERE community_id = ? AND deleted_at IS NULL AND author_id <> ? AND created_at > ?',
      [c.id, meId, c.m_read]
    ) : { n: 0 };
    v.newPosts = Number(fresh.n) || 0;
    if (isStaff({ ...m, status: c.m_status })) v.waiting = await waitingCount(c.id);
    result.push(v);
  }
  return result;
}

async function waitingCount(communityId) {
  const row = await db.get(
    `SELECT COUNT(*) AS n FROM community_members WHERE community_id = ? AND (status IN ('requested', 'paying') OR (status = 'active' AND renewal_requested_at IS NOT NULL))`,
    [communityId]
  );
  return Number(row.n) || 0;
}

/**
 * One community: «О сообществе» for everyone who has the link (hidden ones too); for members — what
 * they may do. The feed is a separate request.
 */
async function view(meId, communityId) {
  const c = await communityById(communityId);
  if (!c) throw new CommunityError('Сообщество не найдено', 404, 'NOT_FOUND');
  const m = await memberOf(c.id, meId);
  const access = hasAccess(c, m);
  const owner = personOf(await userById(c.owner_id));
  const v = card(c, owner, await counts(c.id));
  v.rules = c.rules;
  v.questions = parseJson(c.questions, []);
  v.categories = parseJson(c.categories, []);
  v.posting = c.posting;
  v.hiddenByStaff = Boolean(c.hidden_by_staff);
  v.me = m ? {
    role: m.role,
    status: m.status,
    access,
    declineReason: m.decline_reason || null,
    paidUntil: toIso(m.paid_until),
    renewalRequested: Boolean(m.renewal_requested_at),
    canPost: access && (c.posting === 'all' || isStaff(m))
  } : { role: null, status: null, access: false, canPost: false };
  // The payment link: to whoever is about to pay (and the owner)
  v.paymentUrl = c.join_mode === 'paid' ? c.payment_url : null;
  if (isStaff(m)) {
    v.waiting = await waitingCount(c.id);
    if (m.role === 'owner') v.stats = await stats(c.id);
  }
  return v;
}

/**
 * The owner's numbers: members, new for 7/30 days, posts, active members, what waits for an answer.
 */
async function stats(communityId) {
  const row = await db.get(
    `SELECT
       (SELECT COUNT(*) FROM community_members WHERE community_id = ? AND status = 'active') AS members,
       (SELECT COUNT(*) FROM community_members WHERE community_id = ? AND status = 'active' AND joined_at >= ?) AS new7,
       (SELECT COUNT(*) FROM community_members WHERE community_id = ? AND status = 'active' AND joined_at >= ?) AS new30,
       (SELECT COUNT(*) FROM community_posts WHERE community_id = ? AND deleted_at IS NULL) AS posts,
       (SELECT COUNT(*) FROM community_posts WHERE community_id = ? AND deleted_at IS NULL AND created_at >= ?) AS posts30,
       (SELECT COUNT(*) FROM community_members WHERE community_id = ? AND status = 'active' AND last_active_at >= ?) AS active30,
       (SELECT COUNT(*) FROM community_members WHERE community_id = ? AND status = 'requested') AS requests,
       (SELECT COUNT(*) FROM community_members WHERE community_id = ? AND (status = 'paying' OR (status = 'active' AND renewal_requested_at IS NOT NULL))) AS payments`,
    [communityId, communityId, daysAgo(7), communityId, daysAgo(30), communityId, communityId, daysAgo(30), communityId, daysAgo(30), communityId, communityId]
  );
  const n = (k) => Number(row[k]) || 0;
  return { members: n('members'), new7: n('new7'), new30: n('new30'), posts: n('posts'), posts30: n('posts30'), active30: n('active30'), requests: n('requests'), payments: n('payments') };
}

// ---------- Joining ----------
async function notifyStaff(c, text) {
  const staff = await db.all(`SELECT user_id FROM community_members WHERE community_id = ? AND status = 'active' AND role IN ('owner', 'moderator')`, [c.id]);
  for (const s of staff) await notify(s.user_id, text, `K_${c.id}`);
}

/**
 * «Вступить»: free — at once; by request — with answers; paid — «Я оплатил(а)» with how I paid.
 * A paid monthly member whose month ended uses the same call for the next month.
 */
async function join(meId, communityId, { answers = [], note = '' } = {}) {
  const c = await communityById(communityId);
  if (!c) throw new CommunityError('Сообщество не найдено', 404, 'NOT_FOUND');
  const m = await memberOf(c.id, meId);
  if (m && m.status === 'banned') throw new CommunityError('Автор закрыл вам доступ к этому сообществу', 403, 'BANNED');
  if (c.hidden_by_staff && !(m && m.status === 'active')) throw new CommunityError('Сообщество сейчас закрыто для новых участников', 403, 'HIDDEN');
  const me = personOf(await userById(meId));
  const now = sqlTime();
  const upsert = async (fields) => {
    const keys = Object.keys(fields);
    if (m) {
      await db.run(`UPDATE community_members SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE community_id = ? AND user_id = ?`, [...keys.map(k => fields[k]), now, c.id, meId]);
    } else {
      await db.run(
        `INSERT INTO community_members (community_id, user_id, ${keys.join(', ')}, created_at, updated_at) VALUES (?, ?, ${keys.map(() => '?').join(', ')}, ?, ?)`,
        [c.id, meId, ...keys.map(k => fields[k]), now, now]
      );
    }
  };

  if (m && hasAccess(c, m)) return view(meId, c.id);

  if (c.join_mode === 'free') {
    await upsert({ role: 'member', status: 'active', joined_at: now, read_at: now, last_active_at: now, decline_reason: null });
    analytics.capture('community_joined', meId, { join_mode: 'free' });
  } else if (c.join_mode === 'request') {
    if (m && m.status === 'requested') return view(meId, c.id);
    const questions = parseJson(c.questions, []);
    const list = (Array.isArray(answers) ? answers : []).map(a => clean(a, 1000));
    if (questions.some((q, i) => !list[i])) throw new CommunityError('Ответьте, пожалуйста, на все вопросы', 400, 'NO_ANSWERS');
    await upsert({ role: 'member', status: 'requested', answers: JSON.stringify(questions.map((q, i) => ({ q, a: list[i] }))), decline_reason: null });
    analytics.capture('community_requested', meId, {});
    await notifyStaff(c, { ru: `👥 Заявка в сообщество «${c.name}» от ${me.displayName}.`, en: `👥 A request to join «${c.name}» from ${me.displayName}.` });
  } else {
    const how = clean(note, 300);
    if (!how) throw new CommunityError('Напишите, как и когда вы оплатили — автор сверит оплату', 400, 'NO_NOTE');
    if (m && m.status === 'paying') return view(meId, c.id);
    // A monthly member whose month ended: the next month (a renewal); otherwise the first payment
    if (m && m.status === 'active' && c.price_type === 'monthly') {
      await upsert({ renewal_requested_at: now, renewal_note: how, decline_reason: null });
    } else {
      await upsert({ role: 'member', status: 'paying', payment_note: how, decline_reason: null });
    }
    analytics.capture('community_payment_claimed', meId, { price_type: c.price_type, renewal: Boolean(m && m.status === 'active') });
    await notifyStaff(c, { ru: `💳 ${me.displayName} оплатил(а) вход в «${c.name}» — подтвердите оплату.`, en: `💳 ${me.displayName} paid for «${c.name}» — please confirm.` });
  }
  await touch(c.id);
  return view(meId, c.id);
}

/**
 * A monthly member renews before the month ends (the same «Я оплатил(а)»).
 */
async function renew(meId, communityId, note) {
  const c = await communityById(communityId);
  const m = c ? await memberOf(c.id, meId) : null;
  if (!c || !m || m.status !== 'active' || c.price_type !== 'monthly' || c.join_mode !== 'paid') throw new CommunityError('Продление не нужно', 409, 'NO_RENEWAL');
  const how = clean(note, 300);
  if (!how) throw new CommunityError('Напишите, как и когда вы оплатили — автор сверит оплату', 400, 'NO_NOTE');
  await db.run('UPDATE community_members SET renewal_requested_at = ?, renewal_note = ?, updated_at = ? WHERE community_id = ? AND user_id = ?', [sqlTime(), how, sqlTime(), c.id, meId]);
  const me = personOf(await userById(meId));
  analytics.capture('community_payment_claimed', meId, { price_type: 'monthly', renewal: true });
  await notifyStaff(c, { ru: `💳 ${me.displayName} оплатил(а) следующий месяц в «${c.name}» — подтвердите оплату.`, en: `💳 ${me.displayName} paid the next month of «${c.name}» — please confirm.` });
  await touch(c.id);
  return view(meId, c.id);
}

async function leave(meId, communityId) {
  const c = await communityById(communityId);
  const m = c ? await memberOf(c.id, meId) : null;
  if (!m) return { left: true };
  if (m.role === 'owner') throw new CommunityError('Автор не может выйти из своего сообщества', 409, 'OWNER');
  await db.run('DELETE FROM community_members WHERE community_id = ? AND user_id = ?', [c.id, meId]);
  await touch(c.id);
  return { left: true };
}

/**
 * What waits for the owner / a moderator: requests with answers, payments and renewals to confirm.
 */
async function waiting(meId, communityId) {
  const { c } = await requireStaff(meId, communityId);
  const rows = await db.all(
    `SELECT m.*, u.* , m.status AS m_status, m.created_at AS m_created FROM community_members m JOIN users u ON u.id = m.user_id
     WHERE m.community_id = ? AND (m.status IN ('requested', 'paying') OR (m.status = 'active' AND m.renewal_requested_at IS NOT NULL))
     ORDER BY m.updated_at`,
    [c.id]
  );
  return {
    items: rows.map(r => ({
      person: personOf(r),
      kind: r.m_status === 'requested' ? 'request' : r.m_status === 'paying' ? 'payment' : 'renewal',
      answers: parseJson(r.answers, []),
      note: r.m_status === 'paying' ? r.payment_note : r.renewal_note,
      paidUntil: toIso(r.paid_until)
    }))
  };
}

/**
 * The owner / a moderator answers: accept a request or confirm a payment; or decline with a reason.
 */
async function decide(meId, communityId, userId, accept, reason = '') {
  const { c } = await requireStaff(meId, communityId);
  const m = await memberOf(c.id, String(userId || ''));
  if (!m) throw new CommunityError('Заявка не найдена', 404, 'NOT_FOUND');
  const now = new Date();
  const why = clean(reason, 300);
  const kind = m.status === 'requested' ? 'request' : m.status === 'paying' ? 'payment' : (m.status === 'active' && m.renewal_requested_at ? 'renewal' : null);
  if (!kind) throw new CommunityError('Заявка не найдена', 404, 'NOT_FOUND');
  if (kind === 'payment' && c.join_mode === 'paid' && meId !== c.owner_id) throw new CommunityError('Оплату подтверждает только автор сообщества', 403, 'NOT_OWNER');
  if (kind === 'renewal' && meId !== c.owner_id) throw new CommunityError('Оплату подтверждает только автор сообщества', 403, 'NOT_OWNER');
  const monthly = c.join_mode === 'paid' && c.price_type === 'monthly';
  if (accept) {
    if (kind === 'renewal') {
      const base = Math.max(Date.now(), new Date(toIso(m.paid_until) || 0).getTime());
      await db.run('UPDATE community_members SET paid_until = ?, renewal_requested_at = NULL, renewal_note = NULL, updated_at = ? WHERE community_id = ? AND user_id = ?',
        [sqlTime(new Date(base + MONTH_MS)), sqlTime(now), c.id, m.user_id]);
    } else {
      await db.run(
        `UPDATE community_members SET status = 'active', joined_at = COALESCE(joined_at, ?), read_at = ?, last_active_at = ?, paid_until = ?, decline_reason = NULL, updated_at = ? WHERE community_id = ? AND user_id = ?`,
        [sqlTime(now), sqlTime(now), sqlTime(now), monthly ? sqlTime(new Date(now.getTime() + MONTH_MS)) : null, sqlTime(now), c.id, m.user_id]
      );
    }
    analytics.capture(kind === 'request' ? 'community_joined' : 'community_payment_confirmed', m.user_id, kind === 'request' ? { join_mode: 'request' } : { price_type: c.price_type, renewal: kind === 'renewal' });
    await notify(m.user_id, kind === 'request'
      ? { ru: `✅ Вас приняли в сообщество «${c.name}».`, en: `✅ You were accepted to «${c.name}».` }
      : { ru: `✅ Оплата подтверждена — добро пожаловать в «${c.name}».`, en: `✅ Payment confirmed — welcome to «${c.name}».` }, `K_${c.id}`);
  } else {
    if (kind === 'renewal') {
      await db.run('UPDATE community_members SET renewal_requested_at = NULL, decline_reason = ?, updated_at = ? WHERE community_id = ? AND user_id = ?', [why || null, sqlTime(now), c.id, m.user_id]);
    } else {
      await db.run(`UPDATE community_members SET status = 'removed', decline_reason = ?, updated_at = ? WHERE community_id = ? AND user_id = ?`, [why || null, sqlTime(now), c.id, m.user_id]);
    }
    await notify(m.user_id, kind === 'request'
      ? { ru: `Заявку в «${c.name}» не приняли.${why ? ` Причина: ${why}` : ''}`, en: `Your request to «${c.name}» was not accepted.${why ? ` Reason: ${why}` : ''}` }
      : { ru: `Оплата в «${c.name}» не подтверждена.${why ? ` Причина: ${why}` : ''}`, en: `Your payment for «${c.name}» was not confirmed.${why ? ` Reason: ${why}` : ''}` }, `K_${c.id}`);
  }
  await touch(c.id);
  return waiting(meId, communityId);
}

// ---------- Members ----------
async function members(meId, communityId) {
  const { c, m: me } = await requireAccess(meId, communityId);
  const rows = await db.all(
    `SELECT u.*, m.role AS m_role, m.joined_at AS m_joined, m.paid_until AS m_paid FROM community_members m JOIN users u ON u.id = m.user_id
     WHERE m.community_id = ? AND m.status = 'active'
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END, m.joined_at LIMIT 500`,
    [c.id]
  );
  const staff = isStaff(me);
  return {
    members: rows.map(r => ({
      ...personOf(r),
      role: r.m_role,
      joinedAt: toIso(r.m_joined),
      // The owner sees until when a monthly member has paid
      paidUntil: staff && me.role === 'owner' ? toIso(r.m_paid) : null
    }))
  };
}

/**
 * The owner names a moderator (up to 3) or takes the role back.
 */
async function setRole(meId, communityId, userId, role) {
  const { c } = await requireOwner(meId, communityId);
  if (!['moderator', 'member'].includes(role)) throw new CommunityError('Неизвестная роль', 400, 'BAD_ROLE');
  const t = await memberOf(c.id, String(userId || ''));
  if (!t || t.status !== 'active' || t.role === 'owner') throw new CommunityError('Участник не найден', 404, 'NOT_FOUND');
  if (role === 'moderator' && t.role !== 'moderator') {
    const n = await db.get(`SELECT COUNT(*) AS n FROM community_members WHERE community_id = ? AND role = 'moderator' AND status = 'active'`, [c.id]);
    if (Number(n.n) >= MAX_MODERATORS) throw new CommunityError(`Модераторов может быть не больше ${MAX_MODERATORS}`, 409, 'MODS_LIMIT');
  }
  await db.run('UPDATE community_members SET role = ?, updated_at = ? WHERE community_id = ? AND user_id = ?', [role, sqlTime(), c.id, t.user_id]);
  await touch(c.id);
  return members(meId, communityId);
}

/**
 * Remove (may come back / ask again) or ban (cannot come back). A moderator — only members.
 */
async function removeMember(meId, communityId, userId, ban = false) {
  const { c, m: me } = await requireStaff(meId, communityId);
  const t = await memberOf(c.id, String(userId || ''));
  if (!t || t.user_id === meId || t.role === 'owner') throw new CommunityError('Участник не найден', 404, 'NOT_FOUND');
  if (t.role === 'moderator' && me.role !== 'owner') throw new CommunityError('Модератора может удалить только автор', 403, 'NOT_OWNER');
  await db.run(`UPDATE community_members SET status = ?, role = 'member', updated_at = ? WHERE community_id = ? AND user_id = ?`, [ban ? 'banned' : 'removed', sqlTime(), c.id, t.user_id]);
  await touch(c.id);
  return members(meId, communityId);
}

// ---------- Feed ----------
async function likesOf(ids, meId) {
  if (!ids.length) return new Map();
  const rows = await db.all(
    `SELECT target_id, COUNT(*) AS n, SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS mine FROM community_likes WHERE target_id IN (${ids.map(() => '?').join(',')}) GROUP BY target_id`,
    [meId, ...ids]
  );
  return new Map(rows.map(r => [r.target_id, { count: Number(r.n) || 0, mine: Number(r.mine) > 0 }]));
}

async function postView(p, meId, people, likes, commentCounts) {
  if (!people.has(p.author_id)) people.set(p.author_id, personOf(await userById(p.author_id)) || { id: p.author_id, displayName: 'Бывший участник', photoUrl: null });
  const a = people.get(p.author_id);
  const l = likes.get(p.id) || { count: 0, mine: false };
  return {
    id: p.id,
    author: { id: a.id, displayName: a.displayName, photoUrl: a.photoUrl },
    category: p.category || null,
    text: p.text,
    fileId: p.file_id || null,
    announcement: Boolean(p.announcement),
    pinned: Boolean(p.pinned),
    mine: p.author_id === meId,
    likes: l.count,
    liked: l.mine,
    comments: commentCounts.get(p.id) || 0,
    createdAt: toIso(p.created_at)
  };
}

/**
 * The feed: pinned first, then the newest (with a topic filter and «Показать ещё»). Opening marks it read.
 */
async function feed(meId, communityId, { category = null, before = null } = {}) {
  const { c, m } = await requireAccess(meId, communityId);
  const params = [c.id];
  let where = 'community_id = ? AND deleted_at IS NULL';
  if (category) { where += ' AND category = ?'; params.push(String(category).slice(0, 30)); }
  const pinned = before ? [] : await db.all(`SELECT * FROM community_posts WHERE ${where} AND pinned = 1 ORDER BY created_at DESC LIMIT 5`, params);
  const rest = await db.all(
    `SELECT * FROM community_posts WHERE ${where} AND pinned = 0 ${before ? 'AND created_at < ?' : ''} ORDER BY created_at DESC, id DESC LIMIT ?`,
    [...params, ...(before ? [sqlTime(new Date(before))] : []), POSTS_PAGE + 1]
  );
  const more = rest.length > POSTS_PAGE;
  const rows = [...pinned, ...rest.slice(0, POSTS_PAGE)];
  const ids = rows.map(r => r.id);
  const likes = await likesOf(ids, meId);
  const cc = ids.length ? await db.all(`SELECT post_id, COUNT(*) AS n FROM community_comments WHERE deleted_at IS NULL AND post_id IN (${ids.map(() => '?').join(',')}) GROUP BY post_id`, ids) : [];
  const commentCounts = new Map(cc.map(r => [r.post_id, Number(r.n) || 0]));
  const people = new Map();
  const posts = [];
  for (const p of rows) posts.push(await postView(p, meId, people, likes, commentCounts));
  const readAt = toIso(m.read_at);
  if (!before) await db.run('UPDATE community_members SET read_at = ? WHERE community_id = ? AND user_id = ?', [sqlTime(), c.id, meId]);
  return { posts, more, newSince: readAt };
}

async function savePhoto(meId, c, buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return null;
  if (buffer.length > PHOTO_MAX_BYTES) throw new CommunityError('Фото слишком большое.', 413, 'FILE_TOO_LARGE');
  const mime = detectImageType(buffer);
  if (!mime) throw new CommunityError('Это не фото (подходят JPEG, PNG, WebP).', 400, 'INVALID_FILE');
  const today = await db.get('SELECT COUNT(*) AS n FROM community_files WHERE sender_id = ? AND created_at >= ?', [meId, daysAgo(1)]);
  if (Number(today.n) >= FILES_PER_DAY) throw new CommunityError('На сегодня фото достаточно — продолжите завтра 🙂', 429, 'FILES_LIMIT');
  const id = newId('cmf');
  await db.run('INSERT INTO community_files (id, community_id, sender_id, mime_type, size_bytes, data_base64, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, c.id, meId, mime, buffer.length, buffer.toString('base64'), sqlTime()]);
  return id;
}

// Mentions: only active members of this community, not me
async function mentionedIn(c, meId, ids) {
  const out = [];
  for (const id of [...new Set((Array.isArray(ids) ? ids : []).map(String))].slice(0, MAX_MENTIONS)) {
    if (id === meId) continue;
    const m = await memberOf(c.id, id);
    if (m && hasAccess(c, m)) out.push(id);
  }
  return out;
}

const markActive = (c, meId) => db.run('UPDATE community_members SET last_active_at = ? WHERE community_id = ? AND user_id = ?', [sqlTime(), c.id, meId]);

/**
 * A new post: text (and a photo), a topic. The owner/moderators may make it an announcement — every member
 * is told (pinning is a separate button).
 */
async function createPost(meId, communityId, { text, category, announcement, mentionIds } = {}, photo = null) {
  const { c, m } = await requireAccess(meId, communityId);
  if (c.posting === 'staff' && !isStaff(m)) throw new CommunityError('Посты здесь пишут автор и модераторы — вы можете комментировать', 403, 'STAFF_ONLY');
  const body = clean(text, MAX_POST);
  if (!body && !photo) throw new CommunityError('Напишите текст поста', 400, 'EMPTY');
  const today = await db.get('SELECT COUNT(*) AS n FROM community_posts WHERE author_id = ? AND created_at >= ?', [meId, daysAgo(1)]);
  if (Number(today.n) >= POSTS_PER_DAY) throw new CommunityError('На сегодня постов достаточно — продолжите завтра 🙂', 429, 'POSTS_LIMIT');
  const topics = parseJson(c.categories, []);
  const topic = category && topics.includes(category) ? category : null;
  const ann = Boolean(announcement) && isStaff(m);
  const fileId = photo ? await savePhoto(meId, c, photo) : null;
  const id = newPostId('cmp');
  const now = sqlTime();
  await db.run(
    'INSERT INTO community_posts (id, community_id, author_id, category, text, file_id, announcement, last_activity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, c.id, meId, topic, body, fileId, ann ? 1 : 0, now, now]
  );
  await markActive(c, meId);
  await touch(c.id);
  analytics.capture('community_post', meId, { photo: Boolean(fileId), announcement: ann, topic: Boolean(topic) });
  const me = personOf(await userById(meId));
  const told = new Set([meId]);
  for (const uid of await mentionedIn(c, meId, mentionIds)) {
    told.add(uid);
    await notify(uid, { ru: `👥 «${c.name}»: ${me.displayName} упомянул(а) вас в посте.`, en: `👥 «${c.name}»: ${me.displayName} mentioned you in a post.` }, `KP_${id}`);
  }
  if (ann) {
    const all = await db.all(`SELECT * FROM community_members WHERE community_id = ? AND status = 'active'`, [c.id]);
    for (const r of all) {
      if (told.has(r.user_id) || !hasAccess(c, r)) continue;
      await notify(r.user_id, { ru: `📣 «${c.name}»: новый анонс от ${me.displayName}.`, en: `📣 «${c.name}»: a new announcement from ${me.displayName}.` }, `KP_${id}`);
    }
  }
  return { postId: id };
}

async function postById(postId) {
  return db.get('SELECT * FROM community_posts WHERE id = ?', [String(postId || '')]);
}

/**
 * One post with its comments (replies under their comment).
 */
async function post(meId, postId) {
  const p = await postById(postId);
  if (!p || p.deleted_at) throw new CommunityError('Пост не найден', 404, 'NOT_FOUND');
  const { c, m } = await requireAccess(meId, p.community_id);
  const rows = await db.all('SELECT * FROM community_comments WHERE post_id = ? ORDER BY created_at, id LIMIT 1000', [p.id]);
  const likes = await likesOf([p.id, ...rows.map(r => r.id)], meId);
  const people = new Map();
  const commentCounts = new Map([[p.id, rows.filter(r => !r.deleted_at).length]]);
  const view = await postView(p, meId, people, likes, commentCounts);
  const staff = isStaff(m);
  const comments = [];
  for (const r of rows) {
    if (!people.has(r.author_id)) people.set(r.author_id, personOf(await userById(r.author_id)) || { id: r.author_id, displayName: 'Бывший участник', photoUrl: null });
    const a = people.get(r.author_id);
    const l = likes.get(r.id) || { count: 0, mine: false };
    comments.push({
      id: r.id,
      parentId: r.parent_id || null,
      author: { id: a.id, displayName: a.displayName, photoUrl: a.photoUrl },
      text: r.deleted_at ? '' : r.text,
      deleted: Boolean(r.deleted_at),
      mine: r.author_id === meId,
      likes: l.count,
      liked: l.mine,
      createdAt: toIso(r.created_at)
    });
  }
  return { communityId: c.id, communityName: c.name, post: view, comments, canModerate: staff };
}

/**
 * A comment (or a reply to a comment). The post's author and the comment's author are told; mentions too.
 */
async function comment(meId, postId, { text, parentId, mentionIds } = {}) {
  const p = await postById(postId);
  if (!p || p.deleted_at) throw new CommunityError('Пост не найден', 404, 'NOT_FOUND');
  const { c } = await requireAccess(meId, p.community_id);
  const body = clean(text, MAX_COMMENT);
  if (!body) throw new CommunityError('Напишите комментарий', 400, 'EMPTY');
  const today = await db.get('SELECT COUNT(*) AS n FROM community_comments WHERE author_id = ? AND created_at >= ?', [meId, daysAgo(1)]);
  if (Number(today.n) >= COMMENTS_PER_DAY) throw new CommunityError('На сегодня комментариев достаточно — продолжите завтра 🙂', 429, 'COMMENTS_LIMIT');
  let parent = null;
  if (parentId) {
    parent = await db.get('SELECT * FROM community_comments WHERE id = ? AND post_id = ?', [String(parentId), p.id]);
    // Replies stay one level deep: a reply to a reply goes under the same comment
    if (parent && parent.parent_id) parent = await db.get('SELECT * FROM community_comments WHERE id = ?', [parent.parent_id]) || parent;
  }
  const id = newPostId('cmc');
  const now = sqlTime();
  await db.run('INSERT INTO community_comments (id, post_id, community_id, author_id, parent_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, p.id, c.id, meId, parent ? parent.id : null, body, now]);
  await db.run('UPDATE community_posts SET last_activity = ? WHERE id = ?', [now, p.id]);
  await markActive(c, meId);
  await touch(c.id);
  analytics.capture('community_comment', meId, { reply: Boolean(parent) });
  const me = personOf(await userById(meId));
  const told = new Set([meId]);
  const tell = async (uid, text) => {
    if (told.has(uid)) return;
    told.add(uid);
    const mm = await memberOf(c.id, uid);
    if (mm && hasAccess(c, mm)) await notify(uid, text, `KP_${p.id}`);
  };
  // The one I answered (an explicit reply to a reply is told too)
  const answered = parentId ? await db.get('SELECT author_id FROM community_comments WHERE id = ?', [String(parentId)]) : null;
  if (answered) await tell(answered.author_id, { ru: `💬 «${c.name}»: ${me.displayName} ответил(а) на ваш комментарий.`, en: `💬 «${c.name}»: ${me.displayName} replied to your comment.` });
  if (parent && parent.author_id) await tell(parent.author_id, { ru: `💬 «${c.name}»: ${me.displayName} ответил(а) на ваш комментарий.`, en: `💬 «${c.name}»: ${me.displayName} replied to your comment.` });
  for (const uid of await mentionedIn(c, meId, mentionIds)) {
    await tell(uid, { ru: `👥 «${c.name}»: ${me.displayName} упомянул(а) вас.`, en: `👥 «${c.name}»: ${me.displayName} mentioned you.` });
  }
  await tell(p.author_id, { ru: `💬 «${c.name}»: ${me.displayName} прокомментировал(а) ваш пост.`, en: `💬 «${c.name}»: ${me.displayName} commented on your post.` });
  return post(meId, p.id);
}

/**
 * A like on a post or a comment; again — takes it back. No notification (owner's decision).
 */
async function like(meId, targetId) {
  const id = String(targetId || '');
  const target = id.startsWith('cmp_') ? await postById(id) : await db.get('SELECT * FROM community_comments WHERE id = ?', [id]);
  if (!target || target.deleted_at) throw new CommunityError('Не найдено', 404, 'NOT_FOUND');
  const { c } = await requireAccess(meId, target.community_id);
  const had = await db.get('SELECT 1 AS x FROM community_likes WHERE target_id = ? AND user_id = ?', [id, meId]);
  if (had) {
    await db.run('DELETE FROM community_likes WHERE target_id = ? AND user_id = ?', [id, meId]);
  } else {
    await db.run('INSERT INTO community_likes (target_id, user_id, community_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', [id, meId, c.id, sqlTime()]);
    await markActive(c, meId);
    analytics.capture('community_like', meId, { target: id.startsWith('cmp_') ? 'post' : 'comment' });
  }
  await touch(c.id);
  const n = await db.get('SELECT COUNT(*) AS n FROM community_likes WHERE target_id = ?', [id]);
  return { liked: !had, likes: Number(n.n) || 0 };
}

async function pinPost(meId, postId, pinned) {
  const p = await postById(postId);
  if (!p || p.deleted_at) throw new CommunityError('Пост не найден', 404, 'NOT_FOUND');
  const { c } = await requireStaff(meId, p.community_id);
  await db.run('UPDATE community_posts SET pinned = ? WHERE id = ?', [pinned ? 1 : 0, p.id]);
  await touch(c.id);
  return { pinned: Boolean(pinned) };
}

// Deleting: the author, or the owner / a moderator. The text and the photo are erased.
async function deletePost(meId, postId) {
  const p = await postById(postId);
  if (!p || p.deleted_at) throw new CommunityError('Пост не найден', 404, 'NOT_FOUND');
  const { c, m } = await requireAccess(meId, p.community_id);
  if (p.author_id !== meId && !isStaff(m)) throw new CommunityError('Удалить чужой пост может только автор или модератор сообщества', 403, 'NOT_STAFF');
  await db.run(`UPDATE community_posts SET deleted_at = ?, text = '', pinned = 0 WHERE id = ?`, [sqlTime(), p.id]);
  if (p.file_id) await db.run('DELETE FROM community_files WHERE id = ?', [p.file_id]);
  await touch(c.id);
  return { deleted: true };
}

async function deleteComment(meId, commentId) {
  const r = await db.get('SELECT * FROM community_comments WHERE id = ?', [String(commentId || '')]);
  if (!r || r.deleted_at) throw new CommunityError('Комментарий не найден', 404, 'NOT_FOUND');
  const { c, m } = await requireAccess(meId, r.community_id);
  if (r.author_id !== meId && !isStaff(m)) throw new CommunityError('Удалить чужой комментарий может только автор или модератор сообщества', 403, 'NOT_STAFF');
  await db.run(`UPDATE community_comments SET deleted_at = ?, text = '' WHERE id = ?`, [sqlTime(), r.id]);
  await touch(c.id);
  return post(meId, r.post_id);
}

async function fileOf(meId, communityId, fileId) {
  const c = await communityById(communityId);
  const m = c ? await memberOf(c.id, meId) : null;
  if (!c || !hasAccess(c, m)) return null;
  const row = await db.get('SELECT * FROM community_files WHERE id = ? AND community_id = ?', [String(fileId || ''), c.id]);
  return row ? { mimeType: row.mime_type, buffer: Buffer.from(row.data_base64, 'base64') } : null;
}

/**
 * «Пожаловаться» on a community or a post: the team gets it (with the post text).
 */
async function report(meId, communityId, postId, reason) {
  const c = await communityById(communityId);
  if (!c) throw new CommunityError('Сообщество не найдено', 404, 'NOT_FOUND');
  const owner = await userById(c.owner_id);
  let text = `Жалоба на сообщество «${c.name}» (автор ${personOf(owner).displayName}${owner && owner.support_code ? `, ${owner.support_code}` : ''}).`;
  if (postId) {
    const p = await postById(postId);
    if (p && p.community_id === c.id) {
      const a = await userById(p.author_id);
      text += `\nПост от ${personOf(a).displayName}${a && a.support_code ? ` (${a.support_code})` : ''}: ${String(p.text || '[удалён]').slice(0, 1000)}`;
    }
  }
  const why = clean(reason, 300);
  if (why) text += `\nПричина: ${why}`;
  const id = `fb_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await db.run('INSERT INTO feedback (id, user_id, text, context) VALUES (?, ?, ?, ?)', [
    id, meId, text.slice(0, 4000), JSON.stringify({ screen: 'community', communityId: c.id, postId: postId || null })
  ]);
  await supportService.notifyStaffAboutFeedback(id);
  return { reported: true };
}

// ---------- The team ----------
async function staffList() {
  const rows = await db.all('SELECT * FROM communities ORDER BY created_at DESC LIMIT 200');
  const out = [];
  for (const c of rows) {
    const owner = await userById(c.owner_id);
    out.push({ ...card(c, personOf(owner), await counts(c.id)), ownerCode: owner && owner.support_code, hiddenByStaff: Boolean(c.hidden_by_staff) });
  }
  return out;
}

async function staffHide(communityId, hidden) {
  const c = await communityById(communityId);
  if (!c) throw new CommunityError('Сообщество не найдено', 404, 'NOT_FOUND');
  await db.run('UPDATE communities SET hidden_by_staff = ?, changed_at = ? WHERE id = ?', [hidden ? 1 : 0, sqlTime(), c.id]);
  return { hiddenByStaff: Boolean(hidden) };
}

module.exports = {
  CommunityError,
  MAX_MODERATORS,
  create,
  update,
  setCover,
  catalog,
  mine,
  view,
  join,
  renew,
  leave,
  waiting,
  decide,
  members,
  setRole,
  removeMember,
  feed,
  createPost,
  post,
  comment,
  like,
  pinPost,
  deletePost,
  deleteComment,
  fileOf,
  report,
  staffList,
  staffHide,
  hasAccess
};
