// server/routes/chat.js - The signed-in person chats with SI-consultants (as a client).
// Identity always comes from the Telegram login, never from the request body.
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const chatService = require('../services/chat-service');
const marketplaceService = require('../services/marketplace-service');
const { mediaUrl } = require('../services/media-service');
const receiptService = require('../services/receipt-service');
const { readReceiptBody } = require('../middleware/image-upload');

router.use(requireAuth);

const MAX_MESSAGE_LENGTH = 2000;

async function loadConsultant(req, res) {
  const project = await chatService.activeProjectBySlug(req.params.slug);
  if (!project) {
    res.status(404).json({ error: 'not_found', message: 'SI-продавец не найден или выключен' });
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
      `SELECT c.id AS client_id, c.responsible_type, c.last_message, c.last_activity,
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
        siPaused: r.responsible_type === 'human',
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
    if (!card) return res.status(404).json({ error: 'not_found', message: 'SI-продавец не найден или выключен' });
    const project = await chatService.activeProjectBySlug(req.params.slug);
    const lead = await chatService.leadForUser(project, req.user.userId, { create: false });
    res.json({ consultant: card, siPaused: chatService.isSiPaused(lead) });
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
    const messages = lead ? await chatService.history(project.id, lead.id) : [];
    res.json({
      messages,
      siPaused: chatService.isSiPaused(lead),
      contactShared: Boolean(lead && lead.contact_consent_at),
      // Which buttons to show above the input (only when the conversation needs them)
      tools: await chatService.chatTools(project, lead, messages)
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/chat/:slug/start
 * First visit by the consultant's link: the SI greets the person and asks a first question
 */
router.post('/:slug/start', async (req, res, next) => {
  try {
    const project = await loadConsultant(req, res);
    if (!project) return;
    const lead = await chatService.leadForUser(project, req.user.userId);
    const opener = await chatService.startConversation(project, lead);
    res.status(opener ? 201 : 200).json({ opener, messages: await chatService.history(project.id, lead.id) });
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

/**
 * POST /api/chat/:slug/events  { type: 'buy_clicked' }
 * The client's own actions in the chat that go to the expert's event journal
 */
const CLIENT_EVENTS = ['buy_clicked'];
router.post('/:slug/events', async (req, res, next) => {
  try {
    const type = String(req.body?.type || '');
    if (!CLIENT_EVENTS.includes(type)) return res.status(400).json({ error: 'bad_request', message: 'Неизвестное событие' });
    const project = await loadConsultant(req, res);
    if (!project) return;
    const lead = await chatService.leadForUser(project, req.user.userId, { create: false });
    if (!lead) return res.json({ recorded: false });
    await chatService.clientEvent(project, lead, type, { type: 'client' });
    res.json({ recorded: true });
  } catch (err) {
    next(err);
  }
});

function sendReceiptError(res, err, next) {
  if (err instanceof receiptService.ReceiptError) {
    return res.status(err.status).json({ error: 'bad_request', code: err.code, message: err.message });
  }
  next(err);
}

/**
 * POST /api/chat/:slug/receipts  (body: the photo or PDF itself, up to 5 MB)
 * The client sends a payment receipt: the owner and the assistant check it
 */
router.post('/:slug/receipts', readReceiptBody, async (req, res, next) => {
  try {
    const project = await loadConsultant(req, res);
    if (!project) return;
    const lead = await chatService.leadForUser(project, req.user.userId);
    const receipt = await receiptService.saveReceipt(project, lead, req.body, req.user.userId);
    res.status(201).json({ receipt });
  } catch (err) {
    sendReceiptError(res, err, next);
  }
});

/**
 * GET /api/chat/:slug/receipts — my receipts for this SI-seller and their status
 */
router.get('/:slug/receipts', async (req, res, next) => {
  try {
    const project = await loadConsultant(req, res);
    if (!project) return;
    const lead = await chatService.leadForUser(project, req.user.userId, { create: false });
    res.json({ receipts: lead ? await receiptService.receiptsOf(lead.id) : [] });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/chat/:slug/contact  { response }
 * Telegram's "Поделиться контактом": the signed answer of WebApp.requestContact
 */
router.post('/:slug/contact', async (req, res, next) => {
  try {
    const project = await loadConsultant(req, res);
    if (!project) return;
    const lead = await chatService.leadForUser(project, req.user.userId);
    const result = await receiptService.shareContact(project, lead, req.user.userId, req.body?.response);
    res.json({ shared: true, phone: result.phone });
  } catch (err) {
    sendReceiptError(res, err, next);
  }
});

module.exports = router;
