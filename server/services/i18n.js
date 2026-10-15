// server/services/i18n.js - The language of a person (RU/EN) for messages to clients.
// Chosen in Профиль → «Язык» (users.lang), otherwise Telegram's language (users.tg_lang):
// Russian for ru, kk, uk and neighbours, English for the rest. Expert-facing texts stay Russian.
const RU_FAMILY = ['ru', 'kk', 'uk', 'be', 'uz', 'ky', 'tg', 'tk', 'az', 'hy', 'ka'];

function langOf(user) {
  if (!user) return 'ru';
  if (user.lang === 'en' || user.lang === 'ru') return user.lang;
  const code = String(user.tg_lang || '').slice(0, 2).toLowerCase();
  return !code || RU_FAMILY.includes(code) ? 'ru' : 'en';
}

/**
 * A text for this person: a plain string, or { ru, en } — picked by their language.
 */
function pick(text, lang) {
  if (text && typeof text === 'object') return lang === 'en' && text.en ? text.en : text.ru;
  return text;
}

/**
 * The language of a person by id, or of a client of an SI-seller (their own user id is external_client_id).
 */
async function langOfUserId(userId) {
  if (!userId || !String(userId).startsWith('usr_')) return 'ru';
  const db = require('../db');
  return langOf(await db.get('SELECT lang, tg_lang FROM users WHERE id = ?', [userId]));
}

const langOfClient = (client) => langOfUserId(client && client.external_client_id);

module.exports = { RU_FAMILY, langOf, pick, langOfUserId, langOfClient };
