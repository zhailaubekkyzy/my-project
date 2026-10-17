// server/services/app-info.js - What the app needs to know about this copy of SmartFlow.
//
// Two copies run from one code: the working one (APP_ENV unset = production) and the test copy
// (APP_ENV=staging: its own bot, Railway server and Supabase database, «ТЕСТ» strip on top).
//
// Risky changes are switched on for one person first (FEATURES + BETA_USERS in Railway):
//   FEATURES   = "new-chat:beta,voice-v2:all,old-thing:off"   (no ":..." means all)
//   BETA_USERS = "SF-48213,SF-10001"                          (SF-numbers, Telegram ids, usr_... ids)
// In code: `await appInfo.isOn('new-chat', userId)`; on the phone: `SF.feature('new-chat')`.
// A flag that is not listed is off. Remove the flag from the code once it is on for everyone.
const db = require('../db');
const config = require('../config');
const telegramBot = require('./telegram-bot');

const MODES = new Set(['beta', 'all', 'off']);

// "name:beta,other" → { name: 'beta', other: 'all' }
function parseFeatures(entries = config.features) {
  const features = {};
  for (const entry of entries) {
    const [rawName, rawMode] = entry.split(':').map(v => v.trim());
    const name = String(rawName || '').toLowerCase();
    if (!/^[a-z0-9_-]{1,40}$/.test(name)) continue;
    const mode = String(rawMode || 'all').toLowerCase();
    features[name] = MODES.has(mode) ? mode : 'off';
  }
  return features;
}

// Is this person in BETA_USERS (by SF-number, Telegram id or usr_... id)?
async function isBetaUser(userId) {
  if (!userId || !config.betaUsers.length) return false;
  const user = await db.get('SELECT id, support_code FROM users WHERE id = ?', [userId]);
  if (!user) return false;
  const telegramId = await telegramBot.telegramIdOfUser(userId);
  const normalizeSupportCode = require('./support-service').normalizeSupportCode;
  return config.betaUsers.some(entry => {
    if (/^sf/i.test(entry)) return Boolean(user.support_code) && normalizeSupportCode(entry) === user.support_code;
    if (/^\d+$/.test(entry)) return Boolean(telegramId) && String(telegramId) === entry;
    return entry === user.id;
  });
}

async function featuresFor(userId) {
  const features = parseFeatures();
  const names = Object.keys(features);
  if (!names.length) return [];
  const beta = names.some(n => features[n] === 'beta') ? await isBetaUser(userId) : false;
  return names.filter(n => features[n] === 'all' || (features[n] === 'beta' && beta));
}

async function isOn(name, userId) {
  return (await featuresFor(userId)).includes(String(name).toLowerCase());
}

/**
 * Sent with every sign-in: which copy this is, the Mini App link of its own bot, the person's flags.
 */
async function forUser(userId) {
  return {
    env: config.appEnv,
    appLink: telegramBot.miniAppLink(),
    features: await featuresFor(userId)
  };
}

module.exports = { parseFeatures, isBetaUser, featuresFor, isOn, forUser };
