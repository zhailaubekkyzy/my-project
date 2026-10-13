// server/services/buddy-service.js - Buddy: a personal helper for every day, as a conversation.
//
// Owner's decisions: the Buddy screen is a chat with Buddy; every notification is Buddy's message
// (telegram-bot.notifyUser saves it here first, then repeats it in Telegram); the person can talk to
// Buddy about plans and ask for reminders ("напомни завтра в 9 позвонить маме"); later — the calendar.
// Up to 30 messages a day per person (OpenAI costs); reminders and notifications are not limited.
//
// Messages live in `notifications` (sender 'buddy' | 'user'); reminders wait in buddy_reminders and
// the alarm clock (scheduler-service.js) sends them in time as Buddy's messages.
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const siEngine = require('./si-engine');
const telegramBot = require('./telegram-bot');
const profileService = require('./profile-service');

const DAILY_LIMIT = 30;
const MAX_TEXT = 1000;
const HISTORY = 16;
const MAX_ACTIVE_REMINDERS = 50;
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

async function activeReminders(userId) {
  return db.all(
    `SELECT id, text, remind_at FROM buddy_reminders WHERE user_id = ? AND sent_at IS NULL AND cancelled_at IS NULL ORDER BY remind_at ASC LIMIT ?`,
    [userId, MAX_ACTIVE_REMINDERS]
  );
}

function systemPrompt(user, offset, now, reminders) {
  const name = (profileService.toPublicUser(user).displayName || '').split(' ')[0];
  return [
    'Ты — Бадди, личный помощник человека в приложении SmartFlow на каждый день.',
    'Помогаешь спланировать день, разобрать дела и цели, не забыть важное (напоминания), подсказываешь по приложению.',
    '',
    'Как общаться:',
    '- Тепло, по-дружески, коротко: 1–3 предложения, как в мессенджере. На «ты» не переходи, если человек сам не начал.',
    '- Ничего не продаёшь и не советуешь покупать. Не давишь, не морализируешь.',
    '- Ты SI (Super Intelligence) — на прямой вопрос честно скажи, что ты SI-помощник, а не человек.',
    '- Медицинские, юридические и финансовые решения не принимаешь за человека — мягко советуешь специалиста.',
    '- Не выдумывай факты о человеке и его делах: знаешь только то, что он написал, и список напоминаний ниже.',
    '',
    'Приложение SmartFlow: Маркетплейс (SI-продавцы экспертов), Офис (для экспертов: свои SI-продавцы, клиенты, воронка),',
    'Чаты (переписки с SI-продавцами и поддержкой), Профиль. Инкубатор и календарь — скоро.',
    '',
    `Сейчас у человека: ${localLabel(now, offset)}.`,
    name ? `Имя: ${name}.` : '',
    'Его напоминания (номер. когда — что):',
    ...(reminders.length
      ? reminders.map((r, i) => `${i + 1}. ${localLabel(toDate(r.remind_at), offset)} — ${r.text}`)
      : ['(нет)']),
    '',
    'Ответь только JSON:',
    '{"reply": "текст ответа", "reminders": [{"text": "что напомнить", "at": "ГГГГ-ММ-ДД ЧЧ:ММ"}], "cancel": [номера], "open": "marketplace|office|chats|profile|support|none"}',
    '- reminders: только если человек ясно просит напомнить; время — по его часам; если время неясно, спроси в reply и оставь [].',
    '- cancel: номера напоминаний, которые человек просит отменить.',
    '- open: раздел, куда уместно дать кнопку (например, человек спрашивает, где найти экспертов → marketplace), иначе "none".',
    '- В reply подтверди, что запомнил напоминание, с днём и временем.'
  ].filter(line => line !== '').join('\n');
}

/**
 * The person writes to Buddy. Returns { messages: [new ones], usage }.
 */
