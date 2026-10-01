// server/routes/subscriptions.js - Platform and Funnel Subscriptions
const express = require('express');
const router = express.Router();
const subscriptionService = require('../services/subscription-service');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

/**
 * GET /api/subscriptions/my
 * Returns platform subscription and all marketer funnel subscriptions
 */
router.get('/my', async (req, res, next) => {
  try {
    const platform = await subscriptionService.getPlatformSubscription(req.user.userId);
    const funnels = await subscriptionService.getExpertFunnelSubscriptions(req.user.userId);

    res.json({
      platform,
      funnels
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/subscriptions/subscribe
 * Subscribe expert to a marketer's template
 */
router.post('/subscribe', async (req, res, next) => {
  try {
    const { templateId, customPaymentUrl } = req.body;
    if (!templateId) {
      return res.status(400).json({ error: 'bad_request', message: 'templateId обязателен' });
    }

    const result = await subscriptionService.subscribeToTemplate(req.user.userId, templateId, customPaymentUrl);
    res.status(201).json({
      message: 'Подписка на воронку успешно активирована. Создан ваш персональный экземпляр проекта.',
      ...result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/subscriptions/:id/cancel
 * Cancel a funnel subscription
 * RULE: Data is NEVER deleted! Access remains active until paid period ends.
 */
router.post('/:id/cancel', async (req, res, next) => {
  try {
    const { reason } = req.body;
    const result = await subscriptionService.cancelFunnelSubscription(req.params.id, req.user.userId, reason);

    if (!result.success) {
      return res.status(404).json({ error: 'not_found', message: 'Подписка не найдена или принадлежит другому эксперту' });
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
