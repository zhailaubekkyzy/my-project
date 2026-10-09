// server/routes/auth.js - Authentication Routes
const express = require('express');
const router = express.Router();
const authService = require('../services/auth-service');
const projectService = require('../services/project-service');
const subscriptionService = require('../services/subscription-service');
const profileService = require('../services/profile-service');
const { requireAuth } = require('../middleware/auth');
const config = require('../config');
const db = require('../db');

/**
 * POST /api/auth/telegram
 * Authenticates user via Telegram WebApp initData
 */
router.post('/telegram', async (req, res, next) => {
  try {
    const { initData, role } = req.body;

    if (!initData) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'Параметр initData обязателен для авторизации через Telegram'
      });
    }

    // Cryptographic verification of HMAC-SHA256 and expiration
    const verification = authService.verifyTelegramInitData(initData);
    if (!verification.valid) {
      const isExpired = verification.error === 'expired_auth_data';
      return res.status(401).json({
        error: 'unauthorized',
        code: isExpired ? 'TELEGRAM_INITDATA_EXPIRED' : 'INVALID_TELEGRAM_SIGNATURE',
        message: isExpired
          ? 'Данные авторизации Telegram устарели. Пожалуйста, перезапустите Mini App.'
          : 'Поддельная или поврежденная подпись Telegram авторизации.',
        details: verification.error
      });
    }

    if (!verification.user || !verification.user.id) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'Telegram initData не содержит информации о пользователе'
      });
    }

    // Find or create permanent internal user
    const user = await authService.findOrCreateTelegramUser(verification.user, role || 'expert');
    const token = authService.generateSessionToken(user);

    // Fetch user projects and subscription
    const projects = await projectService.getUserProjects(user.id);
    const subscription = await subscriptionService.getPlatformSubscription(user.id);

    res.json({
      token,
      user: { ...profileService.toPublicUser(user), telegramId: user.telegramId },
      projects,
      subscription
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/me
 * Retrieves current authenticated user profile and projects
 */
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.userId]);
    if (!user) {
      return res.status(404).json({ error: 'not_found', message: 'Пользователь не найден' });
    }

    const projects = await projectService.getUserProjects(user.id);
    const subscription = await subscriptionService.getPlatformSubscription(user.id);
    const funnelSubs = await subscriptionService.getExpertFunnelSubscriptions(user.id);

    res.json({
      user: profileService.toPublicUser(user),
      projects,
      subscription,
      funnelSubscriptions: funnelSubs
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/dev-login
 * Development & pitch demo login helper.
 * STRICT SECURITY REQUIREMENT: Absolutely blocked in production environment!
 */
router.post('/dev-login', async (req, res, next) => {
  try {
    if (config.isProd) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Dev-логин строго запрещен в production окружении.'
      });
    }

    const { role = 'expert', userId: requestedUserId } = req.body;

    let targetUserId = requestedUserId;
    if (!targetUserId) {
      if (role === 'marketer') {
        targetUserId = 'user_demo_marketer_gromov';
      } else {
        targetUserId = 'user_demo_expert_elena';
      }
    }

    const user = await db.get('SELECT * FROM users WHERE id = ?', [targetUserId]);
    if (!user) {
      return res.status(404).json({ error: 'not_found', message: 'Демо-пользователь не найден в БД' });
    }

    let roles = ['expert'];
    try {
      roles = JSON.parse(user.roles);
    } catch (e) {}

    const token = authService.generateSessionToken({ ...user, roles });
    const projects = await projectService.getUserProjects(user.id);
    const subscription = await subscriptionService.getPlatformSubscription(user.id);

    res.json({
      token,
      user: profileService.toPublicUser(user),
      projects,
      subscription,
      isDevBypass: true
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
