// server/services/partner-service.js - Links with a traffic source, invitations and the partner programme.
//
// Owner's decisions (15 Oct.):
//  - an expert creates up to 3 links per SI-seller with the source written in words ("Instagram",
//    "Канал", "Блогер Айгерим"); each link leads to that SI-seller only, and everything is counted per link;
//  - everyone has an invitation link to SmartFlow (Профиль);
//  - the team sees who shares links, where, and how many people come; the most active people get
//    "SMARTFLOW PARTNER" with a medal and the number of people who came from them on their profile.
// Counting is safe: the code comes in the Telegram start parameter, which the server reads from the
// SIGNED sign-in data (never from a request field). A new person belongs to the first link they came by;
// a client of an SI-seller belongs to the first link of THAT SI-seller they opened (within 30 days).
const crypto = require('crypto');
const db = require('../db');
const analytics = require('./analytics-service');

const MAX_SOURCE_LINKS = 3;
const PARTNER_MIN = 10; // people who came from someone's links → "SMARTFLOW PARTNER"
const VISIT_GAP_HOURS = 12;
const ATTRIBUTION_DAYS = 30;
const APP_LINK = 'https://t.me/smartflow_ai_support_bot/app?startapp=';

class PartnerError extends Error {
  constructor(message, status = 400, code = 'LINK_REFUSED') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const sqlTime = (date) => date.toISOString().slice(0, 19).replace('T', ' ');
const newId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
function newCode() {
  const bytes = crypto.randomBytes(6);
  return [...bytes].map(b => ALPHABET[b % ALPHABET.length]).join('');
}

/**
 * The start parameter → { kind: 'referral', code } | { kind: 'source', slug, code } | null.
 */
function parseStartParam(param) {
  const p = String(param || '');
  let m = /^R_([a-z0-9]{6})$/.exec(p);
  if (m) return { kind: 'referral', code: m[1] };
  // "__" never appears in an SI-seller's own link name, so the code is always found exactly
  m = /^([a-z0-9_-]+?)__([a-z0-9]{6})$/.exec(p);
  if (m) return { kind: 'source', slug: m[1], code: m[2] };
  return null;
}

function linkUrl(link, slug) {
  return link.kind === 'referral' ? `${APP_LINK}R_${link.code}` : `${APP_LINK}${slug}__${link.code}`;
}

/**
 * A sign-in with a start parameter: the visit is written (once in 12 hours per person and link);
 * a person who signs in for the very first time belongs to this link.
 */
async function recordVisit(user, startParam, isNewUser, now = new Date()) {
  const parsed = parseStartParam(startParam);
  if (!parsed || !user) return null;
  const link = await db.get(
    `SELECT l.*, p.slug FROM tracked_links l LEFT JOIN projects p ON p.id = l.project_id
     WHERE l.code = ? AND l.kind = ?`,
    [parsed.code, parsed.kind]
  );
  // A source code must belong to that very SI-seller (a code glued to another slug counts nowhere)
  if (!link || (parsed.kind === 'source' && link.slug !== parsed.slug)) return null;
  if (link.owner_user_id === user.id) return link; // own clicks are not counted
  const recent = await db.get(
    'SELECT id FROM link_visits WHERE link_id = ? AND user_id = ? AND created_at >= ? LIMIT 1',
    [link.id, user.id, sqlTime(new Date(now.getTime() - VISIT_GAP_HOURS * 3600000))]
  );
  if (!recent) {
    await db.run('INSERT INTO link_visits (id, link_id, user_id, is_new_user) VALUES (?, ?, ?, ?)', [newId('lv'), link.id, user.id, isNewUser ? 1 : 0]);
    analytics.capture('link_opened', user.id, { kind: link.kind, link_id: link.id, project_id: link.project_id || '', new_user: Boolean(isNewUser) });
  }
  if (isNewUser) {
    await db.run('UPDATE users SET referred_by_link = ? WHERE id = ? AND referred_by_link IS NULL', [link.id, user.id]);
  }
  return link;
}

/**
 * A new client of an SI-seller: the first link of THIS SI-seller the person opened in the last 30 days.
 */
async function attributeClient(project, client, userId) {
  if (!client || client.source_link_id || !userId) return null;
  const visit = await db.get(
    `SELECT v.link_id FROM link_visits v JOIN tracked_links l ON l.id = v.link_id
     WHERE v.user_id = ? AND l.kind = 'source' AND l.project_id = ? AND v.created_at >= ?
     ORDER BY v.created_at ASC LIMIT 1`,
    [userId, project.id, sqlTime(new Date(Date.now() - ATTRIBUTION_DAYS * 86400000))]
  );
  if (!visit) return null;
  await db.run('UPDATE clients SET source_link_id = ? WHERE id = ? AND source_link_id IS NULL', [visit.link_id, client.id]);
  client.source_link_id = visit.link_id;
  return visit.link_id;
}

// Numbers of one link: opened (times), people, new for SmartFlow, clients, wrote, bought
async function statsOf(linkId) {
  const v = await db.get(
    `SELECT COUNT(*) AS opens, COUNT(DISTINCT user_id) AS people, SUM(is_new_user) AS new_people FROM link_visits WHERE link_id = ?`,
    [linkId]
  );
  const c = await db.get(
    `SELECT COUNT(*) AS clients,
       SUM(CASE WHEN EXISTS (SELECT 1 FROM client_events e WHERE e.client_id = c.id AND e.type = 'client_message') THEN 1 ELSE 0 END) AS wrote,
       SUM(CASE WHEN c.funnel_status = 'bought' THEN 1 ELSE 0 END) AS bought
     FROM clients c WHERE c.source_link_id = ?`,
    [linkId]
  );
  return {
    opens: Number(v.opens) || 0,
    people: Number(v.people) || 0,
    newPeople: Number(v.new_people) || 0,
    clients: Number(c.clients) || 0,
    wrote: Number(c.wrote) || 0,
    bought: Number(c.bought) || 0
  };
}

function toLink(row, slug, stats) {
  return { id: row.id, kind: row.kind, label: row.label || '', code: row.code, url: linkUrl(row, slug), createdAt: row.created_at, stats };
}

/**
 * Office: the source links of an SI-seller with their numbers, and how many clients came without a link.
 */
async function projectLinks(project) {
  const rows = await db.all(
    `SELECT * FROM tracked_links WHERE project_id = ? AND kind = 'source' AND archived_at IS NULL ORDER BY created_at ASC`,
    [project.id]
  );
  const links = [];
  for (const r of rows) links.push(toLink(r, project.slug, await statsOf(r.id)));
  const plain = await db.get('SELECT COUNT(*) AS n FROM clients WHERE project_id = ? AND source_link_id IS NULL', [project.id]);
  return { links, max: MAX_SOURCE_LINKS, withoutLink: Number(plain.n) || 0, plainUrl: `${APP_LINK}${project.slug}` };
}

async function createSourceLink(project, ownerId, label) {
  const name = String(label || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!name) throw new PartnerError('Напишите источник трафика, например: Instagram', 400, 'EMPTY_LABEL');
  const active = await db.get(`SELECT COUNT(*) AS n FROM tracked_links WHERE project_id = ? AND kind = 'source' AND archived_at IS NULL`, [project.id]);
  if (Number(active.n) >= MAX_SOURCE_LINKS) throw new PartnerError(`У SI-продавца уже ${MAX_SOURCE_LINKS} ссылки с меткой — это максимум. Уберите ненужную.`, 400, 'LIMIT');
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    if (await db.get('SELECT id FROM tracked_links WHERE code = ?', [code])) continue;
    const id = newId('lnk');
    await db.run('INSERT INTO tracked_links (id, kind, owner_user_id, project_id, code, label) VALUES (?, ?, ?, ?, ?, ?)', [id, 'source', ownerId, project.id, code, name]);
    return toLink(await db.get('SELECT * FROM tracked_links WHERE id = ?', [id]), project.slug, await statsOf(id));
  }
  throw new Error('Could not create a unique link code');
}

