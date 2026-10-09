// server/services/profile-service.js - User profile and profile-landing data.
const db = require('../db');
const { mediaUrl } = require('./media-service');

// displayName here is the name chosen in the app; the Telegram name stays in users.display_name
// (it is refreshed on every Telegram login, so it must not hold the user's own edits).
const TEXT_LIMITS = { displayName: 80, headline: 120, bio: 800, regalia: 800, results: 800 };
const MAX_LINKS = 8;
const LANGUAGES = ['ru', 'en'];

function parseJson(str, fallback) {
  if (!str) return fallback;
  if (typeof str === 'object') return str;
  try {
    return JSON.parse(str);
  } catch (e) {
    return fallback;
  }
}

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function cleanUrl(value) {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  // Only web links: no javascript:, data: or other schemes that could run code when clicked
  return /^https?:\/\/[^\s<>"']+$/i.test(url) && url.length <= 300 ? url : null;
}

/**
 * Keeps only known profile fields with safe values. Unknown fields are dropped.
 */
function sanitizeProfile(input = {}) {
  const profile = {};
  for (const [key, max] of Object.entries(TEXT_LIMITS)) {
    profile[key] = cleanText(input[key], max);
  }
  profile.links = (Array.isArray(input.links) ? input.links : [])
    .map(link => ({ label: cleanText(link && link.label, 40), url: cleanUrl(link && link.url) }))
    .filter(link => link.url)
    .slice(0, MAX_LINKS);
  const offer = input.offerButton || {};
  const offerUrl = cleanUrl(offer.url);
  profile.offerButton = offerUrl || offer.consultantId
    ? { label: cleanText(offer.label, 40) || 'Мой оффер', url: offerUrl, consultantId: cleanText(offer.consultantId, 64) || null }
    : null;
  profile.language = LANGUAGES.includes(input.language) ? input.language : 'ru';
  // When the person accepted the business-profile terms (opens the Office)
  const agreed = typeof input.businessAgreedAt === 'string' ? new Date(input.businessAgreedAt) : null;
  profile.businessAgreedAt = agreed && !isNaN(agreed) ? agreed.toISOString() : null;
  return profile;
}

/**
 * Trust percent of a profile (same rules as SF.trustScore in js/ui.js).
 */
function trustScore(user) {
  const p = parseJson(user.profile, {});
  const hasPhoto = Boolean(user.photo_media_id || user.avatar_url);
  return (hasPhoto ? 20 : 0) + (p.headline ? 10 : 0) + (p.bio ? 15 : 0) + (p.regalia ? 15 : 0) +
    (p.results ? 20 : 0) + ((p.links || []).length ? 10 : 0) + (p.offerButton ? 10 : 0);
}

/**
 * Shape of the user returned to the Mini App. photoUrl is the uploaded photo if there is
 * one, otherwise the Telegram photo.
 */
function toPublicUser(user) {
  let roles = user.roles;
  if (typeof roles === 'string') roles = parseJson(roles, ['expert']);
  return {
    id: user.id,
    displayName: (parseJson(user.profile, {}).displayName || '').trim() || user.display_name,
    telegramName: user.display_name,
    username: user.username,
    avatarUrl: user.avatar_url,
    photoUrl: mediaUrl(user.photo_media_id) || user.avatar_url || null,
    hasUploadedPhoto: Boolean(user.photo_media_id),
    profile: sanitizeProfile(parseJson(user.profile, {})),
    roles: roles || ['expert'],
    status: user.status
  };
}

async function updateProfile(userId, input) {
  const profile = sanitizeProfile(input);
  await db.run(
    'UPDATE users SET profile = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [JSON.stringify(profile), userId]
  );
  return db.get('SELECT * FROM users WHERE id = ?', [userId]);
}

module.exports = {
  cleanUrl,
  cleanText,
  trustScore,
  sanitizeProfile,
  toPublicUser,
  updateProfile
};
