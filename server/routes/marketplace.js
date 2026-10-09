// server/routes/marketplace.js - Marketplace catalog and public profiles (no login needed).
const express = require('express');
const router = express.Router();
const marketplaceService = require('../services/marketplace-service');

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
router.get('/profiles/:userId', async (req, res, next) => {
  try {
    const profile = await marketplaceService.getPublicProfile(req.params.userId);
    if (!profile) return res.status(404).json({ error: 'not_found', message: 'Профиль не найден' });
    res.json({ profile });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
