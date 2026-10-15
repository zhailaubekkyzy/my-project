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
const { readReceiptBody, readVoiceBody } = require('../middleware/image-upload');
const voiceService = require('../services/voice-service');
const reviewService = require('../services/review-service');
const broadcastService = require('../services/broadcast-service');
const calendarService = require('../services/calendar-service');

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
      // "Не присылать рассылки" was pressed in this chat
      broadcastsOff: Boolean(lead && lead.broadcasts_off_at),
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
 * GET /api/chat/:slug/review — may I write a review (after "Купили") and my own review
 * POST /api/chat/:slug/review  { rating: 1–5, text } — write or change it
 */
router.get('/:slug/review', async (req, res, next) => {
  try {
    const project = await loadConsultant(req, res);
    if (!project) return;
    res.json(await reviewService.myReview(project, req.user.userId));
  } catch (err) {
    next(err);
  }
});

router.post('/:slug/review', async (req, res, next) => {
  try {
    const project = await loadConsultant(req, res);
    if (!project) return;
    const result = await reviewService.saveReview(project, req.user.userId, { rating: req.body?.rating, text: req.body?.text });
    res.status(result.created ? 201 : 200).json(result);
  } catch (err) {
    if (err instanceof reviewService.ReviewError) return res.status(err.status).json({ error: 'bad_request', code: err.code, message: err.message });
    next(err);
  }
});

/**
 * POST /api/chat/:slug/broadcasts  { off: true | false } — "Не присылать рассылки" / "Снова присылать"
 */
router.post('/:slug/broadcasts', async (req, res, next) => {
  try {
    const project = await loadConsultant(req, res);
    if (!project) return;
    const lead = await chatService.leadForUser(project, req.user.userId, { create: false });
    if (!lead) return res.status(404).json({ error: 'not_found', message: 'Переписка не найдена' });
    res.json(await broadcastService.setClientOptOut(project, lead, Boolean(req.body?.off)));
  } catch (err) {
    next(err);
  }
});

const NOT_HEARD = 'Не получилось расслышать голосовое 🙏 Напишите, пожалуйста, текстом — я сразу отвечу.';

/**
 * POST /api/chat/:slug/voice?seconds=18  (body: the recording itself, up to 1.5 minutes)
 * A voice message: kept privately, transcribed, and the SI answers the transcript like any text
 */
router.post('/:slug/voice', readVoiceBody, async (req, res, next) => {
  try {
    const project = await loadConsultant(req, res);
    if (!project) return;
    const lead = await chatService.leadForUser(project, req.user.userId);
    const voice = await voiceService.saveVoice(project, lead, req.body, req.query.seconds, req.user.userId);
    if (voice.transcript) {
      const result = await chatService.handleClientMessage(project, lead, voice.transcript, voice);
      return res.status(201).json(result);
    }
    // Not transcribed (no OpenAI key or a failure): the voice is kept; the SI asks to write instead
    const message = await chatService.saveMessage(lead, { type: 'client' }, 'Голосовое сообщение', voice);
    const reply = chatService.isSiPaused(lead) ? null : await chatService.saveMessage(lead, { type: 'si' }, NOT_HEARD);
    res.status(201).json({ message, reply, transcribed: false });
  } catch (err) {
    if (err instanceof voiceService.VoiceError) {
      return res.status(err.status).json({ error: 'bad_request', code: err.code, message: err.message });
    }
    next(err);
  }
});

/**
 * GET /api/chat/:slug/voice/:voiceId — my own voice message, to play it
 */
router.get('/:slug/voice/:voiceId', async (req, res, next) => {
  try {
    const project = await loadConsultant(req, res);
    if (!project) return;
    const lead = await chatService.leadForUser(project, req.user.userId, { create: false });
    const file = lead ? await voiceService.voiceFile(lead.id, req.params.voiceId) : null;
    if (!file) return res.status(404).json({ error: 'not_found', message: 'Голосовое не найдено' });
    sendPrivateFile(res, file);
  } catch (err) {
    next(err);
  }
});

function sendPrivateFile(res, file) {
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.send(file.buffer);
}

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

function sendCalendarError(res, err, next) {
  if (err instanceof calendarService.CalendarError) {
    return res.status(err.status).json({ error: 'bad_request', code: err.code, message: err.message });
  }
  next(err);
}

