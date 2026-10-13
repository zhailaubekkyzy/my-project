// server/routes/business.js - My business: members (owner + one assistant) and funnel counts.
// Only the owner adds or removes the assistant. Rights are checked here, not by RLS.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const businessService = require('../services/business-service');
const funnelService = require('../services/funnel-service');
const calendarService = require('../services/calendar-service');
const chatService = require('../services/chat-service');
const db = require('../db');

router.use(requireAuth);

function sendBusinessError(res, err, next) {
  if (err instanceof businessService.BusinessError || err instanceof calendarService.CalendarError) {
    return res.status(err.status).json({ error: 'bad_request', code: err.code, message: err.message });
  }
  next(err);
}

/**
 * GET /api/business
 * My business with its members, and the businesses where I am the assistant
 */
router.get('/', async (req, res, next) => {
  try {
    res.json(await businessService.overview(req.user.userId));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/business/assistants  { supportCode: "SF-48213" }
 * The owner invites an assistant by the number from the assistant's Profile
 */
router.post('/assistants', async (req, res, next) => {
  try {
    const members = await businessService.addAssistant(req.user.userId, req.body?.supportCode);
    res.status(201).json({ members });
  } catch (err) {
    sendBusinessError(res, err, next);
  }
});

/**
 * DELETE /api/business/assistants/:userId
 */
router.delete('/assistants/:userId', async (req, res, next) => {
  try {
    const members = await businessService.removeAssistant(req.user.userId, req.params.userId);
    res.json({ members });
  } catch (err) {
    sendBusinessError(res, err, next);
  }
});

/**
 * GET /api/business/funnel?businessId=&status=&offset=&days=&projectId=
 * Clients per funnel status (counted on request); with status — that list, 30 at a time.
 * Owner and assistant of the business. Without businessId — my own business.
 */
router.get('/funnel', async (req, res, next) => {
  try {
    const own = await businessService.businessOfOwner(req.user.userId);
    const businessId = String(req.query.businessId || (own && own.id) || '');
    if (!businessId || !(await businessService.roleIn(businessId, req.user.userId))) {
      return res.status(404).json({ error: 'not_found', message: 'Бизнес не найден' });
    }
    // days: 7 / 30 (clients active in that period), empty = all time; projectId: one SI-seller
    const filter = { days: req.query.days, projectId: req.query.projectId || null };
    const result = {
      businessId,
      statuses: funnelService.STATUSES,
      counts: await funnelService.counts(businessId, filter)
    };
    if (req.query.status) {
      result.clients = await funnelService.clientsInStatus(businessId, String(req.query.status), { ...filter, offset: req.query.offset });
      result.pageSize = funnelService.PAGE_SIZE;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ---------- Calendar ----------
// The owner sets the rules and the free windows (for himself and for the assistant);
// the owner and the assistant see the meetings, cancel them and mark the outcome.

async function calendarBusiness(req, res) {
  const own = await businessService.businessOfOwner(req.user.userId);
  const businessId = String(req.query.businessId || req.body?.businessId || (own && own.id) || '');
  const role = businessId ? await businessService.roleIn(businessId, req.user.userId) : null;
  if (!role) {
    res.status(404).json({ error: 'not_found', message: 'Бизнес не найден' });
    return {};
  }
  return { businessId, role };
}

async function calendarOverview(businessId, role) {
  return {
    businessId,
    role,
    durations: calendarService.DURATIONS,
    settings: await calendarService.settingsOf(businessId),
    hosts: await calendarService.hostsOf(businessId),
    enabled: await calendarService.isEnabled(businessId),
    meetings: await calendarService.meetingsOfBusiness(businessId)
  };
}

/**
 * GET /api/business/calendar?businessId=
 * Without businessId — my own business (none yet: { businessId: null }, it appears with the first SI-seller)
 */
router.get('/calendar', async (req, res, next) => {
  try {
    if (!req.query.businessId && !(await businessService.businessOfOwner(req.user.userId))) {
      return res.json({ businessId: null });
    }
    const { businessId, role } = await calendarBusiness(req, res);
    if (!businessId) return;
    res.json(await calendarOverview(businessId, role));
  } catch (err) {
    sendBusinessError(res, err, next);
  }
});

function ownerOnly(res, role) {
  if (role === 'owner') return true;
  res.status(403).json({ error: 'forbidden', message: 'Настройки календаря меняет владелец бизнеса' });
  return false;
}

/**
 * PUT /api/business/calendar/settings  { durationMinutes, clientCanCancel, clientCanReschedule, hoursBefore, tzOffset }
 */
router.put('/calendar/settings', async (req, res, next) => {
  try {
    const { businessId, role } = await calendarBusiness(req, res);
    if (!businessId || !ownerOnly(res, role)) return;
    await calendarService.saveSettings(businessId, req.body || {});
    res.json(await calendarOverview(businessId, role));
  } catch (err) {
    sendBusinessError(res, err, next);
  }
});

/**
 * PUT /api/business/calendar/hosts/:userId  { active, zoomUrl, windows: [{ day, from, to }] }
 * The owner sets the windows for himself and for the assistant
 */
router.put('/calendar/hosts/:userId', async (req, res, next) => {
  try {
    const { businessId, role } = await calendarBusiness(req, res);
    if (!businessId || !ownerOnly(res, role)) return;
    await calendarService.saveHost(businessId, req.params.userId, req.body || {});
    res.json(await calendarOverview(businessId, role));
  } catch (err) {
    sendBusinessError(res, err, next);
  }
});

/**
 * POST /api/business/calendar/meetings/:id  { action: 'cancel' | 'done' | 'no_show' }
 * The owner and the assistant
 */
router.post('/calendar/meetings/:id', async (req, res, next) => {
  try {
    const { businessId, role } = await calendarBusiness(req, res);
    if (!businessId) return;
    const meeting = await calendarService.meetingOfBusiness(businessId, req.params.id);
    if (!meeting) return res.status(404).json({ error: 'not_found', message: 'Встреча не найдена' });
    const action = String(req.body?.action || '');
    if (action === 'cancel') {
      const client = await db.get('SELECT * FROM clients WHERE id = ?', [meeting.clientId]);
      const project = await db.get('SELECT * FROM projects WHERE id = ?', [meeting.projectId]);
      if (!client || !project) return res.status(404).json({ error: 'not_found', message: 'Клиент не найден' });
      await calendarService.cancel(chatService, project, client, meeting, { type: role, userId: req.user.userId });
    } else if (action === 'done' || action === 'no_show') {
      if (new Date(meeting.startsAt) > new Date()) {
        return res.status(400).json({ error: 'bad_request', message: 'Итог можно отметить, когда встреча началась' });
      }
      await calendarService.markOutcome(meeting, action);
    } else {
      return res.status(400).json({ error: 'bad_request', message: 'Неизвестное действие' });
    }
    res.json(await calendarOverview(businessId, role));
  } catch (err) {
    sendBusinessError(res, err, next);
  }
});

module.exports = router;
