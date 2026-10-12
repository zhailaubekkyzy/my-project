// server/services/funnel-service.js - Event journal, funnel status of a client and "if…, then…" scenarios.
//
// Every action is one row in client_events. The funnel status of a client follows from events:
//  - the funnel of an SI-seller has a goal-offer (projects.offer);
//  - no answer to the offer yet → "Не дошли до конца воронки" (not_finished): the path still goes on;
//  - the client answered the offer or objected, but has not bought → "Есть возражения" (objections);
//  - the client asked for a person and nobody answered yet → "Ждут человека" (waiting_human);
//  - outcomes: "Купили" (bought, marked by the expert or the assistant) and "Отказ" (refused).
// Scenarios live in the SI-seller's methodology (custom_ai_settings.scenarios): "если клиент
// возразил «дорого» → SI отвечает так: …", "→ передать человеку", "→ сообщить мне в Telegram".
// "SI отвечает так" goes into the SI prompt; the other actions run on events (chat-service.js).
const crypto = require('crypto');
const db = require('../db');

const STATUSES = {
  not_finished: 'Не дошли до конца воронки',
  objections: 'Есть возражения',
  waiting_human: 'Ждут человека',
  bought: 'Купили',
  refused: 'Отказ'
};

// Event types. "booked" is reserved for the calendar.
const EVENTS = {
  client_message: 'Клиент написал',
  handed_to_human: 'Передан человеку',
  human_replied: 'Человек ответил',
  si_paused: 'SI на паузе',
  si_resumed: 'SI снова отвечает',
  offer_sent: 'SI предложил оффер',
  offer_answered: 'Ответил на оффер',
  objection: 'Возражение',
  buy_clicked: 'Нажал «Купить»',
  booked: 'Записался',                    // later: calendar
  receipt_sent: 'Прислал чек',
  receipt_rejected: 'Чек не подтверждён',
  paid: 'Оплатил',
  refused: 'Отказ / ушёл',
  reopened: 'Вернули в воронку',
  contact_shared: 'Поделился контактом',
  condition: 'Условие эксперта',
  scenario: 'Сработал сценарий'
};

const ACTORS = ['client', 'si', 'owner', 'assistant', 'system'];
const PAGE_SIZE = 30;

// ---------- Scenarios "если…, то…" (part of the SI-seller's methodology) ----------
// "custom" = the expert's own condition in words ("клиент спрашивает про рассрочку"): the SI
// notices it in the conversation (si-engine.analyzeTurn). No scenario exists by default.
const SCENARIO_WHEN = {
  objection: 'Клиент возразил',
  offer_answered: 'Клиент ответил на оффер',
  buy_clicked: 'Клиент нажал «Купить»',
  receipt_sent: 'Клиент прислал чек',
  refused: 'Клиент отказался',
  silent: 'Клиент замолчал',
  custom: 'Своё условие'
};
// "Клиент замолчал на N часов": checked by the server alarm clock (followup-service.js)
const SILENT_HOURS = { min: 1, max: 720, default: 24 };
const SCENARIO_THEN = {
  si_says: 'SI отвечает так',
  handover: 'Передать человеку (SI на паузу)',
  notify: 'Сообщить мне в Telegram'
};
const MAX_SCENARIOS = 20;

const newEventId = () => `evt_${Date.now().toString(36)}${crypto.randomBytes(5).toString('hex')}`;
const clean = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Scenarios as the expert typed them → a safe list. Unknown "if"/"then" are dropped;
 * "SI отвечает так" without text is dropped too.
 */
function normalizeScenarios(list) {
  if (!Array.isArray(list)) return [];
  const result = [];
  for (const raw of list.slice(0, MAX_SCENARIOS)) {
    if (!raw || !SCENARIO_WHEN[raw.when] || !SCENARIO_THEN[raw.then]) continue;
    const scenario = {
      id: /^scn_[a-z0-9]{4,20}$/.test(raw.id) ? raw.id : `scn_${crypto.randomBytes(5).toString('hex')}`,
      when: raw.when,
      words: raw.when === 'objection' ? clean(raw.words, 120) : '',
      condition: raw.when === 'custom' ? clean(raw.condition, 200) : '',
      hours: raw.when === 'silent'
        ? Math.max(SILENT_HOURS.min, Math.min(SILENT_HOURS.max, parseInt(raw.hours, 10) || SILENT_HOURS.default))
        : undefined,
      then: raw.then,
      text: clean(raw.text, 500)
    };
    // "SI отвечает так" needs the words, except after silence: then the SI writes a reminder itself
    if (scenario.then === 'si_says' && !scenario.text && scenario.when !== 'silent') continue;
    if (scenario.when === 'custom' && !scenario.condition) continue;
    if (scenario.hours === undefined) delete scenario.hours;
    result.push(scenario);
  }
  return result;
}

