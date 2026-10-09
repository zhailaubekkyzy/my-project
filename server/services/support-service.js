// server/services/support-service.js - Finding the person with a problem and the support team.
//
//  - Short user number (SF-48213): shown in Profile, people can dictate it; finds usr_... exactly.
//  - Error codes (K7P2): shown on screen, written to the Railway log and to error_log together
//    with the user's number. No personal data (no names, no message texts) goes to the log.
//  - Staff: owners come from ADMIN_USERS (Railway), the support team is added in the panel.
//  - Every action of the team is recorded in admin_actions.
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const telegramBot = require('./telegram-bot');

const newId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

// Time in the format the database itself writes (CURRENT_TIMESTAMP, UTC): "2026-10-09 12:30:00".
// Strings in this format compare correctly on SQLite and PostgreSQL.
function sqlTime(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function hoursAgo(hours) {
  return sqlTime(new Date(Date.now() - hours * 60 * 60 * 1000));
}

// ---------------------------------------------------------------
// Short user number
// ---------------------------------------------------------------
function randomSupportCode() {
  return `SF-${crypto.randomInt(10000, 100000)}`;
}

// "sf 48213", "SF-48213", "48213" → "SF-48213"; anything else → null
function normalizeSupportCode(value) {
  const digits = String(value || '').trim().replace(/^sf[\s-]*/i, '');
  return /^\d{5}$/.test(digits) ? `SF-${digits}` : null;
}

/**
 * Gives the user a number if they have none yet. Returns the number.
 */
async function ensureSupportCode(userId) {
  const user = await db.get('SELECT support_code FROM users WHERE id = ?', [userId]);
  if (!user) return null;
  if (user.support_code) return user.support_code;
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = randomSupportCode();
    try {
      const res = await db.run('UPDATE users SET support_code = ? WHERE id = ? AND support_code IS NULL', [code, userId]);
      if (res.changes) return code;
      // Another request gave the number meanwhile
      const again = await db.get('SELECT support_code FROM users WHERE id = ?', [userId]);
      if (again && again.support_code) return again.support_code;
    } catch (err) {
      // Same number taken by someone else (unique index): try another one
    }
  }
  throw new Error('Could not assign a support number');
}

/**
 * Numbers for people who signed up before numbers existed. Runs at server start.
 */
async function backfillSupportCodes() {
  const rows = await db.all('SELECT id FROM users WHERE support_code IS NULL');
  for (const row of rows) await ensureSupportCode(row.id);
  return rows.length;
}

// ---------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------
// No 0/O, 1/I/L: easy to dictate
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newErrorCode() {
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return code;
}

function normalizeErrorCode(value) {
  const code = String(value || '').trim().toUpperCase().replace(/^КОД\s*/i, '');
  return /^[A-Z0-9]{4}$/.test(code) ? code : null;
}

async function supportCodeOf(userId) {
  if (!userId) return null;
  try {
    const row = await db.get('SELECT support_code FROM users WHERE id = ?', [userId]);
    return row ? row.support_code : null;
  } catch (e) {
    return null;
  }
}

/**
 * Saves an error to error_log and the Railway log. Never throws.
 * source: 'server' | 'client'
 */