async function send(user, rawText, tzOffset, now = new Date()) {
  const text = String(rawText || '').trim().slice(0, MAX_TEXT);
  if (!text) return { messages: [], usage: await usage(user.id, user.tz_offset_minutes) };
  const offset = cleanOffset(tzOffset) ?? cleanOffset(user.tz_offset_minutes) ?? 0;
  if (offset !== user.tz_offset_minutes) {
    await db.run('UPDATE users SET tz_offset_minutes = ? WHERE id = ?', [offset, user.id]);
  }

  const before = await usage(user.id, offset, now);
  const mine = await saveMessage(user.id, 'user', text);
  const created = [mine];

  if (before.used >= DAILY_LIMIT) {
    // Say it once a day; then stay quiet (no OpenAI)
    const told = await db.get(
      `SELECT id FROM notifications WHERE user_id = ? AND sender = 'buddy' AND text = ? AND created_at >= ? LIMIT 1`,
      [user.id, LIMIT_TEXT, sqlTime(localMidnightUtc(now, offset))]
    );
    if (!told) created.push(await saveMessage(user.id, 'buddy', LIMIT_TEXT));
    return { messages: created, usage: { used: before.used + 1, max: DAILY_LIMIT }, limitReached: true };
  }

  if (!siEngine.isConfigured()) {
    created.push(await saveMessage(user.id, 'buddy', NO_AI_TEXT));
    return { messages: created, usage: { used: before.used + 1, max: DAILY_LIMIT } };
  }

  const reminders = await activeReminders(user.id);
  const history = (await messages(user.id, HISTORY + 1)).slice(0, -1); // without the message just saved
  const chat = [{ role: 'system', content: systemPrompt(user, offset, now, reminders) }];
  for (const m of history) {
    chat.push({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.text });
  }
  chat.push({ role: 'user', content: text });

  const answer = await siEngine.callOpenAI(chat, { model: config.buddyModel, response_format: { type: 'json_object' } });
  let parsed = null;
  try { parsed = answer ? JSON.parse(answer) : null; } catch (e) { parsed = null; }
  const reply = parsed && typeof parsed.reply === 'string' && parsed.reply.trim()
    ? parsed.reply.trim()
    : 'Извините, я не расслышал — напишите, пожалуйста, ещё раз 🙂';

  // Reminders the person asked for (in the future, within a year, not too many)
  if (parsed && Array.isArray(parsed.reminders)) {
    let active = reminders.length;
    for (const r of parsed.reminders.slice(0, 5)) {
      const at = parseLocal(r && r.at, offset);
      const what = String((r && r.text) || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (!at || !what || at <= now || at - now > 366 * 86400000 || active >= MAX_ACTIVE_REMINDERS) continue;
      await db.run(
        'INSERT INTO buddy_reminders (id, user_id, text, remind_at) VALUES (?, ?, ?, ?)',
        [newId('rem'), user.id, what, sqlTime(at)]
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
  return { messages: created, usage: { used: before.used + 1, max: DAILY_LIMIT } };
}

/**
 * The alarm clock: reminders whose time has come go out as Buddy's messages (and to Telegram).
 */
async function runReminders(now = new Date()) {
  const due = await db.all(
    `SELECT * FROM buddy_reminders WHERE sent_at IS NULL AND cancelled_at IS NULL AND remind_at <= ? ORDER BY remind_at ASC LIMIT 100`,
    [sqlTime(now)]
  );
  let sent = 0;
  for (const r of due) {
    // Taken by this run only (another server copy may run at the same time)
    const taken = await db.run('UPDATE buddy_reminders SET sent_at = CURRENT_TIMESTAMP WHERE id = ? AND sent_at IS NULL', [r.id]);
    if (Number(taken.changes) !== 1) continue;
    await telegramBot.notifyUser(r.user_id, `⏰ Напоминаю: ${r.text}`, { buttonText: 'Открыть Бадди' });
    sent++;
  }
  return { sent };
}

module.exports = {
  DAILY_LIMIT,
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
