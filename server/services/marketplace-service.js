// server/services/marketplace-service.js - Public cards of SI-consultants and public profiles.
// Only real data: a consultant appears in the Marketplace when its owner turns "Показывать
// в Маркетплейсе" on; demo rows (is_demo = 1) never appear.
const db = require('../db');
const { mediaUrl } = require('./media-service');
const profileService = require('./profile-service');

const CARD_SQL = `
  SELECT p.*, u.id AS author_id, u.display_name AS author_tg_name, u.profile AS author_profile,
         u.photo_media_id AS author_photo_media_id, u.avatar_url AS author_avatar_url,
         (SELECT COUNT(*) FROM clients c WHERE c.project_id = p.id) AS dialogs
  FROM projects p
  JOIN users u ON u.id = p.owner_id`;

function toCard(row) {
  const authorUser = {
    display_name: row.author_tg_name,
    profile: row.author_profile,
    photo_media_id: row.author_photo_media_id,
    avatar_url: row.author_avatar_url
  };
  const author = profileService.toPublicUser({ id: row.author_id, ...authorUser });
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    roleTitle: row.role_title || 'SI-консультант',
    photoUrl: mediaUrl(row.photo_media_id),
    category: row.category || 'sales',
    offer: row.offer || '',
    description: row.description || '',
    priceLabel: row.price_label || '',
    paymentUrl: row.payment_url || null,
    trialDays: Number(row.trial_days) || 0,
    isListed: Boolean(row.is_listed),
    stats: { dialogs: Number(row.dialogs) || 0 },
    author: {
      id: row.author_id,
      name: author.displayName,
      photoUrl: author.photoUrl,
      trust: profileService.trustScore(authorUser)
    }
  };
}

async function listConsultants({ category } = {}) {
  const params = [];
  let where = `WHERE p.is_listed = 1 AND p.status = 'active' AND p.is_demo = 0 AND COALESCE(p.offer, '') <> ''`;
  if (category === 'sales' || category === 'warmup') {
    where += ' AND p.category = ?';
    params.push(category);
  }
  const rows = await db.all(`${CARD_SQL} ${where} ORDER BY dialogs DESC, p.created_at DESC LIMIT 100`, params);
  return rows.map(toCard);
}

// A card by id or slug: listed ones for everybody; an unlisted one only by its own link (slug)
async function getCard({ id, slug }) {
  const row = id
    ? await db.get(`${CARD_SQL} WHERE p.id = ? AND p.status = 'active' AND p.is_listed = 1`, [id])
    : await db.get(`${CARD_SQL} WHERE p.slug = ? AND p.status = 'active'`, [slug]);
  return row ? toCard(row) : null;
}

async function getPublicProfile(userId) {
  const user = await db.get(`SELECT * FROM users WHERE id = ? AND status = 'active'`, [userId]);
  if (!user) return null;
  const pub = profileService.toPublicUser(user);
  const consultants = await db.all(
    `${CARD_SQL} WHERE p.owner_id = ? AND p.is_listed = 1 AND p.status = 'active' ORDER BY p.created_at DESC`,
    [userId]
  );
  return {
    id: pub.id,
    displayName: pub.displayName,
    username: pub.username,
    photoUrl: pub.photoUrl,
    profile: pub.profile,
    trust: profileService.trustScore(user),
    consultants: consultants.map(toCard)
  };
}

module.exports = {
  listConsultants,
  getCard,
  getPublicProfile
};