// What the client sees: free times, the meeting and the expert's rules
async function calendarView(lead, now = new Date()) {
  const settings = await calendarService.settingsOf(lead.business_id);
  const meeting = await calendarService.upcomingOfClient(lead.id, now);
  return {
    enabled: await calendarService.isEnabled(lead.business_id),
    durationMinutes: settings.durationMinutes,
    rules: {
      clientCanCancel: settings.clientCanCancel,
      clientCanReschedule: settings.clientCanReschedule,
      hoursBefore: settings.hoursBefore
    },
    slots: (await calendarService.freeSlots(lead.business_id, now, { excludeMeetingId: meeting && meeting.id })).map(s => s.at),
    meeting: meeting && {
      id: meeting.id,
      startsAt: meeting.startsAt,
      endsAt: meeting.endsAt,
      zoomUrl: meeting.zoomUrl,
      canCancel: calendarService.clientMay('cancel', meeting, settings, now),
      canReschedule: calendarService.clientMay('reschedule', meeting, settings, now)
    }
  };
}

async function loadLeadWithCalendar(req, res) {
  const project = await loadConsultant(req, res);
  if (!project) return {};
  const lead = await chatService.leadForUser(project, req.user.userId);
  if (!lead.business_id || !(await calendarService.isEnabled(lead.business_id))) {
    res.status(404).json({ error: 'not_found', code: 'NO_CALENDAR', message: 'Запись к этому эксперту пока не открыта.' });
    return {};
  }
  return { project, lead };
}

/**
 * GET /api/chat/:slug/calendar — free times (14 days ahead) and my upcoming meeting
 */
router.get('/:slug/calendar', async (req, res, next) => {
  try {
    const { lead } = await loadLeadWithCalendar(req, res);
    if (!lead) return;
    res.json(await calendarView(lead));
  } catch (err) {
    sendCalendarError(res, err, next);
  }
});

/**
 * POST /api/chat/:slug/calendar/book  { at, tzOffset }
 */
router.post('/:slug/calendar/book', async (req, res, next) => {
  try {
    const { project, lead } = await loadLeadWithCalendar(req, res);
    if (!lead) return;
    const meeting = await calendarService.book(chatService, project, lead, req.body?.at, { tzOffset: req.body?.tzOffset });
    res.status(201).json({ meeting, calendar: await calendarView(lead) });
  } catch (err) {
    sendCalendarError(res, err, next);
  }
});

async function myMeeting(lead, meetingId) {
  const meeting = await calendarService.upcomingOfClient(lead.id);
  if (!meeting || meeting.id !== meetingId) {
    throw new calendarService.CalendarError('Встреча не найдена.', 404, 'NO_MEETING');
  }
  return meeting;
}

/**
 * POST /api/chat/:slug/calendar/:meetingId/reschedule  { at, tzOffset }
 * Allowed by the expert's rules (whether and how many hours before)
 */
router.post('/:slug/calendar/:meetingId/reschedule', async (req, res, next) => {
  try {
    const { project, lead } = await loadLeadWithCalendar(req, res);
    if (!lead) return;
    const meeting = await myMeeting(lead, req.params.meetingId);
    const settings = await calendarService.settingsOf(lead.business_id);
    if (!calendarService.clientMay('reschedule', meeting, settings)) {
      throw new calendarService.CalendarError(settings.clientCanReschedule
        ? `Перенести можно не позже чем за ${settings.hoursBefore} ч до встречи — напишите, пожалуйста, в чат.`
        : 'Перенести встречу можно только через эксперта — напишите, пожалуйста, в чат.', 403, 'NOT_ALLOWED');
    }
    const moved = await calendarService.book(chatService, project, lead, req.body?.at, { tzOffset: req.body?.tzOffset, replaceMeeting: meeting });
    res.json({ meeting: moved, calendar: await calendarView(lead) });
  } catch (err) {
    sendCalendarError(res, err, next);
  }
});

/**
 * POST /api/chat/:slug/calendar/:meetingId/cancel
 */
router.post('/:slug/calendar/:meetingId/cancel', async (req, res, next) => {
  try {
    const { project, lead } = await loadLeadWithCalendar(req, res);
    if (!lead) return;
    const meeting = await myMeeting(lead, req.params.meetingId);
    await calendarService.cancel(chatService, project, lead, meeting, { type: 'client', userId: req.user.userId });
    res.json({ cancelled: true, calendar: await calendarView(lead) });
  } catch (err) {
    sendCalendarError(res, err, next);
  }
});

module.exports = router;