/**
 * The link stops being shown in the Office; it keeps working and its people stay counted.
 */
async function archiveSourceLink(project, linkId) {
  const res = await db.run(`UPDATE tracked_links SET archived_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ? AND archived_at IS NULL`, [String(linkId || ''), project.id]);
  if (Number(res.changes) !== 1) throw new PartnerError('Ссылка не найдена', 404, 'NOT_FOUND');
}

/**
 * How many new people came to SmartFlow by all of this person's links.
 */
async function broughtCount(userId) {
  const row = await db.get(
    `SELECT COUNT(*) AS n FROM users u JOIN tracked_links l ON l.id = u.referred_by_link WHERE l.owner_user_id = ?`,
    [userId]
  );
  return Number(row.n) || 0;
}

const partnerOf = async (userId) => {
  const count = await broughtCount(userId);
  return count >= PARTNER_MIN ? { count } : null;
};

/**
 * Профиль: my invitation link (made on first request) and how many people came from me.
 */
async function myReferral(userId) {
  let link = await db.get(`SELECT * FROM tracked_links WHERE owner_user_id = ? AND kind = 'referral' LIMIT 1`, [userId]);
  if (!link) {
    for (let i = 0; i < 5 && !link; i++) {
      const code = newCode();
      if (await db.get('SELECT id FROM tracked_links WHERE code = ?', [code])) continue;
      const id = newId('lnk');
      await db.run('INSERT INTO tracked_links (id, kind, owner_user_id, code) VALUES (?, ?, ?, ?)', [id, 'referral', userId, code]);
      link = await db.get('SELECT * FROM tracked_links WHERE id = ?', [id]);
    }
  }
  const brought = await broughtCount(userId);
  return { url: linkUrl(link), brought, partner: brought >= PARTNER_MIN, partnerMin: PARTNER_MIN };
}

