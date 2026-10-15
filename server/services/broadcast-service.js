// server/services/broadcast-service.js - Broadcasts of an SI-seller: announcements (an event, news, a promotion).
//
// Owner's decisions: the expert writes in words whom and what to send ("всем, кто не купил за месяц —
// анонс эфира в субботу"); SI picks the audience and drafts the text; nothing goes out before the expert
// confirms. The assistant prepares a broadcast, the owner approves it. A broadcast is a message in the
// client's chat with the SI-seller (inside SmartFlow, marked "Рассылка") plus Buddy / Telegram telling
// them about it — the chat stays the place where people talk.
//
// Platform rules against spam (for every expert):
//  - only clients who wrote at least once; never to those who refused or said "Не присылать рассылки";
//  - at most 1 broadcast a day and 3 a week per SI-seller;
//  - sent by the alarm clock in portions, only 9:00–21:00 by the client's time (unknown — Almaty, UTC+5);
//  - a client who refused or opted out while a broadcast is going gets nothing.
const crypto = require('crypto');
const db = require('../db');
const siEngine = require('./si-engine');
const telegramBot = require('./telegram-bot');
const funnelService = require('./funnel-service');
const businessService = require('./business-service');
const analytics = require('./analytics-service');
const config = require('../config');

const MAX_TEXT = 1000;
const MAX_REQUEST = 500;
const PER_DAY = 1;
const PER_WEEK = 3;
const PER_RUN = 100;
const DAY_START = 9;
const DAY_END = 21;
const DAYS = [7, 30, 90];
// Statuses one may choose; "Отказ" is never offered
const AUDIENCE_STATUSES = ['not_finished', 'objections', 'waiting_human', 'bought'];

