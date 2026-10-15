// server/services/buddy-service.js - Buddy: a personal helper for every day, as a conversation.
//
// Owner's decisions: the Buddy screen is a chat with Buddy; every notification is Buddy's message
// (telegram-bot.notifyUser saves it here first, then repeats it in Telegram); the person can talk to
// Buddy about plans and ask for reminders ("напомни завтра в 9 позвонить маме"); later — the calendar.
// Up to 30 messages a day per person (OpenAI costs); reminders and notifications are not limited.
//
// Messages live in `notifications` (sender 'buddy' | 'user'); reminders wait in buddy_reminders and
// the alarm clock (scheduler-service.js) sends them in time as Buddy's messages.
// The calendar "for the whole life" (owner's decision 15 Oct.): plans the person tells Buddy are rows in
// buddy_reminders too (kind 'plan', starts_at = when it happens); a plan is reminded only if the person
// asked (notify). Meetings with experts (meetings, 012) are shown next to them. Voice messages to Buddy
// are transcribed and answered like text (the recording itself is not kept).
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const siEngine = require('./si-engine');
const telegramBot = require('./telegram-bot');
const profileService = require('./profile-service');
const analytics = require('./analytics-service');
const { langOf } = require('./i18n');

const DAILY_LIMIT = 30;
const MAX_TEXT = 1000;
const HISTORY = 16;
const MAX_ACTIVE_REMINDERS = 200;
const PROMPT_PLANS = 40;
const MAX_RANGE_DAYS = 62;
// Where Buddy's button may lead (SF.openStartParam on the phone)
const PLACES = {
  marketplace: 'GO_marketplace',
  office: 'GO_office',
  chats: 'GO_chats',
  profile: 'GO_profile',
  support: 'S_support'
};
const LIMIT_TEXT = 'На сегодня я ответил на все 30 сообщений — давайте продолжим завтра 🙂 Напоминания и уведомления будут приходить как обычно.';
const NO_AI_TEXT = 'Я пока не могу отвечать на сообщения — подключение ещё настраивается. Уведомления и напоминания будут приходить сюда как обычно.';
const EN_TEXTS = {
  [LIMIT_TEXT]: 'I have answered all 30 messages for today — let\u2019s continue tomorrow 🙂 Reminders and notifications will come as usual.',
  [NO_AI_TEXT]: 'I cannot answer messages yet — the connection is still being set up. Notifications and reminders will come here as usual.',
  'Извините, я не расслышал — напишите, пожалуйста, ещё раз 🙂': 'Sorry, I did not catch that — please write again 🙂'
};
const inLang = (text, lang) => (lang === 'en' && EN_TEXTS[text] ? EN_TEXTS[text] : text);

const newId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
const sqlTime = (date) => date.toISOString().slice(0, 19).replace('T', ' ');
const toDate = (value) => (value instanceof Date ? value : new Date(String(value).replace(' ', 'T') + (/[Z+]/.test(String(value)) ? '' : 'Z')));

function cleanOffset(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= -720 && n <= 840 ? n : null;
}

// The person's local time as a Date whose UTC fields show the local clock
const localClock = (date, offset) => new Date(date.getTime() + offset * 60000);

function localMidnightUtc(now, offset) {
  const local = localClock(now, offset);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - offset * 60000);
}

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const pad = (n) => String(n).padStart(2, '0');

function localLabel(date, offset) {
  const d = localClock(date, offset);
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// "2026-10-14 09:00" in the person's time → UTC Date (or null)
function parseLocal(value, offset) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - offset * 60000;
  return Number.isFinite(utc) ? new Date(utc) : null;
}

const toMessage = (r) => ({
  id: r.id,
  sender: r.sender || 'buddy',
  kind: r.kind || 'notice',
  text: r.text,
  startParam: r.start_param || null,
  read: Boolean(r.read_at),
  createdAt: r.created_at
});

