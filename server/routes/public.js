// server/routes/public.js - Public pages that need no login.
// Chatting with an SI-consultant requires a Telegram login: see routes/chat.js.
const express = require('express');
const router = express.Router();
const projectService = require('../services/project-service');

/**
 * GET /api/public/funnels/:slug
 * Public landing and AI seller profile for leads.
 * Strictly protected: NEVER exposes private prompts, internal owner IDs, or CRM data.
 */
router.get('/funnels/:slug', async (req, res, next) => {
  try {
    const publicProfile = await projectService.getPublicProjectBySlug(req.params.slug);
    if (!publicProfile) {
      return res.status(404).json({ error: 'not_found', message: 'Страница SI-продавца не найдена или деактивирована' });
    }

    res.json(publicProfile);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
