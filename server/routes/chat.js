// server/routes/chat.js - The signed-in person chats with SI-consultants (as a client).
// Identity always comes from the Telegram login, never from the request body.
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const chatService = require('../services/chat-service');
const marketplaceService = require('../services/marketplace-service');
const { mediaUrl } = require('../services/media-service');

router.use(requireAuth);

const MAX_MESSAGE_LENGTH = 2000;

async function loadConsultant(req, res) {
  const project = await chatService.activeProjectBySlug(req.params.slug);
  if (!project) {
    res.status(404).json({ error: 'not_found', message: 'SI-консультант не найден или выключен' });
    return null;
  }
  return project;
}

/**
 * GET /api/chat
 * My chats with SI-consultants (newest first)
 */
router.get('/', async (req, res, next) => {
  try {
    const rows = await db.all(
      `SELECT c.id AS client_id, c.status, c.last_message, c.last_activity,
              p.slug, p.name, p.role_title, p.photo_media_id, p.owner_id,
              (SELECT COUNT(*) FROM conversations m WHERE m.client_id = c.id AND m.sender = 'expert_human') AS expert_messages
       FROM clients c
       JOIN projects p ON p.id = c.project_id
       WHERE c.external_client_id = ? AND p.status = 'active'
       ORDER BY c.last_activity DESC`,
      [req.user.userId]
    );
    const chats = [];
    for (const r of rows) {
      const owner = await db.get('SELECT display_name, profile FROM users WHERE id = ?', [r.owner_id]);
      let expertName = owner ? owner.display_name : '';
      try { expertName = (JSON.parse(owner.profile || '{}').displayName || '').trim() || expertName; } catch (e) {}
      chats.push({
        slug: r.slug,
        name: r.name,
        roleTitle: r.role_title || 'SI-консультант',
        photoUrl: mediaUrl(r.photo_media_id),
        expertName,
        lastMessage: r.last_message || '',
        lastActivity: r.last_activity,
        siPaused: r.status === 'human_needed',
        expertReplied: Number(r.expert_messages) > 0
      });
    }
    res.json({ chats });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/chat/:slug
 * The consultant card (also for unlisted consultants: the owner shares this link)
 */
router.get('/:slug', async (req, res, next) => {
  try {
    const card = await marketplaceService.getCard({ slug: req.params.slug });
    if (!card) return res.status(404).json({ error: 'not_found', message: 'SI-консультант не найден или выключен' });
    const project = await chatService.activeProjectBySlug(req.params.slug);
    const lead = await chatService.leadForUser(project, req.user.userId, { create: false });
    res.json({ consultant: card, siPaused: Boolean(lead && lead.status === 'human_needed') });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/chat/:slug/messages
 * My messages with this consultant
 */
router.get('/:slug/messages', async (req, res, next) => {
  try {
    const project = await loadConsultant(req, res);
    if (!project) return;
    const lead = await chatService.leadForUser(project, req.user.userId, { create: false });
    res.json({
      messages: lead ? await chatService.history(project.id, lead.id) : [],
      siPaused: Boolean(lead && lead.status === 'human_needed')
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/chat/:slug/messages  { text }
 * Saves my message; the SI answers (unless the expert took over or the limit is used up)
 */
router.post('/:slug/messages', async (req, res, next) => {
  try {
    const text = String(req.body?.text || '').trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!text) return res.status(400).json({ error: 'bad_request', message: 'Сообщение не может быть пустым' });
    const project = await loadConsultant(req, res);
    if (!project) return;
    const lead = await chatService.leadForUser(project, req.user.userId);
    const result = await chatService.handleClientMessage(project, lead, text);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/chat/:slug/human  { reason }
 * "Связаться с человеком": the expert gets a request and a Telegram message
 */
router.post('/:slug/human', async (req, res, next) => {
  try {
    const project = await loadConsultant(req, res);
    if (!project) return;
    const lead = await chatService.leadForUser(project, req.user.userId);
    const reason = String(req.body?.reason || '').trim().slice(0, 1000) || undefined;
    const result = await chatService.createHumanRequest(project, lead, { reason });
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