async function saveMessage(userId, sender, text, { kind = 'chat', startParam = null, read = true } = {}) {
  const id = newId('ntf');
  await db.run(
    `INSERT INTO notifications (id, user_id, text, start_param, sender, kind, read_at)
     VALUES (?, ?, ?, ?, ?, ?, ${read ? 'CURRENT_TIMESTAMP' : 'NULL'})`,
    [id, userId, String(text).slice(0, MAX_TEXT), startParam, sender, kind]
  );
  return toMessage(await db.get('SELECT * FROM notifications WHERE id = ?', [id]));
}

/**
 * The conversation with Buddy, oldest first (the last `limit` messages).
 */
async function messages(userId, limit = 60) {
  const rows = await db.all(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    [userId, Math.min(200, Math.max(1, limit))]
  );
  return rows.reverse().map(toMessage);
}

async function markAllRead(userId) {
  await db.run(`UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL`, [userId]);
}

async function usage(userId, offset, now = new Date()) {
  const row = await db.get(
    `SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND sender = 'user' AND created_at >= ?`,
    [userId, sqlTime(localMidnightUtc(now, offset || 0))]
  );
  return { used: Number(row.count) || 0, max: DAILY_LIMIT };
}

// Upcoming plans and reminders (not cancelled), for Buddy's prompt and the limit
async function upcomingPlans(userId, now = new Date(), limit = MAX_ACTIVE_REMINDERS) {
  return db.all(
    `SELECT id, kind, text, remind_at, starts_at, notify, sent_at FROM buddy_reminders
     WHERE user_id = ? AND cancelled_at IS NULL AND COALESCE(starts_at, remind_at) >= ?
     ORDER BY COALESCE(starts_at, remind_at) ASC LIMIT ?`,
    [userId, sqlTime(new Date(now.getTime() - 60 * 60000)), limit]
  );
}

// Meetings with experts: as a client (the person's own client rows) or as the host (expert / assistant)
async function meetingsOf(userId, from, to) {
  const rows = await db.all(
    `SELECT m.id, m.starts_at, m.ends_at, m.status, m.zoom_url, m.host_user_id, p.name AS project_name, p.slug,
            c.name AS client_name, c.external_client_id
     FROM meetings m
     JOIN clients c ON c.id = m.client_id
     LEFT JOIN projects p ON p.id = m.project_id
     WHERE m.status IN ('booked', 'done') AND m.starts_at >= ? AND m.starts_at < ?
       AND (c.external_client_id = ? OR m.host_user_id = ?)
     ORDER BY m.starts_at ASC LIMIT 200`,
    [sqlTime(from), sqlTime(to), userId, userId]
  );
  return rows.map(r => {
    const asClient = r.external_client_id === userId;
    return {
      id: r.id,
      kind: 'meeting',
      title: asClient ? `Встреча: «${r.project_name || 'эксперт'}»` : `Встреча с ${r.client_name || 'клиентом'}`,
      startsAt: toDate(r.starts_at).toISOString(),
      endsAt: toDate(r.ends_at).toISOString(),
      startParam: asClient ? (r.slug || null) : 'CAL'
    };
  });
}

/**
 * Buddy's calendar for [from, to): the person's plans and reminders and their meetings with experts.
 */