const wordsOf = (scenario) => scenario.words.split(/[,;]/).map(w => w.trim().toLowerCase()).filter(Boolean);

/**
 * Does the scenario fire on this event? For objections with words: one of the words is in the
 * objection or in the client's message ("дорого, нет денег").
 */
function scenarioMatches(scenario, type, data = {}) {
  if (type === 'condition') return scenario.when === 'custom' && (data.matched || []).includes(scenario.id);
  if (scenario.when !== type) return false;
  if (type !== 'objection') return true;
  const words = wordsOf(scenario);
  if (!words.length) return true;
  const haystack = `${data.objection || ''} ${data.text || ''}`.toLowerCase();
  return words.some(w => haystack.includes(w));
}

/**
 * The expert's own conditions for the turn analysis: [{ id, text }].
 */
function customConditions(scenarios) {
  return normalizeScenarios(scenarios).filter(s => s.when === 'custom').map(s => ({ id: s.id, text: s.condition }));
}

/**
 * "SI отвечает так" scenarios as lines for the SI prompt.
 */
function scenarioPromptLines(scenarios) {
  // "Клиент замолчал → SI отвечает так" is not a rule for the conversation: the SI writes it itself later
  return normalizeScenarios(scenarios)
    .filter(s => s.then === 'si_says' && s.when !== 'silent')
    .map(s => {
      const words = wordsOf(s);
      let when = `Если ${SCENARIO_WHEN[s.when].charAt(0).toLowerCase()}${SCENARIO_WHEN[s.when].slice(1)}`;
      if (s.when === 'objection' && words.length) when = `Если клиент возражает (${words.map(w => `«${w}»`).join(', ')})`;
      if (s.when === 'custom') when = `Если ${s.condition}`;
      return `- ${when}: ${s.text}`;
    });
}

// ---------- Status ----------
/**
 * Funnel status after an event. Pure: client = { funnel_status, offer_answered_at, objection_at }.
 */
function nextStatus(client, type) {
  const current = client.funnel_status || 'not_finished';
  if (type === 'paid') return 'bought';
  if (type === 'refused') return 'refused';
  const talked = Boolean(client.offer_answered_at || client.objection_at) || type === 'offer_answered' || type === 'objection';
  const base = talked ? 'objections' : 'not_finished';
  if (type === 'reopened') return base;
  // A receipt needs a person to check it, even from a client who refused earlier
  if (type === 'receipt_sent' && current !== 'bought') return 'waiting_human';
  if (current === 'bought' || current === 'refused') return current;
  if (type === 'handed_to_human') return 'waiting_human';
  if (current === 'waiting_human' && !['human_replied', 'si_resumed', 'receipt_rejected'].includes(type)) return current;
  return base;
}

/**
 * Writes an event to the journal and moves the client's funnel status.
 * actor: { type: 'client' | 'si' | 'owner' | 'assistant' | 'system', userId? }
 * data: { objection } for objections, { scenarioId, then } for scenarios...
 */