async function logError({ code = newErrorCode(), source = 'server', userId = null, method = null, path = null, status = null, message = '', context = null }) {
  const supportCode = await supportCodeOf(userId);
  console.error(`[SmartFlow Error] code=${code} source=${source} user=${supportCode || userId || '-'} ${method || ''} ${path || ''} ${status || ''}: ${String(message).slice(0, 300)}`);
  try {
    // A user id that is not in the database (old token after a reset) must not lose the error
    const known = userId ? await db.get('SELECT id FROM users WHERE id = ?', [userId]) : null;
    await db.run(
      `INSERT INTO error_log (id, code, source, user_id, method, path, status, message, context)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId('err'), code, source, known ? userId : null, method, path ? String(path).slice(0, 300) : null,
        status, String(message || '').slice(0, 1000), context ? JSON.stringify(context).slice(0, 4000) : null]
    );
    // Keep 60 days of errors
    if (Math.random() < 0.02) {
      await db.run('DELETE FROM error_log WHERE created_at < ?', [hoursAgo(60 * 24)]);
    }
  } catch (err) {
    console.warn('[SmartFlow support] could not save error:', err.message);
  }
  return code;
}

// ---------------------------------------------------------------
// Staff
// ---------------------------------------------------------------
const ROLE_LABELS = { owner: 'Владелица', support: 'Поддержка' };

async function telegramIdOf(userId) {
  const row = await db.get('SELECT provider_user_id FROM auth_identities WHERE user_id = ? AND provider = ?', [userId, 'telegram']);
  return row ? row.provider_user_id : null;
}

// Owner user ids from ADMIN_USERS: SF-numbers, Telegram ids or usr_... ids
async function ownerUserIds() {
  const ids = new Set();
  for (const entry of config.adminUsers) {
    let row = null;
    if (/^sf/i.test(entry)) {
      const supportCode = normalizeSupportCode(entry);
      if (supportCode) row = await db.get('SELECT id FROM users WHERE support_code = ?', [supportCode]);
    } else if (/^\d+$/.test(entry)) {
      row = await db.get('SELECT user_id AS id FROM auth_identities WHERE provider = ? AND provider_user_id = ?', ['telegram', entry]);
    } else {
      row = await db.get('SELECT id FROM users WHERE id = ?', [entry]);
    }
    if (row) ids.add(row.id);
  }
  return [...ids];
}

/**
 * 'owner' | 'support' | null
 */
async function staffRoleOf(userId) {
  if (!userId) return null;
  if ((await ownerUserIds()).includes(userId)) return 'owner';
  const row = await db.get('SELECT role FROM staff WHERE user_id = ?', [userId]);
  return row ? row.role : null;
}

async function staffUserIds() {
  const rows = await db.all('SELECT user_id FROM staff');
  return [...new Set([...(await ownerUserIds()), ...rows.map(r => r.user_id)])];
}

// ---------------------------------------------------------------
// Blocked people (users.status = 'blocked'). Checked on every request from memory;
// the list is re-read from the database every minute and updated at once on block/unblock.
// ---------------------------------------------------------------
let blockedIds = new Set();
let blockedLoadedAt = 0;

async function refreshBlocked() {
  blockedLoadedAt = Date.now();
  const rows = await db.all('SELECT id FROM users WHERE status = ?', ['blocked']);
  blockedIds = new Set(rows.map(r => r.id));
}

function isBlocked(userId) {
  if (Date.now() - blockedLoadedAt > 60000) refreshBlocked().catch(() => {});
  return blockedIds.has(userId);
}

function setBlocked(userId, blocked) {
  if (blocked) blockedIds.add(userId); else blockedIds.delete(userId);
}

/**
 * The signed-in person's own data for the app: public profile + their number, team role and
 * the "clear data on the phone" mark. Never used for other people's profiles.
 */
async function sessionUser(user) {
  const profileService = require('./profile-service');
  return {
    ...profileService.toPublicUser(user),
    supportCode: await ensureSupportCode(user.id),
    staffRole: await staffRoleOf(user.id),
    clientResetAt: user.client_reset_at || null
  };
}

// ---------------------------------------------------------------
// Audit: what the team did
// ---------------------------------------------------------------
async function logAction(staffUserId, targetUserId, action, details = {}) {
  await db.run(
    'INSERT INTO admin_actions (id, staff_user_id, target_user_id, action, details) VALUES (?, ?, ?, ?, ?)',
    [newId('act'), staffUserId, targetUserId || null, action, JSON.stringify(details).slice(0, 8000)]
  );
}

// ---------------------------------------------------------------
// Complaints
// ---------------------------------------------------------------
const CONTEXT_KEYS = ['platform', 'tgVersion', 'userAgent', 'screen', 'colorScheme', 'appVersion', 'route',
  'botCanWrite', 'online', 'language', 'timezone', 'authStatus'];

/**
 * Keeps only known fields of what the app attached to a complaint, short and safe.
 */
function sanitizeContext(input) {
  if (!input || typeof input !== 'object') return null;
  const out = {};
  for (const key of CONTEXT_KEYS) {
    const v = input[key];
    if (v === undefined || v === null) continue;
    out[key] = typeof v === 'boolean' ? v : String(v).slice(0, 300);
  }
  if (Array.isArray(input.recentErrors)) {
    out.recentErrors = input.recentErrors.slice(-10).map(e => ({
      code: normalizeErrorCode(e && e.code) || null,
      status: Number.isFinite(Number(e && e.status)) ? Number(e.status) : null,
      path: String((e && e.path) || '').slice(0, 200),
      message: String((e && e.message) || '').slice(0, 200),
      at: String((e && e.at) || '').slice(0, 40)
    }));
  }
  return out;
}

function parseJson(str, fallback = null) {
  if (!str) return fallback;
  if (typeof str === 'object') return str;
  try {
    return JSON.parse(str);
  } catch (e) {
    return fallback;
  }
}

function displayNameOf(user) {
  return (parseJson(user.profile, {}).displayName || '').trim() || user.display_name;
}

/**
 * Bot message to every team member about a new complaint, with an "Открыть" button.
 */
async function notifyStaffAboutFeedback(feedbackId) {
  try {
    const fb = await db.get(
      `SELECT f.*, u.display_name, u.profile, u.username, u.support_code
       FROM feedback f JOIN users u ON u.id = f.user_id WHERE f.id = ?`, [feedbackId]
    );
    if (!fb) return 0;
    const ctx = parseJson(fb.context, {}) || {};
    const codes = (ctx.recentErrors || []).map(e => e.code).filter(Boolean);
    const lines = [
      `🆘 Новая жалоба в SmartFlow`,
      `От: ${displayNameOf(fb)}${fb.username ? ` (@${fb.username})` : ''}, номер ${fb.support_code || '—'}`,
      '',
      `«${String(fb.text).slice(0, 700)}»`
    ];
    if (ctx.route) lines.push('', `Экран: ${ctx.route}`);
    if (ctx.platform) lines.push(`Телефон: ${ctx.platform}${ctx.tgVersion ? `, Telegram ${ctx.tgVersion}` : ''}`);
    if (codes.length) lines.push(`Коды ошибок: ${codes.slice(-3).join(', ')}`);
    let sent = 0;
    for (const staffId of await staffUserIds()) {
      if (await telegramBot.notifyUser(staffId, lines.join('\n'), { buttonText: 'Открыть', startParam: `A_${fb.id}` })) sent++;
    }
    return sent;
  } catch (err) {
    console.warn('[SmartFlow support] staff notification failed:', err.message);
    return 0;
  }
}

module.exports = {
  sqlTime,
  hoursAgo,
  ROLE_LABELS,
  normalizeSupportCode,
  ensureSupportCode,
  backfillSupportCodes,
  newErrorCode,
  normalizeErrorCode,
  logError,
  telegramIdOf,
  ownerUserIds,
  staffRoleOf,
  staffUserIds,
  refreshBlocked,
  isBlocked,
  setBlocked,
  sessionUser,
  logAction,
  sanitizeContext,
  parseJson,
  displayNameOf,
  notifyStaffAboutFeedback
};
