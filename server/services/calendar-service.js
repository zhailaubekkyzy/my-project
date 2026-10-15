// server/services/calendar-service.js - The calendar of a business: free windows and meetings.
//
// Owner's decisions (12–13 Oct.):
//  - the expert sets free windows for himself and for the assistant (days of the week + hours);
//  - the client books right in the chat with the SI-seller; a permanent Zoom link per person;
//  - no double booking (unique index + overlap check);
//  - whether the client may cancel / reschedule and how many hours before — the expert decides;
//    the owner and the assistant may always cancel;
//  - a reminder an hour before the meeting to both sides (Buddy first, then Telegram).
// Windows are in the business's time (calendar_settings.tz_offset_minutes); meetings are kept in UTC;
// every person sees times in their own time zone.
const crypto = require('crypto');
const db = require('../db');
const telegramBot = require('./telegram-bot');
const { langOfClient } = require('./i18n');
const businessService = require('./business-service');
const profileService = require('./profile-service');

const DAYS_AHEAD = 14;
const LEAD_MINUTES = 60;            // the nearest slot is at least an hour from now
const REMIND_MINUTES = 60;
const DURATIONS = [15, 30, 45, 60, 90];

class CalendarError extends Error {
  constructor(message, status = 400, code = 'CALENDAR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const sqlTime = (date) => date.toISOString().slice(0, 19).replace('T', ' ');
const toDate = (value) => (value instanceof Date ? value : new Date(String(value).replace(' ', 'T') + (/[Z+]/.test(String(value)) ? '' : 'Z')));
const newId = () => `mtg_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

function cleanOffset(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= -720 && n <= 840 ? n : null;
}

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS = ['янв.', 'фев.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сен.', 'окт.', 'ноя.', 'дек.'];
const pad = (n) => String(n).padStart(2, '0');

// "вт, 14 окт., 10:00" in the given time zone
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function whenLabel(date, offset, lang = 'ru') {
  const d = new Date(toDate(date).getTime() + (offset || 0) * 60000);
  if (lang === 'en') return `${WEEKDAYS_EN[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS_EN[d.getUTCMonth()]}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

const minutesOf = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const v = +m[1] * 60 + +m[2];
  return +m[1] <= 24 && +m[2] < 60 && v <= 1440 ? v : null;
};

function normalizeWindows(list) {
  if (!Array.isArray(list)) return [];
  const result = [];
  for (const w of list.slice(0, 21)) {
    const day = parseInt(w && w.day, 10);
    const from = minutesOf(w && w.from);
    const to = minutesOf(w && w.to);
    if (!(day >= 0 && day <= 6) || from === null || to === null || to <= from) continue;
    result.push({ day, from: `${pad(Math.floor(from / 60))}:${pad(from % 60)}`, to: `${pad(Math.floor(to / 60))}:${pad(to % 60)}` });
  }
  return result;
}

// ---------- Settings and the people who take meetings ----------
async function settingsOf(businessId) {
  const row = await db.get('SELECT * FROM calendar_settings WHERE business_id = ?', [businessId]);
  if (row) {
    return {
      tzOffset: Number(row.tz_offset_minutes),
      durationMinutes: Number(row.duration_minutes),
      clientCanCancel: Boolean(Number(row.client_can_cancel)),
      clientCanReschedule: Boolean(Number(row.client_can_reschedule)),
      hoursBefore: Number(row.change_hours_before)
    };
  }
  // Not set yet: the owner's time zone from the phone (Almaty by default)
  const owner = await db.get('SELECT u.tz_offset_minutes FROM businesses b JOIN users u ON u.id = b.owner_id WHERE b.id = ?', [businessId]);
  return { tzOffset: cleanOffset(owner && owner.tz_offset_minutes) ?? 300, durationMinutes: 30, clientCanCancel: true, clientCanReschedule: true, hoursBefore: 3 };
}

async function saveSettings(businessId, input = {}) {
  const current = await settingsOf(businessId);
  const next = {
    tzOffset: cleanOffset(input.tzOffset) ?? current.tzOffset,
    durationMinutes: DURATIONS.includes(parseInt(input.durationMinutes, 10)) ? parseInt(input.durationMinutes, 10) : current.durationMinutes,
    clientCanCancel: input.clientCanCancel === undefined ? current.clientCanCancel : Boolean(input.clientCanCancel),
    clientCanReschedule: input.clientCanReschedule === undefined ? current.clientCanReschedule : Boolean(input.clientCanReschedule),
    hoursBefore: input.hoursBefore === undefined ? current.hoursBefore : Math.max(0, Math.min(168, parseInt(input.hoursBefore, 10) || 0))
  };
  const exists = await db.get('SELECT business_id FROM calendar_settings WHERE business_id = ?', [businessId]);
  const values = [next.tzOffset, next.durationMinutes, next.clientCanCancel ? 1 : 0, next.clientCanReschedule ? 1 : 0, next.hoursBefore, businessId];
  if (exists) {
    await db.run(
      `UPDATE calendar_settings SET tz_offset_minutes = ?, duration_minutes = ?, client_can_cancel = ?, client_can_reschedule = ?, change_hours_before = ?, updated_at = CURRENT_TIMESTAMP WHERE business_id = ?`,
      values
    );
  } else {
    await db.run(
      `INSERT INTO calendar_settings (tz_offset_minutes, duration_minutes, client_can_cancel, client_can_reschedule, change_hours_before, business_id) VALUES (?, ?, ?, ?, ?, ?)`,
      values
    );
  }
  return next;
}

const displayNameOf = (row) => profileService.toPublicUser(row).displayName || 'Без имени';

// The owner and the assistant with their windows (also members without windows yet)
async function hostsOf(businessId) {
  const members = await businessService.listMembers(businessId);
  const rows = await db.all('SELECT * FROM calendar_hosts WHERE business_id = ?', [businessId]);
  return members.map(m => {
    const row = rows.find(r => r.user_id === m.userId);
    let windows = [];
    try { windows = normalizeWindows(JSON.parse((row && row.windows) || '[]')); } catch (e) {}
    return {
      userId: m.userId,
      role: m.role,
      name: m.name,
      active: row ? Boolean(Number(row.active)) : false,
      zoomUrl: (row && row.zoom_url) || '',
      windows
    };
  });
}

async function saveHost(businessId, userId, input = {}) {
  const role = await businessService.roleIn(businessId, userId);
  if (!role) throw new CalendarError('Этот человек не в вашем бизнесе.', 404, 'NOT_MEMBER');
  const zoom = String(input.zoomUrl || '').trim();
  if (zoom && !/^https:\/\/[^\s<>"']+$/i.test(zoom)) throw new CalendarError('Ссылка на Zoom должна начинаться с https://', 400, 'BAD_ZOOM');
  const windows = normalizeWindows(input.windows);
  const active = input.active === undefined ? true : Boolean(input.active);
  const exists = await db.get('SELECT user_id FROM calendar_hosts WHERE business_id = ? AND user_id = ?', [businessId, userId]);
  const values = [active ? 1 : 0, zoom || null, JSON.stringify(windows), businessId, userId];
  if (exists) {
    await db.run('UPDATE calendar_hosts SET active = ?, zoom_url = ?, windows = ?, updated_at = CURRENT_TIMESTAMP WHERE business_id = ? AND user_id = ?', values);
  } else {
    await db.run('INSERT INTO calendar_hosts (active, zoom_url, windows, business_id, user_id) VALUES (?, ?, ?, ?, ?)', values);
  }
  return (await hostsOf(businessId)).find(h => h.userId === userId);
}

async function isEnabled(businessId) {
  if (!businessId) return false;
  return (await hostsOf(businessId)).some(h => h.active && h.windows.length);
}

// ---------- Free slots ----------
/**
 * Free times for the next 14 days: [{ at: ISO, hosts: [userId] }], oldest first.
 * excludeMeetingId: a meeting being moved does not block its own time.
 */
async function freeSlots(businessId, now = new Date(), { excludeMeetingId = null } = {}) {
  const settings = await settingsOf(businessId);
  const hosts = (await hostsOf(businessId)).filter(h => h.active && h.windows.length);
  if (!hosts.length) return [];
  const until = new Date(now.getTime() + (DAYS_AHEAD + 1) * 86400000);
  const booked = (await db.all(
    `SELECT id, host_user_id, starts_at, ends_at FROM meetings WHERE business_id = ? AND status = 'booked' AND ends_at > ? AND starts_at < ?`,
    [businessId, sqlTime(now), sqlTime(until)]
  )).filter(m => m.id !== excludeMeetingId).map(m => ({ host: m.host_user_id, start: toDate(m.starts_at).getTime(), end: toDate(m.ends_at).getTime() }));
  // Also people's meetings in other businesses (a person is in one place at a time)
  const others = await db.all(
    `SELECT host_user_id, starts_at, ends_at FROM meetings WHERE business_id <> ? AND status = 'booked' AND ends_at > ? AND starts_at < ?`,
    [businessId, sqlTime(now), sqlTime(until)]
  );
  for (const m of others) booked.push({ host: m.host_user_id, start: toDate(m.starts_at).getTime(), end: toDate(m.ends_at).getTime() });

  const off = settings.tzOffset;
  const dur = settings.durationMinutes * 60000;
  const earliest = now.getTime() + LEAD_MINUTES * 60000;
  const localToday = new Date(now.getTime() + off * 60000);
  localToday.setUTCHours(0, 0, 0, 0);
  const slots = new Map();
  for (let d = 0; d < DAYS_AHEAD; d++) {
    const dayStart = localToday.getTime() + d * 86400000; // local midnight, as a UTC number
    const weekday = new Date(dayStart).getUTCDay();
    for (const host of hosts) {
      for (const w of host.windows.filter(x => x.day === weekday)) {
        const from = minutesOf(w.from) * 60000;
        const to = minutesOf(w.to) * 60000;
        for (let t = from; t + dur <= to; t += dur) {
          const start = dayStart + t - off * 60000;
          if (start < earliest) continue;
          const end = start + dur;
          if (booked.some(b => b.host === host.userId && b.start < end && b.end > start)) continue;
          if (!slots.has(start)) slots.set(start, []);
          if (!slots.get(start).includes(host.userId)) slots.get(start).push(host.userId);
        }
      }
    }
  }
  return [...slots.entries()].sort((a, b) => a[0] - b[0]).map(([start, ids]) => ({ at: new Date(start).toISOString(), hosts: ids }));
}

// ---------- Meetings ----------
const toMeeting = (r) => ({
  id: r.id,
  projectId: r.project_id,
  clientId: r.client_id,
  hostUserId: r.host_user_id,
  startsAt: toDate(r.starts_at).toISOString(),
  endsAt: toDate(r.ends_at).toISOString(),
  status: r.status,
  zoomUrl: r.zoom_url || null
});

async function upcomingOfClient(clientId, now = new Date()) {
  const row = await db.get(
    `SELECT * FROM meetings WHERE client_id = ? AND status = 'booked' AND ends_at > ? ORDER BY starts_at ASC LIMIT 1`,
    [clientId, sqlTime(now)]
  );
  return row ? toMeeting(row) : null;
}

// May the client cancel / move this meeting now (the expert's rules)?
function clientMay(kind, meeting, settings, now = new Date()) {
  const allowed = kind === 'cancel' ? settings.clientCanCancel : settings.clientCanReschedule;
  if (!allowed) return false;
  return toDate(meeting.startsAt).getTime() - now.getTime() >= settings.hoursBefore * 3600000;
}

async function clientTzOf(client, fallback) {
  if (!String(client.external_client_id || '').startsWith('usr_')) return fallback;
  const user = await db.get('SELECT tz_offset_minutes FROM users WHERE id = ?', [client.external_client_id]);
  return cleanOffset(user && user.tz_offset_minutes) ?? fallback;
}

async function peopleToTell(client, hostUserId) {
  const owner = await db.get('SELECT owner_id FROM businesses WHERE id = ?', [client.business_id]);
  return [...new Set([hostUserId, owner && owner.owner_id].filter(Boolean))];
}

/**
 * The client books a free time. replaceMeeting: the meeting being moved (reschedule).
 * chatService is passed in (chat-service requires this module for the SI prompt).
 */
async function book(chatService, project, client, atIso, { tzOffset = null, replaceMeeting = null } = {}, now = new Date()) {
  if (!client.business_id) throw new CalendarError('Запись пока не открыта.', 400, 'NO_CALENDAR');
  const at = new Date(atIso);
  if (isNaN(at)) throw new CalendarError('Выберите время из списка.', 400, 'BAD_TIME');
  const offset = cleanOffset(tzOffset);
  if (offset !== null && String(client.external_client_id || '').startsWith('usr_')) {
    await db.run('UPDATE users SET tz_offset_minutes = ? WHERE id = ?', [offset, client.external_client_id]);
  }
  const existing = await upcomingOfClient(client.id, now);
  if (existing && (!replaceMeeting || existing.id !== replaceMeeting.id)) {
    throw new CalendarError('У вас уже есть встреча — её можно перенести.', 409, 'ALREADY_BOOKED');
  }
  const slot = (await freeSlots(client.business_id, now, { excludeMeetingId: replaceMeeting && replaceMeeting.id }))
    .find(s => s.at === at.toISOString());
  if (!slot) throw new CalendarError('Это время уже занято — выберите, пожалуйста, другое.', 409, 'TAKEN');

  const settings = await settingsOf(client.business_id);
  const hosts = await hostsOf(client.business_id);
  const host = hosts.find(h => h.userId === slot.hosts[0]);
  const id = newId();
  const end = new Date(at.getTime() + settings.durationMinutes * 60000);
  if (replaceMeeting) {
    await db.run(`UPDATE meetings SET status = 'rescheduled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'booked'`, [replaceMeeting.id]);
  }
  try {
    await db.run(
      `INSERT INTO meetings (id, business_id, project_id, client_id, host_user_id, starts_at, ends_at, status, zoom_url, booked_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'booked', ?, 'client')`,
      [id, client.business_id, project.id, client.id, host.userId, sqlTime(at), sqlTime(end), host.zoomUrl || null]
    );
  } catch (err) {
    // Two clients pressed the same time at once: the unique index lets only one through
    if (replaceMeeting) await db.run(`UPDATE meetings SET status = 'booked' WHERE id = ? AND status = 'rescheduled'`, [replaceMeeting.id]);
    throw new CalendarError('Это время только что заняли — выберите, пожалуйста, другое.', 409, 'TAKEN');
  }

  const clientTz = await clientTzOf(client, settings.tzOffset);
  const lang = await langOfClient(client);
  const when = whenLabel(at, clientTz, lang);
  let text = replaceMeeting
    ? `Готово, встреча перенесена на ${when}.${host.zoomUrl ? ` Ссылка: ${host.zoomUrl}` : ''}`
    : `Готово! Вы записаны на ${when} (${settings.durationMinutes} мин).${host.zoomUrl ? ` Ссылка на встречу: ${host.zoomUrl}` : ' Ссылку на встречу пришлём здесь.'} За час до начала напомню.`;
  if (lang === 'en') {
    text = replaceMeeting
      ? `Done, the meeting is moved to ${when}.${host.zoomUrl ? ` Link: ${host.zoomUrl}` : ''}`
      : `Done! You are booked for ${when} (${settings.durationMinutes} min).${host.zoomUrl ? ` Meeting link: ${host.zoomUrl}` : ' We will send the meeting link here.'} I will remind you an hour before.`;
  }
  await chatService.saveMessage(client, { type: 'si' }, text);
  if (!replaceMeeting) await chatService.clientEvent(project, client, 'booked', { type: 'client' });
  else await chatService.clientEvent(project, client, 'meeting_moved', { type: 'client' });

  for (const userId of await peopleToTell(client, host.userId)) {
    const tz = cleanOffset((await db.get('SELECT tz_offset_minutes FROM users WHERE id = ?', [userId]) || {}).tz_offset_minutes) ?? settings.tzOffset;
    await telegramBot.notifyUser(
      userId,
      `📅 ${replaceMeeting ? 'Встреча перенесена' : 'Новая запись'}: ${client.name || 'Клиент'} — ${whenLabel(at, tz)}${userId !== host.userId ? ` (ведёт ${host.name})` : ''}.\nSI-продавец: «${project.name}».`,
      { buttonText: 'Открыть календарь', startParam: 'CAL' }
    );
  }
  return toMeeting(await db.get('SELECT * FROM meetings WHERE id = ?', [id]));
}

/**
 * Cancels a meeting. by: { type: 'client' | 'owner' | 'assistant', userId }.
 */
async function cancel(chatService, project, client, meeting, by, now = new Date()) {
  if (meeting.status !== 'booked') throw new CalendarError('Эта встреча уже не запланирована.', 409, 'NOT_BOOKED');
  const settings = await settingsOf(client.business_id);
  if (by.type === 'client' && !clientMay('cancel', meeting, settings, now)) {
    throw new CalendarError(settings.clientCanCancel
      ? `Отменить можно не позже чем за ${settings.hoursBefore} ч до встречи — напишите, пожалуйста, в чат.`
      : 'Отменить встречу можно только через эксперта — напишите, пожалуйста, в чат.', 403, 'NOT_ALLOWED');
  }
  await db.run(
    `UPDATE meetings SET status = 'cancelled', cancelled_by = ?, cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'booked'`,
    [by.type, meeting.id]
  );
  const clientTz = await clientTzOf(client, settings.tzOffset);
  const clientLang = await langOfClient(client);
  await chatService.saveMessage(client, { type: 'si' }, clientLang === 'en'
    ? `The meeting on ${whenLabel(meeting.startsAt, clientTz, 'en')} is cancelled.${by.type === 'client' ? ' You can book again any time.' : ' You can choose another time — the «Book a call» button in this chat.'}`
    : `Встреча ${whenLabel(meeting.startsAt, clientTz)} отменена.${by.type === 'client' ? ' Если захотите — можно записаться снова.' : ' Можно выбрать другое время — кнопка «Записаться» в этом чате.'}`);
  await chatService.clientEvent(project, client, 'meeting_cancelled', { type: by.type, userId: by.userId });
  const tell = by.type === 'client' ? await peopleToTell(client, meeting.hostUserId) : (String(client.external_client_id).startsWith('usr_') ? [client.external_client_id] : []);
  for (const userId of tell) {
    await telegramBot.notifyUser(
      userId,
      by.type === 'client'
        ? `📅 ${client.name || 'Клиент'} отменил(а) встречу ${whenLabel(meeting.startsAt, settings.tzOffset)}.`
        : { ru: `📅 Встреча ${whenLabel(meeting.startsAt, clientTz)} с «${project.name}» отменена.`, en: `📅 The meeting on ${whenLabel(meeting.startsAt, clientTz, 'en')} with «${project.name}» is cancelled.` },
      { buttonText: by.type === 'client' ? 'Открыть' : { ru: 'Открыть', en: 'Open' }, startParam: by.type === 'client' ? 'CAL' : project.slug }
    );
  }
}

async function meetingOfBusiness(businessId, meetingId) {
  const row = await db.get('SELECT * FROM meetings WHERE id = ? AND business_id = ?', [meetingId, businessId]);
  return row ? toMeeting(row) : null;
}

// The owner or the assistant marks the outcome: the meeting happened / the client did not come
async function markOutcome(meeting, outcome) {
  if (!['done', 'no_show'].includes(outcome)) throw new CalendarError('Неизвестный итог', 400, 'BAD_OUTCOME');
  const changed = await db.run(
    `UPDATE meetings SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('booked', 'done', 'no_show')`,
    [outcome, meeting.id]
  );
  if (!Number(changed.changes)) throw new CalendarError('Эта встреча отменена.', 409, 'NOT_BOOKED');
}

/**
 * Meetings of a business for the Office: from 7 days ago, newest last.
 */
async function meetingsOfBusiness(businessId, now = new Date()) {
  const rows = await db.all(
    `SELECT m.*, c.name AS client_name, c.username AS client_username, p.name AS project_name, u.display_name, u.profile
     FROM meetings m
     JOIN clients c ON c.id = m.client_id
     LEFT JOIN projects p ON p.id = m.project_id
     JOIN users u ON u.id = m.host_user_id
     WHERE m.business_id = ? AND m.starts_at >= ? AND m.status <> 'rescheduled'
     ORDER BY m.starts_at ASC LIMIT 200`,
    [businessId, sqlTime(new Date(now.getTime() - 7 * 86400000))]
  );
  return rows.map(r => ({
    ...toMeeting(r),
    clientName: r.client_name,
    clientUsername: r.client_username,
    projectName: r.project_name,
    hostName: displayNameOf(r)
  }));
}

/**
 * The alarm clock: an hour before a meeting both sides get a reminder (Buddy, then Telegram).
 */
async function runMeetingReminders(now = new Date()) {
  const due = await db.all(
    `SELECT m.*, c.external_client_id, c.name AS client_name, p.name AS project_name, p.slug
     FROM meetings m JOIN clients c ON c.id = m.client_id LEFT JOIN projects p ON p.id = m.project_id
     WHERE m.status = 'booked' AND m.reminded_at IS NULL AND m.starts_at > ? AND m.starts_at <= ?
     LIMIT 100`,
    [sqlTime(now), sqlTime(new Date(now.getTime() + REMIND_MINUTES * 60000))]
  );
  let sent = 0;
  for (const m of due) {
    const taken = await db.run('UPDATE meetings SET reminded_at = CURRENT_TIMESTAMP WHERE id = ? AND reminded_at IS NULL', [m.id]);
    if (Number(taken.changes) !== 1) continue;
    const settings = await settingsOf(m.business_id);
    const link = m.zoom_url ? `\nСсылка: ${m.zoom_url}` : '';
    if (String(m.external_client_id || '').startsWith('usr_')) {
      const tz = cleanOffset((await db.get('SELECT tz_offset_minutes FROM users WHERE id = ?', [m.external_client_id]) || {}).tz_offset_minutes) ?? settings.tzOffset;
      await telegramBot.notifyUser(m.external_client_id, {
        ru: `⏰ Через час встреча с «${m.project_name || 'экспертом'}»: ${whenLabel(m.starts_at, tz)}.${link}`,
        en: `⏰ In an hour: a meeting with «${m.project_name || 'the expert'}», ${whenLabel(m.starts_at, tz, 'en')}.${link.replace('Ссылка:', 'Link:')}`
      }, { buttonText: { ru: 'Открыть чат', en: 'Open chat' }, startParam: m.slug });
    }
    await telegramBot.notifyUser(m.host_user_id, `⏰ Через час встреча: ${m.client_name || 'клиент'} — ${whenLabel(m.starts_at, settings.tzOffset)}.${link}`, { buttonText: 'Открыть календарь', startParam: 'CAL' });
    sent++;
  }
  return { sent };
}

module.exports = {
  CalendarError,
  DURATIONS,
  DAYS_AHEAD,
  whenLabel,
  normalizeWindows,
  settingsOf,
  saveSettings,
  hostsOf,
  saveHost,
  isEnabled,
  freeSlots,
  upcomingOfClient,
  clientMay,
  book,
  cancel,
  meetingOfBusiness,
  markOutcome,
  meetingsOfBusiness,
  runMeetingReminders
};