async function calendar(userId, from, to) {
  if (!(from instanceof Date) || !(to instanceof Date) || isNaN(from) || isNaN(to) || to <= from) return [];
  if (to - from > MAX_RANGE_DAYS * 86400000) to = new Date(from.getTime() + MAX_RANGE_DAYS * 86400000);
  const plans = await db.all(
    `SELECT id, kind, text, remind_at, starts_at, notify FROM buddy_reminders
     WHERE user_id = ? AND cancelled_at IS NULL AND COALESCE(starts_at, remind_at) >= ? AND COALESCE(starts_at, remind_at) < ?
     ORDER BY COALESCE(starts_at, remind_at) ASC LIMIT 500`,
    [userId, sqlTime(from), sqlTime(to)]
  );
  const items = plans.map(r => ({
    id: r.id,
    kind: r.kind === 'plan' ? 'plan' : 'reminder',
    title: r.text,
    startsAt: toDate(r.starts_at || r.remind_at).toISOString(),
    remindAt: Number(r.notify) ? toDate(r.remind_at).toISOString() : null
  }));
  return items.concat(await meetingsOf(userId, from, to)).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/**
 * The person removes a plan or a reminder from the calendar (only their own).
 */
async function cancelPlan(userId, id) {
  const res = await db.run(
    'UPDATE buddy_reminders SET cancelled_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND cancelled_at IS NULL',
    [String(id || ''), userId]
  );
  return Number(res.changes) === 1;
}

async function activeReminders(userId) {
  return db.all(
    `SELECT id, text, remind_at FROM buddy_reminders WHERE user_id = ? AND sent_at IS NULL AND cancelled_at IS NULL ORDER BY remind_at ASC LIMIT ?`,
    [userId, MAX_ACTIVE_REMINDERS]
  );
}

function planLine(r, offset) {
  const at = toDate(r.starts_at || r.remind_at);
  const remind = Number(r.notify) && r.kind === 'plan' && r.remind_at && toDate(r.remind_at).getTime() !== at.getTime()
    ? ` (напомню: ${localLabel(toDate(r.remind_at), offset)})` : '';
  const what = r.kind === 'plan' ? r.text : `напоминание: ${r.text}`;
  return `${localLabel(at, offset)} — ${what}${remind}`;
}

function systemPrompt(user, offset, now, reminders, meetings = [], lang = 'ru') {
  const name = (profileService.toPublicUser(user).displayName || '').split(' ')[0];
  return [
    'Ты — Бадди, личный помощник человека в приложении SmartFlow на каждый день.',
    'Помогаешь спланировать день, разобрать дела и цели, ведёшь его календарь (планы, дела, встречи), не забыть важное',
    '(напоминания), подсказываешь по приложению. Календарь человек видит над перепиской: сегодня, завтра, послезавтра и месяц.',
    '',
    'Как общаться:',
    '- Тепло, по-дружески, коротко: 1–3 предложения, как в мессенджере. На «ты» не переходи, если человек сам не начал.',
    '- Ничего не продаёшь и не советуешь покупать. Не давишь, не морализируешь.',
    '- Ты SI (Super Intelligence) — на прямой вопрос честно скажи, что ты SI-помощник, а не человек.',
    '- Медицинские, юридические и финансовые решения не принимаешь за человека — мягко советуешь специалиста.',
    '- Не выдумывай факты о человеке и его делах: знаешь только то, что он написал, и его календарь ниже.',
    '- Никогда не предлагай написать или познакомиться с конкретным человеком и не называй людей. Можно посоветовать',
    '  поискать SI-продавца в Маркетплейсе (позже — группу в Инкубаторе), но не человека.',
    '',
    'Приложение SmartFlow: Маркетплейс (SI-продавцы экспертов), Офис (для экспертов: свои SI-продавцы, клиенты, воронка),',
    'Чаты (переписки с SI-продавцами, с людьми и с поддержкой; поиск чатов и людей), Профиль. Инкубатор — скоро.',
    '',
    `Сейчас у человека: ${localLabel(now, offset)}.`,
    lang === 'en'
      ? 'Язык приложения у человека — английский: отвечай по-английски (если он сам пишет на другом языке — на его языке). Поле text в plans — тоже на его языке.'
      : 'Отвечай на языке человека (обычно русский).',
    name ? `Имя: ${name}.` : '',
    'Его календарь — планы и напоминания (номер. когда — что):',
    ...(reminders.length
      ? reminders.map((r, i) => `${i + 1}. ${planLine(r, offset)}`)
      : ['(пусто)']),
    'Встречи с экспертами (их меняют в чате с SI-продавцом или в Офисе, не здесь):',
    ...(meetings.length ? meetings.map(m => `- ${localLabel(new Date(m.startsAt), offset)} — ${m.title}`) : ['(нет)']),
    '',
    'Ответь только JSON:',
    '{"reply": "текст ответа", "plans": [{"text": "что", "at": "ГГГГ-ММ-ДД ЧЧ:ММ", "remind_before": число минут или null}], "cancel": [номера], "open": "marketplace|office|chats|profile|support|none"}',
    '- plans: дела, встречи, планы и напоминания, о которых человек ясно говорит («завтра в 13:00 созвон с коучем», «напомни в 9 позвонить маме»).',
    '  text — коротко, как запись в календаре («Созвон с коучем по нутрициологии»). at — когда это будет, по его часам.',
    '  remind_before: если просит напомнить — за сколько минут (0 = в это время, «за час» = 60); если не просил — null.',
    '  Если время неясно — спроси в reply и оставь []. Чтобы перенести — отмени старое (cancel) и добавь новое.',
    '- cancel: номера из календаря, которые человек просит отменить или перенести.',
    '- На вопросы «что у меня сегодня / завтра / на неделе» отвечай по календарю и встречам выше.',
    '- open: раздел, куда уместно дать кнопку (например, человек спрашивает, где найти экспертов → marketplace), иначе "none".',
    '- В reply подтверди, что добавил в календарь, с днём и временем; если напоминание не просили — можно мягко предложить.'
  ].filter(line => line !== '').join('\n');
}

/**
 * The person writes to Buddy. Returns { messages: [new ones], usage }.
 */
async function send(user, rawText, tzOffset, now = new Date(), { voice = false } = {}) {
  const text = String(rawText || '').trim().slice(0, MAX_TEXT);
  if (!text) return { messages: [], usage: await usage(user.id, user.tz_offset_minutes) };
  const offset = cleanOffset(tzOffset) ?? cleanOffset(user.tz_offset_minutes) ?? 0;
  if (offset !== user.tz_offset_minutes) {
    await db.run('UPDATE users SET tz_offset_minutes = ? WHERE id = ?', [offset, user.id]);
  }

  const lang = langOf(user);
  const before = await usage(user.id, offset, now);
  const mine = await saveMessage(user.id, 'user', text, { kind: voice ? 'voice' : 'chat' });
  analytics.capture('buddy_message', user.id, { voice, limit_reached: before.used >= DAILY_LIMIT });
  const created = [mine];

  if (before.used >= DAILY_LIMIT) {
    // Say it once a day; then stay quiet (no OpenAI)
    const told = await db.get(
      `SELECT id FROM notifications WHERE user_id = ? AND sender = 'buddy' AND text = ? AND created_at >= ? LIMIT 1`,
      [user.id, inLang(LIMIT_TEXT, lang), sqlTime(localMidnightUtc(now, offset))]
    );
    if (!told) created.push(await saveMessage(user.id, 'buddy', inLang(LIMIT_TEXT, lang)));
    return { messages: created, usage: { used: before.used + 1, max: DAILY_LIMIT }, limitReached: true };
  }

  if (!siEngine.isConfigured()) {
    created.push(await saveMessage(user.id, 'buddy', inLang(NO_AI_TEXT, lang)));
    return { messages: created, usage: { used: before.used + 1, max: DAILY_LIMIT } };
  }

  const reminders = await upcomingPlans(user.id, now, PROMPT_PLANS);
  const meetings = await meetingsOf(user.id, new Date(now.getTime() - 3600000), new Date(now.getTime() + 31 * 86400000));
  const history = (await messages(user.id, HISTORY + 1)).slice(0, -1); // without the message just saved
  const chat = [{ role: 'system', content: systemPrompt(user, offset, now, reminders, meetings.slice(0, 20), lang) }];
  for (const m of history) {
    chat.push({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.text });
  }
  chat.push({ role: 'user', content: text });

  const answer = await siEngine.callOpenAI(chat, { model: config.buddyModel, response_format: { type: 'json_object' } });
  let parsed = null;
  try { parsed = answer ? JSON.parse(answer) : null; } catch (e) { parsed = null; }
  const reply = parsed && typeof parsed.reply === 'string' && parsed.reply.trim()
    ? parsed.reply.trim()
    : inLang('Извините, я не расслышал — напишите, пожалуйста, ещё раз 🙂', lang);

  // Plans and reminders (in the future, within a year, not too many). "reminders" is the older answer
  // format: a reminder at that very time.
  const asked = [];
  if (parsed && Array.isArray(parsed.plans)) asked.push(...parsed.plans);
  if (parsed && Array.isArray(parsed.reminders)) asked.push(...parsed.reminders.map(r => ({ ...r, remind_before: 0, reminder: true })));
  if (asked.length) {
    analytics.capture('buddy_plans_added', user.id, { count: asked.length, with_reminder: asked.some(r => r && r.remind_before !== null && r.remind_before !== undefined) });
    let active = (await upcomingPlans(user.id, now)).length;
    for (const r of asked.slice(0, 5)) {
      const at = parseLocal(r && r.at, offset);
      const what = String((r && r.text) || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (!at || !what || at <= now || at - now > 366 * 86400000 || active >= MAX_ACTIVE_REMINDERS) continue;
      const before = r.remind_before === null || r.remind_before === undefined || r.remind_before === '' ? null : parseInt(r.remind_before, 10);
      const notify = Number.isFinite(before) && before >= 0;
      // A reminder earlier than now (e.g. "за час" to something in 30 minutes) goes at once
      const remindAt = notify ? new Date(Math.max(now.getTime(), at.getTime() - Math.min(before, 7 * 1440) * 60000)) : at;
      await db.run(
        'INSERT INTO buddy_reminders (id, user_id, kind, text, starts_at, remind_at, notify) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [newId('rem'), user.id, r.reminder ? 'reminder' : 'plan', what, sqlTime(at), sqlTime(remindAt), notify ? 1 : 0]
      );
      active++;
    }
  }
  if (parsed && Array.isArray(parsed.cancel)) {
    for (const n of parsed.cancel) {
      const r = reminders[Number(n) - 1];
      if (r) await db.run('UPDATE buddy_reminders SET cancelled_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?', [r.id, user.id]);
    }
  }

  const startParam = parsed && PLACES[parsed.open] ? PLACES[parsed.open] : null;
  created.push(await saveMessage(user.id, 'buddy', reply, { startParam }));
  return { messages: created, usage: { used: before.used + 1, max: DAILY_LIMIT }, calendarChanged: asked.length > 0 || Boolean(parsed && Array.isArray(parsed.cancel) && parsed.cancel.length) };
}

/**
 * The alarm clock: reminders whose time has come go out as Buddy's messages (and to Telegram).
 */
async function runReminders(now = new Date()) {
  const due = await db.all(
    `SELECT * FROM buddy_reminders WHERE sent_at IS NULL AND cancelled_at IS NULL AND notify = 1 AND remind_at <= ? ORDER BY remind_at ASC LIMIT 100`,
    [sqlTime(now)]
  );
  let sent = 0;
  for (const r of due) {
    // Taken by this run only (another server copy may run at the same time)
    const taken = await db.run('UPDATE buddy_reminders SET sent_at = CURRENT_TIMESTAMP WHERE id = ? AND sent_at IS NULL', [r.id]);
    if (Number(taken.changes) !== 1) continue;
    await telegramBot.notifyUser(r.user_id, await reminderText(r), { buttonText: { ru: 'Открыть Бадди', en: 'Open Buddy' } });
    sent++;
  }
  return { sent };
}

// "⏰ Напоминаю: …" — for a plan reminded in advance, also its time in the person's clock
async function reminderText(r) {
  const starts = r.starts_at ? toDate(r.starts_at) : null;
  const remind = toDate(r.remind_at);
  const user = await db.get('SELECT tz_offset_minutes, lang, tg_lang FROM users WHERE id = ?', [r.user_id]);
  const en = langOf(user) === 'en';
  if (r.kind !== 'plan' || !starts || starts - remind < 60000) return `⏰ ${en ? 'Reminder' : 'Напоминаю'}: ${r.text}`;
  const local = localClock(starts, cleanOffset(user && user.tz_offset_minutes) ?? 0);
  return `⏰ ${en ? 'Soon, at' : 'Скоро, в'} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}: ${r.text}`;
}

module.exports = {
  DAILY_LIMIT,
  calendar,
  cancelPlan,
  upcomingPlans,
  LIMIT_TEXT,
  PLACES,
  messages,
  markAllRead,
  usage,
  activeReminders,
  send,
  runReminders,
  parseLocal,
  localMidnightUtc
};
