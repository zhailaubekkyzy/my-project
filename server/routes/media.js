// server/routes/media.js - Serves uploaded photos (public: they are avatars shown to clients).
const express = require('express');
const router = express.Router();
const mediaService = require('../services/media-service');

/**
 * GET /api/media/:mediaId
 * Every upload gets a new random id, so a response never changes and can be cached for a year.
 */
router.get('/:mediaId', async (req, res, next) => {
  try {
    const image = await mediaService.getImage(req.params.mediaId);
    if (!image) {
      return res.status(404).json({ error: 'not_found', message: 'Фото не найдено' });
    }
    res.setHeader('Content-Type', image.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(image.buffer);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
