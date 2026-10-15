// server/routes/marketplace.js - Marketplace catalog and public profiles (no login needed).
const express = require('express');
const router = express.Router();
const marketplaceService = require('../services/marketplace-service');
const reviewService = require('../services/review-service');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');

/**
 * GET /api/marketplace?category=sales|warmup
 */
router.get('/', async (req, res, next) => {
  try {
    res.json({ consultants: await marketplaceService.listConsultants({ category: req.query.category }) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/marketplace/consultants/:projectId
 */
router.get('/consultants/:projectId', async (req, res, next) => {
  try {
    const card = await marketplaceService.getCard({ id: req.params.projectId });
    if (!card) return res.status(404).json({ error: 'not_found', message: 'Карточка не найдена или снята с витрины' });
    res.json({ consultant: card });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/marketplace/profiles/:userId
 */
/**
 * GET /api/marketplace/partners — who has the «SMARTFLOW PARTNER» badge (public, shown next to the person)
 */
router.get('/partners', async (req, res, next) => {
  try {
    res.json({ partners: await require('../services/partner-service').partnerList() });
  } catch (err) {
    next(err);
  }
});

router.get('/profiles/:userId', async (req, res, next) => {
  try {
    const profile = await marketplaceService.getPublicProfile(req.params.userId);
    if (!profile) return res.status(404).json({ error: 'not_found', message: 'Профиль не найден' });
    res.json({ profile });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/marketplace/consultants/:projectId/reviews?offset=
 * Reviews of real clients (short names only), with the average rating. Listed SI-sellers only.
 */
router.get('/consultants/:projectId/reviews', async (req, res, next) => {
  try {
    const project = await db.get(`SELECT id FROM projects WHERE id = ? AND status = 'active' AND is_listed = 1`, [req.params.projectId]);
    if (!project) return res.status(404).json({ error: 'not_found', message: 'Карточка не найдена или снята с витрины' });
    res.json(await reviewService.publicReviews(project.id, { offset: req.query.offset }));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/marketplace/reviews/:reviewId/report  { reason } — "Пожаловаться" on a review (the team decides)
 */
router.post('/reviews/:reviewId/report', requireAuth, async (req, res, next) => {
  try {
    res.json(await reviewService.report(req.params.reviewId, req.user.userId, req.body?.reason));
  } catch (err) {
    if (err instanceof reviewService.ReviewError) return res.status(err.status).json({ error: 'bad_request', code: err.code, message: err.message });
    next(err);
  }
});

module.exports = router;
