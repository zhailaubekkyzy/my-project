// server/routes/me.js - The signed-in user's own profile and photo.
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { readImageBody } = require('../middleware/image-upload');
const mediaService = require('../services/media-service');
const profileService = require('../services/profile-service');

router.use(requireAuth);

async function loadUser(userId) {
  return db.get('SELECT * FROM users WHERE id = ?', [userId]);
}

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
