// server/routes/templates.js - Marketer Funnel Blueprints
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const projectService = require('../services/project-service');

/**
 * GET /api/templates
 * List published templates (open for viewing)
 */
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const templates = await db.all(
      `SELECT ft.*, u.display_name as creator_name, u.username as creator_username, u.avatar_url as creator_avatar
       FROM funnel_templates ft
       JOIN users u ON ft.creator_id = u.id
       WHERE ft.is_published = 1
       ORDER BY ft.created_at DESC`
    );

    res.json(templates.map(t => ({
      ...t,
      ai_clone_settings: projectService.safeJsonParse(t.ai_clone_settings),
      steps: projectService.safeJsonParse(t.steps)
    })));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/templates/:id
 * Get single template by ID
 */
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const t = await db.get(
      `SELECT ft.*, u.display_name as creator_name, u.username as creator_username, u.avatar_url as creator_avatar
       FROM funnel_templates ft
       JOIN users u ON ft.creator_id = u.id
       WHERE ft.id = ?`,
      [req.params.id]
    );

    if (!t) {
      return res.status(404).json({ error: 'not_found', message: 'Шаблон воронки не найден' });
    }

    res.json({
      ...t,
      ai_clone_settings: projectService.safeJsonParse(t.ai_clone_settings),
      steps: projectService.safeJsonParse(t.steps)
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/templates
 * Create a new funnel blueprint (Marketer only)
 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const roles = req.user.roles || [];
    if (!roles.includes('marketer') && !roles.includes('admin')) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Только маркетолог может публиковать шаблоны воронок'
      });
    }

    const {
      title, niche, tagline, description, monthlyPrice = 9900,
      currency = 'RUB', trialDays = 14, badge, aiCloneSettings, steps
    } = req.body;

    if (!title || !niche) {
      return res.status(400).json({ error: 'bad_request', message: 'Поля title и niche обязательны' });
    }

    const templateId = `tmpl_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    await db.run(
      `INSERT INTO funnel_templates (
        id, creator_id, title, niche, tagline, description, monthly_price,
        currency, trial_days, badge, ai_clone_settings, steps, is_published, is_demo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`,
      [
        templateId,
        req.user.userId,
        title,
        niche,
        tagline || '',
        description || '',
        monthlyPrice,
        currency,
        trialDays,
        badge || null,
        JSON.stringify(aiCloneSettings || {}),
        JSON.stringify(steps || [])
      ]
    );

    const created = await db.get('SELECT * FROM funnel_templates WHERE id = ?', [templateId]);
    res.status(201).json({
      ...created,
      ai_clone_settings: projectService.safeJsonParse(created.ai_clone_settings),
      steps: projectService.safeJsonParse(created.steps)
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