/**
 * The support panel: who shares links, where and how many people come (best first).
 */
async function leaderboard({ limit = 50 } = {}) {
  const owners = await db.all(
    `SELECT l.owner_user_id AS user_id, u.display_name, u.profile, u.support_code,
       COUNT(DISTINCT l.id) AS links,
       (SELECT COUNT(*) FROM link_visits v JOIN tracked_links x ON x.id = v.link_id WHERE x.owner_user_id = l.owner_user_id) AS opens,
       (SELECT COUNT(*) FROM users n JOIN tracked_links x ON x.id = n.referred_by_link WHERE x.owner_user_id = l.owner_user_id) AS brought,
       (SELECT COUNT(*) FROM clients c JOIN tracked_links x ON x.id = c.source_link_id WHERE x.owner_user_id = l.owner_user_id) AS clients,
       (SELECT COUNT(*) FROM clients c JOIN tracked_links x ON x.id = c.source_link_id WHERE x.owner_user_id = l.owner_user_id AND c.funnel_status = 'bought') AS bought
     FROM tracked_links l JOIN users u ON u.id = l.owner_user_id
     GROUP BY l.owner_user_id, u.display_name, u.profile, u.support_code`
  );
  const people = owners.map(o => {
    let custom = '';
    try { custom = (JSON.parse(o.profile || '{}').displayName || '').trim(); } catch (e) {}
    return {
      userId: o.user_id,
      name: custom || o.display_name,
      supportCode: o.support_code,
      links: Number(o.links) || 0,
      opens: Number(o.opens) || 0,
      brought: Number(o.brought) || 0,
      clients: Number(o.clients) || 0,
      bought: Number(o.bought) || 0,
      partner: (Number(o.brought) || 0) >= PARTNER_MIN
    };
  }).sort((a, b) => b.brought - a.brought || b.clients - a.clients || b.opens - a.opens).slice(0, limit);
  // Where each person's links lead
  for (const p of people) {
    const links = await db.all(
      `SELECT l.*, pr.name AS project_name, pr.slug FROM tracked_links l LEFT JOIN projects pr ON pr.id = l.project_id
       WHERE l.owner_user_id = ? ORDER BY l.kind DESC, l.created_at ASC`,
      [p.userId]
    );
    p.linkList = [];
    for (const l of links) {
      p.linkList.push({ kind: l.kind, label: l.kind === 'referral' ? 'Приглашение в SmartFlow' : l.label, consultantName: l.project_name || null, archived: Boolean(l.archived_at), ...(await statsOf(l.id)) });
    }
  }
  return { people, partnerMin: PARTNER_MIN };
}

module.exports = {
  PartnerError,
  MAX_SOURCE_LINKS,
  PARTNER_MIN,
  parseStartParam,
  recordVisit,
  attributeClient,
  projectLinks,
  createSourceLink,
  archiveSourceLink,
  broughtCount,
  partnerOf,
  myReferral,
  leaderboard
};
