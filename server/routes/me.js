// server/routes/me.js - The signed-in user's own profile and photo.
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { readImageBody } = require('../middleware/image-upload');
const mediaService = require('../services/media-service');
const profileService = require('../services/profile-service');
const businessService = require('../services/business-service');

router.use(requireAuth);

async function loadUser(userId) {
  return db.get('SELECT * FROM users WHERE id = ?', [userId]);
}

/**
 * GET /api/me/notifications — my notifications for Buddy (newest first) and how many are unread
 */
router.get('/notifications', async (req, res, next) => {
  try {
    const rows = await db.all(
      'SELECT id, text, start_param, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 30',
      [req.user.userId]
    );
    const unread = await db.get('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL', [req.user.userId]);
    res.json({
      notifications: rows.map(r => ({ id: r.id, text: r.text, startParam: r.start_param, read: Boolean(r.read_at), createdAt: r.created_at })),
      unread: Number(unread.count) || 0
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/me/notifications/read  { id } — one notification, or all of mine without id
 */
router.post('/notifications/read', async (req, res, next) => {
  try {
    const id = req.body && req.body.id ? String(req.body.id) : null;
    await db.run(
      `UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL${id ? ' AND id = ?' : ''}`,
      id ? [req.user.userId, id] : [req.user.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/me/profile
 */
router.get('/profile', async (req, res, next) => {
  try {
    const user = await loadUser(req.user.userId);
    if (!user) return res.status(404).json({ error: 'not_found', message: 'Пользователь не найден' });
    res.json({ user: profileService.toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/me/profile
 * Body: { displayName, headline, bio, regalia, results, links: [{label, url}], offerButton, language }
 */
router.put('/profile', async (req, res, next) => {
  try {
    const user = await profileService.updateProfile(req.user.userId, req.body || {});
    if (!user) return res.status(404).json({ error: 'not_found', message: 'Пользователь не найден' });
    // Office terms accepted = the expert turns their SI-sellers on: the business appears
    const agreed = profileService.toPublicUser(user).profile.businessAgreedAt;
    if (agreed && await db.get('SELECT id FROM projects WHERE owner_id = ? LIMIT 1', [user.id])) {
      await businessService.ensureBusiness(user.id);
    }
    res.json({ user: profileService.toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/me/photo
 * Body: the image file itself (JPEG, PNG or WebP, up to 2 MB).
 */
router.post('/photo', readImageBody, async (req, res, next) => {
  try {
    const user = await loadUser(req.user.userId);
    if (!user) return res.status(404).json({ error: 'not_found', message: 'Пользователь не найден' });

    const saved = await mediaService.saveImage(user.id, req.body, 'user_photo');
    await db.run('UPDATE users SET photo_media_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [saved.id, user.id]);
    await mediaService.deleteImage(user.photo_media_id);

    res.status(201).json({ photoUrl: saved.url });
  } catch (err) {
    if (err instanceof mediaService.MediaError) {
      return res.status(err.status).json({ error: 'bad_request', code: err.code, message: err.message });
    }
    next(err);
  }
});

module.exports = router;
