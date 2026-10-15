// server/services/analytics-service.js - Product numbers in PostHog (owner's decision 15 Oct.: start
// collecting now, e.g. to compare "запись у Бадди / в чате" later).
//
// Rules: only the server sends events (the app talks to the server only); no personal data — no names,
// usernames, phones, message texts or amounts; a person is a pseudonymous id (a hash of the internal user
// id), never the Telegram id. Without POSTHOG_API_KEY nothing is sent. A PostHog failure never breaks
// anything: capture() never throws and never waits.
const crypto = require('crypto');
const config = require('../config');

let client = null;
let testClient = null; // tests put a fake here

function getClient() {
  if (testClient) return testClient;
  if (!config.posthogApiKey || config.nodeEnv === 'test') return null;
  if (!client) {
    const { PostHog } = require('posthog-node');
    client = new PostHog(config.posthogApiKey, { host: config.posthogHost, flushAt: 20, flushInterval: 10000 });
  }
  return client;
}

function isConfigured() {
  return Boolean(config.posthogApiKey);
}

/**
 * The same person always gets the same id, which cannot be turned back into their account.
 */
function personId(userId) {
  if (!userId) return 'anonymous';
  return `p_${crypto.createHash('sha256').update(`smartflow:${userId}`).digest('hex').slice(0, 20)}`;
}

// Only short plain values: ids of SI-sellers / steps, kinds, counts, yes/no
const SAFE_KEY = /^[a-z_]{2,40}$/;
function safeProps(props) {
  const out = {};
  for (const [key, value] of Object.entries(props || {})) {
    if (!SAFE_KEY.test(key)) continue;
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) out[key] = value;
    else if (typeof value === 'string' && value.length <= 64 && /^[\w.:-]*$/.test(value)) out[key] = value;
  }
  return out;
}

/**
 * capture('buddy_message', userId, { voice: true }) — fire and forget.
 */
function capture(event, userId, props = {}) {
  try {
    const c = getClient();
    if (!c) return;
    c.capture({ distinctId: personId(userId), event, properties: { ...safeProps(props), $process_person_profile: false } });
  } catch (err) {
    console.warn('[SmartFlow Analytics] not sent:', err.message);
  }
}

// Events of the client journal (funnel-service.recordEvent) that matter for the numbers
const FUNNEL_EVENTS = new Set([
  'client_message', 'offer_sent', 'offer_answered', 'objection', 'buy_clicked', 'booked', 'meeting_moved',
  'meeting_cancelled', 'receipt_sent', 'paid', 'refused', 'handed_to_human', 'human_replied', 'contact_shared',
  'scenario', 'step_reached', 'broadcast', 'broadcasts_off'
]);

/**
 * A row of the client journal → one PostHog event "funnel_<type>" of that client.
 */
function funnelEvent(client, type, actorType, data) {
  if (!FUNNEL_EVENTS.has(type) || !client) return;
  const external = String(client.external_client_id || '');
  capture(`funnel_${type}`, external.startsWith('usr_') ? external : client.id, {
    project_id: client.project_id,
    business_id: client.business_id || '',
    actor: actorType,
    // Where a meeting was booked: the chat with the SI-seller for now (later maybe Buddy)
    source: type === 'booked' ? ((data && data.source) || 'chat') : undefined,
    step_id: type === 'step_reached' && data ? data.stepId : undefined,
    then: type === 'scenario' && data ? data.then : undefined
  });
}

/**
 * Sends what is waiting (on shutdown, so a redeploy loses nothing).
 */
async function flush() {
  try {
    if (client) await client.shutdown(3000);
  } catch (err) {
    console.warn('[SmartFlow Analytics] flush failed:', err.message);
  }
}

module.exports = {
  isConfigured,
  personId,
  capture,
  funnelEvent,
  flush,
  _setClientForTests(fake) { testClient = fake; }
};