class BroadcastError extends Error {
  constructor(message, status = 400, code = 'BROADCAST_REFUSED') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const sqlTime = (date) => date.toISOString().slice(0, 19).replace('T', ' ');
const clean = (value, max) => String(value || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

function parseJson(str, fallback = {}) {
  if (!str) return fallback;
  if (typeof str === 'object') return str;
  try { return JSON.parse(str) || fallback; } catch (e) { return fallback; }
}

/**
 * Whom to send to, as safe values: { statuses: [...], stepIds: [...], days: 7|30|90|null, objection: '' }.
 * No statuses chosen = everybody who may get broadcasts.
 */
function normalizeAudience(raw, steps = []) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const stepIds = funnelService.normalizeSteps(steps).map(s => s.id);
  const days = parseInt(a.days, 10);
  return {
    statuses: [...new Set((Array.isArray(a.statuses) ? a.statuses : []).filter(s => AUDIENCE_STATUSES.includes(s)))],
    stepIds: [...new Set((Array.isArray(a.stepIds) ? a.stepIds : []).filter(id => stepIds.includes(id)))],
    days: DAYS.includes(days) ? days : null,
    objection: clean(a.objection, 60)
  };
}

/**
 * The clients of this audience (who may get a broadcast at all), newest activity first.
 */
async function audienceClients(project, audience, limit = 5000) {
  const where = [
    'c.project_id = ?',
    `c.funnel_status <> 'refused'`,
    'c.broadcasts_off_at IS NULL',
    `EXISTS (SELECT 1 FROM client_events e WHERE e.client_id = c.id AND e.type = 'client_message')`
  ];
  const params = [project.id];
  if (audience.statuses.length) {
    where.push(`c.funnel_status IN (${audience.statuses.map(() => '?').join(', ')})`);
    params.push(...audience.statuses);
  }
  if (audience.stepIds.length) {
    // The first step also holds clients without a step (or with a deleted one)
    const steps = funnelService.normalizeSteps(parseJson(project.custom_ai_settings).steps);
    const first = steps[0] && steps[0].id;
    const others = steps.slice(1).map(s => s.id);
    const parts = [`c.step_id IN (${audience.stepIds.map(() => '?').join(', ')})`];
    params.push(...audience.stepIds);
    if (first && audience.stepIds.includes(first)) {
      parts.push(others.length ? `c.step_id IS NULL OR c.step_id NOT IN (${others.map(() => '?').join(', ')})` : '1 = 1');
      params.push(...others);
    }
    where.push(`(${parts.join(' OR ')})`);
  }
  if (audience.days) {
    where.push('c.last_activity >= ?');
    params.push(sqlTime(new Date(Date.now() - audience.days * 86400000)));
  }
  if (audience.objection) {
    where.push('LOWER(COALESCE(c.last_objection, \'\')) LIKE ?');
    params.push(`%${audience.objection.toLowerCase()}%`);
  }
  return db.all(
    `SELECT c.* FROM clients c WHERE ${where.join(' AND ')} ORDER BY c.last_activity DESC, c.id DESC LIMIT ?`,
    [...params, limit]
  );
}

/**
 * How many would get it and the first names (for the expert's preview).
 */
async function preview(project, rawAudience) {
  const audience = normalizeAudience(rawAudience, parseJson(project.custom_ai_settings).steps);
  const clients = await audienceClients(project, audience);
  return { audience, count: clients.length, sample: clients.slice(0, 5).map(c => c.name || 'Клиент') };
}

/**
 * "Кому и что — словами" → audience + a draft text (OpenAI). Without OpenAI: null (the form is filled by hand).
 */
async function planFromWords(project, request) {
  const words = clean(request, MAX_REQUEST);
  if (!words) throw new BroadcastError('Напишите словами, кому и что отправить.', 400, 'EMPTY');
  if (!siEngine.isConfigured()) return null;
  const steps = funnelService.normalizeSteps(parseJson(project.custom_ai_settings).steps);
  const answer = await siEngine.callOpenAI([
    {
      role: 'system',
      content: [
        `Ты помогаешь эксперту сделать рассылку клиентам его SI-продавца «${project.name}» внутри приложения SmartFlow.`,
        'По его просьбе выбери, кому отправить, и напиши текст. Ответь только JSON:',
        '{"statuses": [...], "step_ids": [...], "days": 7|30|90|null, "objection": "", "text": "..."}',
        '- statuses (пусто = все): not_finished — не дошли до конца воронки; objections — есть возражения; waiting_human — ждут человека; bought — купили.',
        `- step_ids: шаги воронки, если эксперт про них говорит; шаги: ${steps.length ? steps.map(s => `${s.id} — ${s.title}`).join('; ') : '(нет)'}.`,
        '- days: только те, кто писал за последние N дней (7, 30 или 90), иначе null.',
        '- objection: слово из возражения, если эксперт просит («кому дорого» → «дорого»), иначе "".',
        '- text: само сообщение клиенту от имени эксперта: тепло, коротко (2–5 предложений), без давления и капса, на «вы».',
        '  Только факты из просьбы эксперта — не выдумывай даты, цены, скидки и ссылки. Если ссылка есть в просьбе — вставь её как есть.',
        `Оффер SI-продавца: ${project.offer || '(не задан)'}.`
      ].join('\n')
    },
    { role: 'user', content: words }
  ], { response_format: { type: 'json_object' } });
  let parsed = null;
  try { parsed = answer ? JSON.parse(answer) : null; } catch (e) { parsed = null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const audience = normalizeAudience({ statuses: parsed.statuses, stepIds: parsed.step_ids, days: parsed.days, objection: parsed.objection }, steps);
  return { audience, text: clean(parsed.text, MAX_TEXT) };
}

function toBroadcast(row, names = {}) {
  return {
    id: row.id,
    status: row.status,
    request: row.request || '',
    audience: parseJson(row.audience),
    text: row.text,
    total: Number(row.total) || 0,
    sent: Number(row.sent) || 0,
    createdBy: row.created_by,
    createdByName: names[row.created_by] || null,
    createdAt: row.created_at,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null
  };
}

async function listOf(projectId) {
  const rows = await db.all(
    `SELECT b.*, u.display_name AS creator_name FROM broadcasts b LEFT JOIN users u ON u.id = b.created_by
     WHERE b.project_id = ? ORDER BY b.created_at DESC LIMIT 30`,
    [projectId]
  );
  return rows.map(r => toBroadcast(r, { [r.created_by]: r.creator_name }));
}

// Broadcasts started in the last day / week (for the limits)
async function recentStarts(projectId, now = new Date()) {
  const rows = await db.all(
    `SELECT started_at FROM broadcasts WHERE project_id = ? AND started_at IS NOT NULL AND started_at >= ?`,
    [projectId, sqlTime(new Date(now.getTime() - 7 * 86400000))]
  );
  const dayAgo = now.getTime() - 86400000;
  const day = rows.filter(r => new Date(String(r.started_at).replace(' ', 'T') + (/[Z+]/.test(String(r.started_at)) ? '' : 'Z')).getTime() >= dayAgo).length;
  return { day, week: rows.length };
}

async function checkLimits(projectId, now = new Date()) {
  const { day, week } = await recentStarts(projectId, now);
  if (day >= PER_DAY) throw new BroadcastError('Сегодня рассылка этого SI-продавца уже была. Следующую можно отправить завтра — так клиенты не устают.', 429, 'LIMIT_DAY');
  if (week >= PER_WEEK) throw new BroadcastError('За неделю уже было 3 рассылки — это максимум, чтобы клиенты не отписывались.', 429, 'LIMIT_WEEK');
}

/**
 * Starts sending: the recipients are taken now; the alarm clock sends them in portions.
 */
async function start(project, broadcast, ownerId, now = new Date()) {
  await checkLimits(project.id, now);
  const audience = normalizeAudience(parseJson(broadcast.audience), parseJson(project.custom_ai_settings).steps);
  const clients = await audienceClients(project, audience);
  if (!clients.length) throw new BroadcastError('Под эти условия сейчас не подходит ни один клиент.', 400, 'NOBODY');
  // Taken by this request only (a double tap must not start it twice)
  const taken = await db.run(
    `UPDATE broadcasts SET status = 'sending', approved_by = ?, started_at = ?, total = ? WHERE id = ? AND status IN ('draft', 'pending_approval')`,
    [ownerId, sqlTime(now), clients.length, broadcast.id]
  );
  if (Number(taken.changes) !== 1) throw new BroadcastError('Эта рассылка уже отправляется или отменена.', 409, 'ALREADY');
  for (const c of clients) {
    await db.run('INSERT INTO broadcast_recipients (broadcast_id, client_id) VALUES (?, ?)', [broadcast.id, c.id]);
  }
  analytics.capture('broadcast_started', ownerId, { project_id: project.id, recipients: clients.length });
  return toBroadcast(await db.get('SELECT * FROM broadcasts WHERE id = ?', [broadcast.id]));
}

/**
 * A new broadcast. The owner may send it at once (send: true); the assistant's goes to the owner for approval.
 * member: { userId, role: 'owner' | 'assistant' }
 */
async function create(project, member, { request, audience, text, send = false }, now = new Date()) {
  const body = clean(text, MAX_TEXT);
  if (!body) throw new BroadcastError('Напишите текст рассылки.', 400, 'EMPTY_TEXT');
  const normalized = normalizeAudience(audience, parseJson(project.custom_ai_settings).steps);
  const assistant = member.role === 'assistant';
  const id = `bct_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await db.run(
    'INSERT INTO broadcasts (id, business_id, project_id, created_by, status, request, audience, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, project.business_id || null, project.id, member.userId, assistant ? 'pending_approval' : 'draft', clean(request, MAX_REQUEST), JSON.stringify(normalized), body]
  );
  const row = await db.get('SELECT * FROM broadcasts WHERE id = ?', [id]);
  if (assistant) {
    const count = (await audienceClients(project, normalized)).length;
    await telegramBot.notifyUser(
      project.owner_id,
      `📣 Помощник подготовил рассылку «${project.name}» для ${count} клиентов. Проверьте текст и одобрите в Офисе → SI-продавец → «Рассылки».\n\n«${body.slice(0, 300)}»`,
      { buttonText: 'Открыть Офис', startParam: 'GO_office' }
    );
    return toBroadcast(row);
  }
  // If sending is refused (limits, nobody fits), the draft stays: the expert can send it later
  if (send) return start(project, row, member.userId, now);
  return toBroadcast(row);
}

async function ofProject(project, broadcastId) {
  const row = await db.get('SELECT * FROM broadcasts WHERE id = ? AND project_id = ?', [String(broadcastId || ''), project.id]);
  if (!row) throw new BroadcastError('Рассылка не найдена', 404, 'NOT_FOUND');
  return row;
}

/**
 * The owner sends a draft or approves the assistant's broadcast.
 */
async function approve(project, broadcastId, ownerId, { text } = {}, now = new Date()) {
  const row = await ofProject(project, broadcastId);
  if (text !== undefined) {
    const body = clean(text, MAX_TEXT);
    if (!body) throw new BroadcastError('Напишите текст рассылки.', 400, 'EMPTY_TEXT');
    await db.run(`UPDATE broadcasts SET text = ? WHERE id = ? AND status IN ('draft', 'pending_approval')`, [body, row.id]);
    row.text = body;
  }
  const result = await start(project, row, ownerId, now);
  if (row.status === 'pending_approval' && row.created_by && row.created_by !== ownerId) {
    await telegramBot.notifyUser(row.created_by, `✅ Владелец одобрил рассылку «${project.name}» — она отправляется клиентам.`, { buttonText: 'Открыть Офис', startParam: 'GO_office' });
  }
  return result;
}

/**
 * Stop: a draft or one waiting for approval is cancelled; a sending one stops (who got it, got it).
 * The assistant may cancel only their own not yet sent broadcast.
 */
async function cancel(project, broadcastId, member) {
  const row = await ofProject(project, broadcastId);
  if (member.role === 'assistant' && (row.created_by !== member.userId || row.status === 'sending')) {
    throw new BroadcastError('Остановить эту рассылку может только владелец.', 403, 'OWNER_ONLY');
  }
  if (!['draft', 'pending_approval', 'sending'].includes(row.status)) throw new BroadcastError('Рассылка уже завершена.', 409, 'FINISHED');
  await db.run(`UPDATE broadcasts SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP WHERE id = ?`, [row.id]);
  await db.run(`UPDATE broadcast_recipients SET status = 'skipped' WHERE broadcast_id = ? AND status = 'pending'`, [row.id]);
  return toBroadcast(await db.get('SELECT * FROM broadcasts WHERE id = ?', [row.id]));
}

/**
 * The client's local hour (by the phone's time zone; unknown — Almaty).
 */
async function localHour(client, now) {
  const external = String(client.external_client_id || '');
  let offset = config.defaultTzOffset;
  if (external.startsWith('usr_')) {
    const user = await db.get('SELECT tz_offset_minutes FROM users WHERE id = ?', [external]);
    if (user && Number.isFinite(Number(user.tz_offset_minutes)) && user.tz_offset_minutes !== null) offset = Number(user.tz_offset_minutes);
  }
  return new Date(now.getTime() + offset * 60000).getUTCHours();
}

const isDaytime = (hour) => hour >= DAY_START && hour < DAY_END;

/**
 * The alarm clock: sends waiting broadcast messages (portions, daytime of each client only).
 */
async function runBroadcasts(now = new Date()) {
  const pending = await db.all(
    `SELECT r.broadcast_id, r.client_id FROM broadcast_recipients r JOIN broadcasts b ON b.id = r.broadcast_id
     WHERE r.status = 'pending' AND b.status = 'sending' ORDER BY b.started_at ASC LIMIT ?`,
    [PER_RUN * 5]
  );
  let sent = 0;
  const cache = {};
  for (const r of pending) {
    if (sent >= PER_RUN) break;
    const b = cache[r.broadcast_id] || (cache[r.broadcast_id] = await db.get(
      'SELECT b.*, p.name AS project_name, p.slug, p.owner_id FROM broadcasts b JOIN projects p ON p.id = b.project_id WHERE b.id = ?', [r.broadcast_id]
    ));
    const client = await db.get('SELECT * FROM clients WHERE id = ?', [r.client_id]);
    if (!b || !client) continue;
    // Refused or opted out meanwhile → nothing
    if (client.funnel_status === 'refused' || client.broadcasts_off_at) {
      await db.run(`UPDATE broadcast_recipients SET status = 'skipped' WHERE broadcast_id = ? AND client_id = ?`, [b.id, client.id]);
      continue;
    }
    if (!isDaytime(await localHour(client, now))) continue; // waits for the client's morning
    // Taken by this run only (another server copy may run at the same time)
    const taken = await db.run(
      `UPDATE broadcast_recipients SET status = 'sent', sent_at = ? WHERE broadcast_id = ? AND client_id = ? AND status = 'pending'`,
      [sqlTime(now), b.id, client.id]
    );
    if (Number(taken.changes) !== 1) continue;
    // A message from the expert in the chat (the SI keeps answering: it is not a personal reply)
    const chatService = require('./chat-service');
    await chatService.saveMessage(client, { type: 'owner', userId: b.owner_id }, b.text, null, { broadcast: true });
    await funnelService.recordEvent(client, 'broadcast', { type: 'owner', userId: b.owner_id }, { broadcastId: b.id });
    await db.run('UPDATE broadcasts SET sent = sent + 1 WHERE id = ?', [b.id]);
    if (String(client.external_client_id || '').startsWith('usr_')) {
      await telegramBot.notifyUser(client.external_client_id, `📣 «${b.project_name}»: ${b.text.slice(0, 200)}${b.text.length > 200 ? '…' : ''}`, {
        buttonText: 'Открыть чат', startParam: b.slug
      });
    }
    sent++;
  }
  // Finished broadcasts: nobody left to send → "sent", the creator is told
  const sending = await db.all(`SELECT b.*, p.name AS project_name FROM broadcasts b JOIN projects p ON p.id = b.project_id WHERE b.status = 'sending'`);
  for (const b of sending) {
    const left = await db.get(`SELECT COUNT(*) AS n FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'pending'`, [b.id]);
    if (Number(left.n) > 0) continue;
    const done = await db.run(`UPDATE broadcasts SET status = 'sent', finished_at = ? WHERE id = ? AND status = 'sending'`, [sqlTime(now), b.id]);
    if (Number(done.changes) !== 1) continue;
    const people = b.business_id ? await businessService.activeMemberIds(b.business_id) : [];
    const tell = [...new Set([b.approved_by, b.created_by].filter(Boolean))].filter(id => !people.length || people.includes(id));
    for (const userId of tell) {
      await telegramBot.notifyUser(userId, `📣 Рассылка «${b.project_name}» отправлена: получили ${b.sent} из ${b.total}.`, { buttonText: 'Открыть Офис', startParam: 'GO_office' });
    }
  }
  return { sent };
}

/**
 * The client: "Не присылать рассылки" / "Снова присылать" in the chat with this SI-seller.
 */
async function setClientOptOut(project, client, off) {
  await db.run(`UPDATE clients SET broadcasts_off_at = ${off ? 'CURRENT_TIMESTAMP' : 'NULL'} WHERE id = ?`, [client.id]);
  if (off) {
    await db.run(
      `UPDATE broadcast_recipients SET status = 'skipped' WHERE client_id = ? AND status = 'pending'`,
      [client.id]
    );
    await funnelService.recordEvent(client, 'broadcasts_off', { type: 'client' });
  }
  return { broadcastsOff: Boolean(off) };
}

module.exports = {
  BroadcastError,
  AUDIENCE_STATUSES,
  PER_DAY,
  PER_WEEK,
  normalizeAudience,
  preview,
  planFromWords,
  listOf,
  create,
  approve,
  cancel,
  runBroadcasts,
  setClientOptOut,
  isDaytime,
  localHour,
  DAY_START,
  DAY_END
};
