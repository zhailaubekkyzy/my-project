// server/routes/projects.js - Expert Projects & Funnel Instances Management
const express = require('express');
const router = express.Router();
const projectService = require('../services/project-service');
const { requireAuth } = require('../middleware/auth');
const { requireProjectPermission } = require('../middleware/permissions');
const db = require('../db');

// All project routes require valid authenticated user session
router.use(requireAuth);

/**
 * GET /api/projects
 * List all projects owned by or shared with current user
 */
router.get('/', async (req, res, next) => {
  try {
    const projects = await projectService.getUserProjects(req.user.userId);
    res.json(projects);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/projects
 * Create a new expert project / funnel instance
 */
router.post('/', async (req, res, next) => {
  try {
    const { name, templateId, niche, customAiSettings, pricingOptions } = req.body;

    const project = await projectService.createProject(req.user.userId, {
      name,
      templateId,
      niche,
      customAiSettings,
      pricingOptions
    });

    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/projects/:projectId
 * Get details of a specific project (requires funnel:read permission)
 */
router.get('/:projectId', requireProjectPermission('funnel:read'), async (req, res) => {
  const p = req.project;
  res.json({
    ...p,
    custom_ai_settings: projectService.safeJsonParse(p.custom_ai_settings),
    pricing_options: projectService.safeJsonParse(p.pricing_options),
    stats: projectService.safeJsonParse(p.stats),
    userRole: req.projectRole,
    permissions: req.projectPermissions
  });
});

/**
 * PUT /api/projects/:projectId
 * Update project settings (requires funnel:write permission)
 * Note: owner_id CANNOT be modified or spoofed by client!
 */
router.put('/:projectId', requireProjectPermission('funnel:write'), async (req, res, next) => {
  try {
    const { name, niche, custom_ai_settings, pricing_options, status } = req.body;

    const updated = await projectService.updateProject(req.params.projectId, {
      name,
      niche,
      custom_ai_settings,
      pricing_options,
      status
    });

    res.json({
      ...updated,
      custom_ai_settings: projectService.safeJsonParse(updated.custom_ai_settings),
      pricing_options: projectService.safeJsonParse(updated.pricing_options),
      stats: projectService.safeJsonParse(updated.stats)
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/projects/:projectId/analytics
 * Get project metrics (requires analytics:read permission)
 */
router.get('/:projectId/analytics', requireProjectPermission('analytics:read'), async (req, res) => {
  const p = req.project;
  const stats = projectService.safeJsonParse(p.stats, {
    traffic: 0,
    leads: 0,
    qualified: 0,
    bookings: 0,
    cr: 0,
    revenueRub: 0,
    savedHours: 0
  });

  // Calculate live counts from database
  const leadCount = await db.get('SELECT COUNT(*) as count FROM clients WHERE project_id = ?', [p.id]);
  const waitingInquiries = await db.get(
    'SELECT COUNT(*) as count FROM direct_inquiries WHERE project_id = ? AND status = ?',
    [p.id, 'waiting']
  );

  res.json({
    stats: {
      ...stats,
      totalLeadsInDb: leadCount ? leadCount.count : 0,
      activeHumanInquiries: waitingInquiries ? waitingInquiries.count : 0
    }
  });
});

module.exports = router;