async function recordEvent(client, type, actor, data = null) {
  if (!EVENTS[type]) throw new Error(`Unknown event type: ${type}`);
  const actorType = ACTORS.includes(actor && actor.type) ? actor.type : 'system';
  await db.run(
    `INSERT INTO client_events (id, business_id, project_id, client_id, type, actor_type, actor_user_id, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [newEventId(), client.business_id || null, client.project_id, client.id, type, actorType, (actor && actor.userId) || null, data ? JSON.stringify(data) : null]
  );

  const status = nextStatus(client, type);
  const sets = [];
  const params = [];
  if (status !== client.funnel_status) {
    sets.push('funnel_status = ?', 'funnel_updated_at = CURRENT_TIMESTAMP');
    params.push(status);
  }
  if (type === 'offer_answered' && !client.offer_answered_at) sets.push('offer_answered_at = CURRENT_TIMESTAMP');
  if (type === 'objection') {
    sets.push('last_objection = ?', 'objection_at = CURRENT_TIMESTAMP');
    params.push(clean(data && data.objection, 200) || null);
  }
  if (sets.length) {
    await db.run(`UPDATE clients SET ${sets.join(', ')} WHERE id = ?`, [...params, client.id]);
    const now = new Date().toISOString();
    client.funnel_status = status;
    if (type === 'offer_answered' && !client.offer_answered_at) client.offer_answered_at = now;
    if (type === 'objection') {
      client.objection_at = now;
      client.last_objection = clean(data && data.objection, 200) || null;
    }
  }
  return status;
}

async function hasEvent(clientId, type) {
  return Boolean(await db.get('SELECT id FROM client_events WHERE client_id = ? AND type = ? LIMIT 1', [clientId, type]));
}

// Scenario actions (handover / notify) fire once per client
async function scenarioFired(clientId, scenarioId) {
  const rows = await db.all(`SELECT data FROM client_events WHERE client_id = ? AND type = 'scenario'`, [clientId]);
  return rows.some(r => {
    try { return JSON.parse(r.data || '{}').scenarioId === scenarioId; } catch (e) { return false; }
  });
}

async function eventsOf(clientId, limit = 100) {
  const rows = await db.all(
    'SELECT * FROM client_events WHERE client_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    [clientId, limit]
  );
  return rows.map(r => {
    let data = {};
    try { data = JSON.parse(r.data || '{}') || {}; } catch (e) {}
    let detail = '';
    if (r.type === 'objection') detail = data.objection || '';
    if (r.type === 'scenario') detail = `${SCENARIO_THEN[data.then] || ''}${data.silentHours ? ` (молчит ${data.silentHours} ч)` : ''}`;
    if (r.type === 'condition') detail = data.condition || '';
    return {
      id: r.id,
      type: r.type,
      label: EVENTS[r.type] || r.type,
      detail,
      actorType: r.actor_type,
      createdAt: r.created_at
    };
  });
}

// ---------- Funnel screen: counts and lists ----------
// "За 7 / 30 дней" = clients active in that period. SQLite and PostgreSQL both compare
// 'YYYY-MM-DD HH:MM:SS' (UTC) with the stored timestamp.
function cutoffOf(days) {
  const n = parseInt(days, 10);
  if (!n || n <= 0) return null;
  return new Date(Date.now() - Math.min(n, 3650) * 86400000).toISOString().slice(0, 19).replace('T', ' ');
}

function filterSql(businessId, { days, projectId } = {}, prefix = '') {
  const where = [`${prefix}business_id = ?`];
  const params = [businessId];
  const cutoff = cutoffOf(days);
  if (cutoff) {
    where.push(`${prefix}last_activity >= ?`);
    params.push(cutoff);
  }
  if (projectId) {
    where.push(`${prefix}project_id = ?`);
    params.push(String(projectId));
  }
  return { where: where.join(' AND '), params };
}

/**
 * Counts per funnel status for a business: counted on request (index business_id + funnel_status).
 */
async function counts(businessId, filter = {}) {
  const { where, params } = filterSql(businessId, filter);
  const rows = await db.all(
    `SELECT funnel_status, COUNT(*) AS count FROM clients WHERE ${where} GROUP BY funnel_status`,
    params
  );
  const result = Object.fromEntries(Object.keys(STATUSES).map(k => [k, 0]));
  for (const r of rows) if (r.funnel_status in result) result[r.funnel_status] = Number(r.count) || 0;
  return result;
}

/**
 * Clients of a business in one funnel status, newest activity first, in portions of 30.
 */
async function clientsInStatus(businessId, status, { offset = 0, days, projectId } = {}) {
  if (!STATUSES[status]) return [];
  const { where, params } = filterSql(businessId, { days, projectId }, 'c.');
  return db.all(
    `SELECT c.id, c.project_id, c.name, c.username, c.avatar_url, c.funnel_status, c.responsible_type,
            c.last_message, c.last_activity, c.last_objection, p.name AS project_name
     FROM clients c JOIN projects p ON p.id = c.project_id
     WHERE ${where} AND c.funnel_status = ?
     ORDER BY c.last_activity DESC, c.id DESC LIMIT ? OFFSET ?`,
    [...params, status, PAGE_SIZE, Math.max(0, parseInt(offset, 10) || 0)]
  );
}

module.exports = {
  STATUSES,
  EVENTS,
  SCENARIO_WHEN,
  SCENARIO_THEN,
  MAX_SCENARIOS,
  SILENT_HOURS,
  PAGE_SIZE,
  normalizeScenarios,
  customConditions,
  scenarioMatches,
  scenarioPromptLines,
  nextStatus,
  recordEvent,
  hasEvent,
  scenarioFired,
  eventsOf,
  counts,
  clientsInStatus
};
