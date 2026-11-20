// server/services/analytics-service.js - Product numbers in PostHog and Amplitude (owner's decisions:
// PostHog 15 Oct. — start collecting now, e.g. to compare "запись у Бадди / в чате" later; Amplitude
// 18 Nov. — the same events go to both, each one works only when its key is in Railway).
//
// Rules: only the server sends events (the app talks to the server only); no personal data — no names,
// usernames, phones, message texts or amounts; a person is a pseudonymous id (a hash of the internal user
// id), never the Telegram id. Without POSTHOG_API_KEY / AMPLITUDE_API_KEY nothing is sent there. A failure
// of either service never breaks anything: capture() never throws and never waits.
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

// ---------------- Amplitude (HTTP API v2, no extra library) ----------------
// Events wait in memory and go out in batches: every 10 s, at 20 events, and on shutdown.

const AMPLITUDE_URLS = {
  eu: 'https://api.eu.amplitude.com/2/httpapi',
  us: 'https://api2.amplitude.com/2/httpapi'
};
const AMPLITUDE_BATCH = 20;
const AMPLITUDE_INTERVAL_MS = 10000;
const AMPLITUDE_MAX_WAITING = 1000; // Amplitude unreachable for long: the oldest events are dropped
let amplitudeQueue = [];
let amplitudeTimer = null;
let amplitudeSending = null;
let amplitudeTestSender = null; // tests put a fake here

function isAmplitudeConfigured() {
  return Boolean(config.amplitudeApiKey);
}

function amplitudeUrl() {
  return AMPLITUDE_URLS[config.amplitudeRegion] || AMPLITUDE_URLS.eu;
}

async function sendToAmplitude(events) {
  if (amplitudeTestSender) return amplitudeTestSender(events);
  const res = await fetch(amplitudeUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: config.amplitudeApiKey, events }),
    signal: AbortSignal.timeout(10000)
  });
  // 4xx: a wrong key or region — retrying will not help; 5xx / 429: Amplitude is busy, try again later
  if (!res.ok) {
    const err = new Error(`Amplitude ${res.status}`);
    err.retry = res.status === 429 || res.status >= 500;
    throw err;
  }
}

function scheduleAmplitude() {
  if (amplitudeTimer) return;
  amplitudeTimer = setTimeout(() => { amplitudeTimer = null; flushAmplitude(); }, AMPLITUDE_INTERVAL_MS);
  if (amplitudeTimer.unref) amplitudeTimer.unref(); // never keeps the process alive by itself
}

// Sends one batch; resolves to 'failed' when it did not go out (the rest keeps waiting)
function flushAmplitude() {
  if (amplitudeSending) return amplitudeSending;
  if (!amplitudeQueue.length) return Promise.resolve();
  const batch = amplitudeQueue.splice(0, AMPLITUDE_BATCH);
  amplitudeSending = sendToAmplitude(batch).then(
    () => {
      amplitudeSending = null;
      // More is waiting: send the next batch right away
      if (amplitudeQueue.length) return flushAmplitude();
    },
    (err) => {
      amplitudeSending = null;
      const hint = err.retry ? '' : ' — check AMPLITUDE_API_KEY and AMPLITUDE_REGION in Railway';
      console.warn(`[SmartFlow Analytics] Amplitude not sent: ${err.message}${hint}`);
      if (err.retry) {
        amplitudeQueue = batch.concat(amplitudeQueue).slice(-AMPLITUDE_MAX_WAITING);
        scheduleAmplitude(); // try again in 10 s
      }
      return 'failed';
    }
  );
  return amplitudeSending;
}

function queueForAmplitude(event) {
  amplitudeQueue.push(event);
  if (amplitudeQueue.length > AMPLITUDE_MAX_WAITING) amplitudeQueue = amplitudeQueue.slice(-AMPLITUDE_MAX_WAITING);
  if (amplitudeQueue.length >= AMPLITUDE_BATCH) {
    flushAmplitude();
  } else {
    scheduleAmplitude();
  }
}

function amplitudeOn() {
  if (amplitudeTestSender) return true;
  return isAmplitudeConfigured() && config.nodeEnv !== 'test';
}

/**
 * The same person always gets the same id, which cannot be turned back into their account.
 */
function personId(userId) {
  if (!userId) return 'anonymous';
  return `p_${crypto.createHash('sha256').update(`smartflow:${userId}`).digest('hex').slice(0, 20)}`;
}

// app_env (production / staging) is on every event: numbers of the test copy are filtered out in PostHog
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
  let properties;
  try {
    properties = { ...safeProps(props), app_env: config.appEnv };
  } catch (err) {
    console.warn('[SmartFlow Analytics] not sent:', err.message);
    return;
  }
  const distinctId = personId(userId);
  try {
    const c = getClient();
    if (c) c.capture({ distinctId, event, properties: { ...properties, $process_person_profile: false } });
  } catch (err) {
    console.warn('[SmartFlow Analytics] PostHog not sent:', err.message);
  }
  try {
    if (amplitudeOn()) {
      queueForAmplitude({
        // Amplitude needs 5+ characters; a person without an account counts as one device
        ...(userId ? { user_id: distinctId } : { device_id: 'smartflow-anonymous' }),
        event_type: event,
        event_properties: properties,
        time: Date.now(),
        insert_id: crypto.randomUUID(), // a batch sent twice is counted once
        platform: 'SmartFlow server'
      });
    }
  } catch (err) {
    console.warn('[SmartFlow Analytics] Amplitude not sent:', err.message);
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
    source: type === 'booked' || type === 'buy_clicked' ? ((data && data.source) || 'chat') : undefined,
    step_id: type === 'step_reached' && data ? data.stepId : undefined,
    then: type === 'scenario' && data ? data.then : undefined
  });
}

/**
 * Sends what is waiting (on shutdown, so a redeploy loses nothing).
 */
async function flush() {
  if (amplitudeTimer) { clearTimeout(amplitudeTimer); amplitudeTimer = null; }
  await Promise.all([
    (async () => {
      try {
        if (client) await client.shutdown(3000);
      } catch (err) {
        console.warn('[SmartFlow Analytics] PostHog flush failed:', err.message);
      }
    })(),
    (async () => {
      // Everything that waits, batch after batch, but never longer than 5 s (Railway is stopping us)
      const deadline = Date.now() + 5000;
      while (amplitudeQueue.length && Date.now() < deadline) {
        if (await flushAmplitude() === 'failed') break;
      }
    })()
  ]);
}

module.exports = {
  isConfigured,
  isAmplitudeConfigured,
  personId,
  capture,
  funnelEvent,
  flush,
  _setClientForTests(fake) { testClient = fake; },
  _setAmplitudeSenderForTests(fake) { amplitudeTestSender = fake; amplitudeQueue = []; }
};
