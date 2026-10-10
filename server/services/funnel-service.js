// server/services/funnel-service.js - Event journal and funnel status of a client (base only).
//
// Every action is one row in client_events. The funnel status of a client follows from events:
//  - the funnel of an SI-seller has a goal-offer (projects.offer);
//  - the client answered the offer → "пообщались" (talked), outcome: bought / refused / talked;
//  - no answer to the offer yet → "не дообщались" (not_finished): the client's path still goes on;
//  - the client asked for a person and nobody answered yet → "ждут человека" (waiting_human).
// "If…, then…" scenarios will run on these events later; they are not part of this step.
const crypto = require('crypto');
const db = require('../db');

const STATUSES = {
  not_finished: 'Не дообщались',
  talked: 'Пообщались, но не купили',
  waiting_human: 'Ждут человека',
  bought: 'Купили',
  refused: 'Отказ'
};

// Event types. Those marked "later" are reserved for funnel steps, booking and payments.
const EVENTS = {
  client_message: 'Клиент написал',
  handed_to_human: 'Передан человеку',
  human_replied: 'Человек ответил',
  si_paused: 'SI на паузе',
  si_resumed: 'SI снова отвечает',
  offer_sent: 'Оффер отправлен',          // later: funnel steps
  offer_answered: 'Ответил на оффер',     // later: funnel steps
  objection: 'Возражение',                // later
  booked: 'Записался',                    // later: calendar
  paid: 'Оплатил',                        // later: payment mark
  refused: 'Отказ / ушёл'                 // later
};

const ACTORS = ['client', 'si', 'owner', 'assistant', 'system'];
const PAGE_SIZE = 30;

const newEventId = () => `evt_${Date.now().toString(36)}${crypto.randomBytes(5).toString('hex')}`;

/**
 * Funnel status after an event. Pure: client = { funnel_status, offer_answered_at }.
 */
function nextStatus(client, type) {
  const current = client.funnel_status || 'not_finished';
  if (type === 'paid') return 'bought';
  if (type === 'refused') return 'refused';
  if (current === 'bought' || current === 'refused') return current;
  const talked = Boolean(client.offer_answered_at) || type === 'offer_answered';
  if (type === 'handed_to_human') return 'waiting_human';
  if (current === 'waiting_human' && type !== 'human_replied' && type !== 'si_resumed') return current;
  return talked ? 'talked' : 'not_finished';
}

/**
 * Writes an event to the journal and moves the client's funnel status.
 * actor: { type: 'client' | 'si' | 'owner' | 'assistant' | 'system', userId? }
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
  const offerAnswered = type === 'offer_answered' && !client.offer_answered_at;
  if (status !== client.funnel_status || offerAnswered) {
    await db.run(
      `UPDATE clients SET funnel_status = ?, funnel_updated_at = CURRENT_TIMESTAMP${offerAnswered ? ', offer_answered_at = CURRENT_TIMESTAMP' : ''} WHERE id = ?`,
      [status, client.id]
    );
    client.funnel_status = status;
    if (offerAnswered) client.offer_answered_at = new Date().toISOString();
  }
  return status;
}

async function eventsOf(clientId, limit = 100) {
  const rows = await db.all(
    'SELECT * FROM client_events WHERE client_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    [clientId, limit]
  );
  return rows.map(r => ({
    id: r.id,
    type: r.type,
    label: EVENTS[r.type] || r.type,
    actorType: r.actor_type,
    createdAt: r.created_at
  }));
}

/**
 * Counts per funnel status for a business: counted on request (index business_id + funnel_status).
 */
async function counts(businessId) {
  const rows = await db.all(
    'SELECT funnel_status, COUNT(*) AS count FROM clients WHERE business_id = ? GROUP BY funnel_status',
    [businessId]
  );
  const result = Object.fromEntries(Object.keys(STATUSES).map(k => [k, 0]));
  for (const r of rows) if (r.funnel_status in result) result[r.funnel_status] = Number(r.count) || 0;
  return result;
}

/**
 * Clients of a business in one funnel status, newest activity first, in portions of 30.
 */
async function clientsInStatus(businessId, status, offset = 0) {
  if (!STATUSES[status]) return [];
  return db.all(
    `SELECT id, project_id, name, username, avatar_url, funnel_status, responsible_type, last_message, last_activity
     FROM clients WHERE business_id = ? AND funnel_status = ?
     ORDER BY last_activity DESC, id DESC LIMIT ? OFFSET ?`,
    [businessId, status, PAGE_SIZE, Math.max(0, parseInt(offset, 10) || 0)]
  );
}

module.exports = {
  STATUSES,
  EVENTS,
  PAGE_SIZE,
  nextStatus,
  recordEvent,
  eventsOf,
  counts,
  clientsInStatus
};
