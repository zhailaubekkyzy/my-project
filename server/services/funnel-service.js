// server/services/funnel-service.js - Event journal, funnel status of a client and "if…, then…" scenarios.
//
// Every action is one row in client_events. The funnel status of a client follows from events:
//  - the funnel of an SI-seller has a goal-offer (projects.offer);
//  - no answer to the offer yet → "Не дошли до конца воронки" (not_finished): the path still goes on;
//  - the client answered the offer or objected, but has not bought → "Есть возражения" (objections);
//  - the client asked for a person and nobody answered yet → "Ждут человека" (waiting_human);
//  - outcomes: "Купили" (bought, marked by the expert or the assistant) and "Отказ" (refused).
// Scenarios live in the SI-seller's methodology (custom_ai_settings.scenarios): "если клиент
// возразил «дорого» → SI отвечает так: …", "→ передать человеку", "→ сообщить мне в SmartFlow".
// "SI отвечает так" goes into the SI prompt; the other actions run on events (chat-service.js).
// Steps of the funnel (custom_ai_settings.steps) are the client's path the expert builds:
// знакомство → материал → вопросы → встреча или оффер → оплата. Every client is on one step
// (clients.step_id, empty = the first one); the SI leads them to the next step and moves them
// forward when the step's "пройден, когда…" is met. Scenarios may belong to a step.
const crypto = require('crypto');
const db = require('../db');

const STATUSES = {
  not_finished: 'Не дошли до конца воронки',
  objections: 'Есть возражения',
  waiting_human: 'Ждут человека',
  bought: 'Купили',
  refused: 'Отказ'
};

// Event types
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
  booked: 'Записался',
  meeting_moved: 'Перенёс встречу',
  meeting_cancelled: 'Встреча отменена',
  receipt_sent: 'Прислал чек',
  receipt_rejected: 'Чек не подтверждён',
  paid: 'Оплатил',
  refused: 'Отказ / ушёл',
  reopened: 'Вернули в воронку',
  contact_shared: 'Поделился контактом',
  condition: 'Условие эксперта',
  scenario: 'Сработал сценарий',
  step_reached: 'Перешёл на шаг'
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
  custom: 'Своё условие',
  step_reached: 'Клиент перешёл на шаг'
};
// "Клиент замолчал на N минут" — a follow-up on one branch of the funnel (the funnel is a tree):
// after what the client went silent — also "after the branch «…»" (after: the id of another
// scenario), so branches link into a tree. Checked by the server alarm clock (followup-service.js).
const SILENT_AFTER = {
  any: 'в любой момент разговора',
  text: 'после того, что я опишу словами',
  offer: 'после оффера',
  objection: 'после возражения',
  buy_clicked: 'после «Купить», но без чека'
};
const SILENT_MINUTES = { min: 5, max: 30 * 24 * 60, default: 60 };
const SCENARIO_THEN = {
  si_says: 'SI отвечает так',
  send_text: 'Отправить клиенту мой текст или ссылку',
  handover: 'Передать человеку (SI на паузу)',
  notify: 'Сообщить мне в SmartFlow'
};
const MAX_SCENARIOS = 20;

// ---------- Steps of the funnel (the client's path, built by the expert) ----------
// No step exists by default. A step: what the SI does on it, when it is done (in words), and an
// optional material (a text or a link) the client gets when they come to the step.
const MAX_STEPS = 8;
const STEP_ID = /^stp_[a-z0-9]{4,20}$/;
const SCENARIO_ID = /^scn_[a-z0-9]{4,20}$/;

/**
 * Steps as the expert typed them → a safe list (a step needs a title).
 */
function normalizeSteps(list) {
  if (!Array.isArray(list)) return [];
  const result = [];
  for (const raw of list) {
    if (result.length >= MAX_STEPS) break;
    if (!raw || !clean(raw.title, 60)) continue;
    let id = STEP_ID.test(raw.id) ? raw.id : `stp_${crypto.randomBytes(5).toString('hex')}`;
    if (result.some(s => s.id === id)) id = `stp_${crypto.randomBytes(5).toString('hex')}`;
    result.push({
      id,
      title: clean(raw.title, 60),
      goal: clean(raw.goal, 300),
      doneWhen: clean(raw.doneWhen, 200),
      material: clean(raw.material, 500)
    });
  }
  return result;
}

/**
 * Where the client is: the index of their step (an empty or deleted step = the first one).
 */
function stepIndexOf(steps, stepId) {
  const i = steps.findIndex(s => s.id === stepId);
  return i < 0 ? 0 : i;
}

function currentStep(steps, client) {
  return steps.length ? steps[stepIndexOf(steps, client && client.step_id)] : null;
}

/**
 * The steps for the SI prompt: the whole path, and what to do on the client's step now.
 */
function stepPromptLines(list, clientStepId) {
  const steps = normalizeSteps(list);
  if (!steps.length) return [];
  const index = stepIndexOf(steps, clientStepId);
  const step = steps[index];
  const next = steps[index + 1];
  const lines = [
    'Шаги воронки эксперта — путь клиента к покупке. Клиенту шаги не называй; веди мягко, по одному шагу:',
    ...steps.map((s, i) => `${i + 1}. ${s.title}${s.goal ? ` — ${s.goal}` : ''}`),
    `Сейчас клиент на шаге ${index + 1} «${step.title}».${step.goal ? ` Что сделать на этом шаге: ${step.goal}.` : ''}`
  ];
  if (step.doneWhen) lines.push(`Шаг пройден, когда ${step.doneWhen}.`);
  if (step.material) lines.push(`Материал этого шага клиент уже получил отдельным сообщением: «${step.material}». Можно сослаться на него, не повторяя целиком.`);
  lines.push(next
    ? `Когда этот шаг пройден — мягко переходи к шагу ${index + 2} «${next.title}». Не перескакивай без причины, но если клиент сам готов купить раньше — не мешай.`
    : 'Это последний шаг: помоги клиенту спокойно завершить его, без давления.');
  return lines;
}

/**
 * The steps for the turn analysis: the client's step and the ones after it, with "пройден, когда".
 */
function stepsForAnalysis(list, client) {
  const steps = normalizeSteps(list);
  if (steps.length < 2) return null;
  return { steps, index: stepIndexOf(steps, client && client.step_id) };
}

const newEventId = () => `evt_${Date.now().toString(36)}${crypto.randomBytes(5).toString('hex')}`;
const clean = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Scenarios as the expert typed them → a safe list. Unknown "if"/"then" are dropped;
 * "SI отвечает так" without text is dropped too.
 */
function normalizeScenarios(list, steps = null) {
  if (!Array.isArray(list)) return [];
  const stepIds = steps ? normalizeSteps(steps).map(s => s.id) : null;
  const result = [];
  for (const raw of list.slice(0, MAX_SCENARIOS)) {
    if (!raw || !SCENARIO_WHEN[raw.when] || !SCENARIO_THEN[raw.then]) continue;
    const scenario = {
      id: SCENARIO_ID.test(raw.id) ? raw.id : `scn_${crypto.randomBytes(5).toString('hex')}`,
      // A short name of the branch («Хочет рассрочку»), so other branches can refer to it
      title: clean(raw.title, 60),
      when: raw.when,
      words: raw.when === 'objection' ? clean(raw.words, 120) : '',
      condition: raw.when === 'custom' ? clean(raw.condition, 200) : '',
      then: raw.then,
      text: clean(raw.text, 500)
    };
    // The step of the funnel: "Клиент перешёл на шаг …" needs it; other scenarios may work only on it
    if (STEP_ID.test(raw.step)) scenario.step = raw.step;
    if (scenario.when === 'step_reached' && !scenario.step) continue;
    // A step that no longer exists: the scenario is dropped (it must never fire on another step)
    if (scenario.step && stepIds && !stepIds.includes(scenario.step)) continue;
    if (raw.when === 'silent') {
      const minutes = parseInt(raw.minutes, 10) || SILENT_MINUTES.default;
      scenario.minutes = Math.max(SILENT_MINUTES.min, Math.min(SILENT_MINUTES.max, minutes));
      scenario.after = SILENT_AFTER[raw.after] || SCENARIO_ID.test(raw.after) ? raw.after : 'any';
      // "После того, как …" in the expert's own words
      scenario.afterText = scenario.after === 'text' ? clean(raw.afterText, 200) : '';
      if (scenario.after === 'text' && !scenario.afterText) scenario.after = 'any';
      if (!scenario.afterText) delete scenario.afterText;
    }
    // "SI отвечает так" needs the words — except after silence: then the hint is optional
    if (scenario.then === 'si_says' && !scenario.text && scenario.when !== 'silent') continue;
    // The material itself is the text or link the expert typed
    if (scenario.then === 'send_text' && !scenario.text) continue;
    if (scenario.when === 'custom' && !scenario.condition) continue;
    result.push(scenario);
  }
  // "После ветки «…»" must point to a branch that exists (and not to itself); otherwise the
  // branch is dropped rather than turned into "any silence" — it must never fire unexpectedly
  return result.filter(s => s.when !== 'silent' || SILENT_AFTER[s.after]
    || (s.after !== s.id && result.some(o => o.id === s.after && o.when !== 'silent')));
}

/**
 * What a branch is called in messages to the expert: its title, or its condition.
 */
function scenarioName(scenario) {
  if (!scenario) return '';
  if (scenario.title) return scenario.title;
  if (scenario.when === 'custom') return scenario.condition;
  return SCENARIO_WHEN[scenario.when] || '';
}

const wordsOf = (scenario) => scenario.words.split(/[,;]/).map(w => w.trim().toLowerCase()).filter(Boolean);

/**
 * Does the scenario fire on this event? For objections with words: one of the words is in the
 * objection or in the client's message ("дорого, нет денег").
 */
function scenarioMatches(scenario, type, data = {}) {
  if (type === 'condition') return scenario.when === 'custom' && (data.matched || []).includes(scenario.id);
  if (type === 'step_reached') return scenario.when === 'step_reached' && scenario.step === data.stepId;
  if (scenario.when !== type) return false;
  if (type !== 'objection') return true;
  const words = wordsOf(scenario);
  if (!words.length) return true;
  const haystack = `${data.objection || ''} ${data.text || ''}`.toLowerCase();
  return words.some(w => haystack.includes(w));
}

/**
 * A scenario "только на шаге …" works only while the client is on that step.
 * ("Клиент перешёл на шаг" is checked by its event, not here.)
 */
function scenarioOnStep(scenario, steps, clientStepId) {
  if (!scenario.step || scenario.when === 'step_reached') return true;
  const list = normalizeSteps(steps);
  if (!list.length) return false;
  return list[stepIndexOf(list, clientStepId)].id === scenario.step;
}

/**
 * The expert's own conditions for the turn analysis: [{ id, text }].
 * With steps and the client's step: only the conditions that work on this step.
 */
function customConditions(scenarios, steps = null, clientStepId = null) {
  return normalizeScenarios(scenarios)
    .filter(s => s.when === 'custom' && (!steps || scenarioOnStep(s, steps, clientStepId)))
    .map(s => ({ id: s.id, text: s.condition }));
}

/**
 * "SI отвечает так" scenarios as lines for the SI prompt (only those of the client's step).
 */
function scenarioPromptLines(scenarios, steps = [], clientStepId = null) {
  // After silence the SI writes the follow-up itself later: not a rule for the conversation
  return normalizeScenarios(scenarios)
    .filter(s => s.then === 'si_says' && s.when !== 'silent' && s.when !== 'step_reached' && scenarioOnStep(s, steps, clientStepId))
    .map(s => {
      const words = wordsOf(s);
      let when = `Если ${SCENARIO_WHEN[s.when].charAt(0).toLowerCase()}${SCENARIO_WHEN[s.when].slice(1)}`;
      if (s.when === 'objection' && words.length) when = `Если клиент возражает (${words.map(w => `«${w}»`).join(', ')})`;
      if (s.when === 'custom') when = `Если ${s.condition}`;
      return `- ${when}: ${s.text}`;
    });
}

function minutesLabel(minutes) {
  const m = Number(minutes) || 0;
  if (m >= 1440 && m % 1440 === 0) return `${m / 1440} дн.`;
  if (m >= 60 && m % 60 === 0) return `${m / 60} ч`;
  return `${m} мин`;
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
  if (type === 'step_reached' && data && data.stepId) {
    sets.push('step_id = ?', 'step_at = CURRENT_TIMESTAMP');
    params.push(data.stepId);
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
    if (type === 'step_reached' && data && data.stepId) {
      client.step_id = data.stepId;
      client.step_at = now;
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
    if (r.type === 'scenario') detail = SCENARIO_THEN[data.then] || '';
    if (r.type === 'scenario' && data.minutes) detail += ` · молчит ${minutesLabel(data.minutes)}`;
    if (r.type === 'condition') detail = data.condition || '';
    if (r.type === 'step_reached') detail = data.title ? `«${data.title}»` : '';
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

// ---------- Funnel screen "По шагам": how many reached each step and where they stop ----------
/**
 * One SI-seller: per step — reached (now on it or further), here now (still in the funnel),
 * refused on it; bought in total; the step where most clients stop.
 */
async function stepsReport(project, { days } = {}) {
  const steps = normalizeSteps(parseSettings(project).steps);
  const where = ['project_id = ?'];
  const params = [project.id];
  const cutoff = cutoffOf(days);
  if (cutoff) {
    where.push('last_activity >= ?');
    params.push(cutoff);
  }
  const rows = await db.all(
    `SELECT step_id, funnel_status, COUNT(*) AS count FROM clients WHERE ${where.join(' AND ')} GROUP BY step_id, funnel_status`,
    params
  );
  const report = steps.map(s => ({ id: s.id, title: s.title, reached: 0, here: 0, refused: 0, bought: 0 }));
  let bought = 0;
  let total = 0;
  for (const r of rows) {
    const count = Number(r.count) || 0;
    total += count;
    if (r.funnel_status === 'bought') bought += count;
    if (!report.length) continue;
    const index = stepIndexOf(steps, r.step_id);
    for (let i = 0; i <= index; i++) report[i].reached += count;
    if (r.funnel_status === 'refused') report[index].refused += count;
    else if (r.funnel_status === 'bought') report[index].bought += count;
    else report[index].here += count;
  }
  // Where clients stop: the most of those who stayed on the step (here now + refused on it)
  let stopStepId = null;
  let most = 0;
  for (const s of report) {
    if (s.here + s.refused > most) {
      most = s.here + s.refused;
      stopStepId = s.id;
    }
  }
  return { steps: report, bought, total, stopStepId };
}

/**
 * Clients of one SI-seller on one step (still in the funnel), newest activity first, 30 at a time.
 */
async function clientsOnStep(project, stepId, { offset = 0, days } = {}) {
  const steps = normalizeSteps(parseSettings(project).steps);
  const index = steps.findIndex(s => s.id === stepId);
  if (index < 0) return [];
  const where = [`c.project_id = ?`, `c.funnel_status NOT IN ('bought', 'refused')`];
  const params = [project.id];
  if (index === 0) {
    // The first step: also clients without a step or with a step that was deleted
    const others = steps.slice(1).map(s => s.id);
    where.push(others.length ? `(c.step_id IS NULL OR c.step_id NOT IN (${others.map(() => '?').join(', ')}))` : '1 = 1');
    params.push(...others);
  } else {
    where.push('c.step_id = ?');
    params.push(stepId);
  }
  const cutoff = cutoffOf(days);
  if (cutoff) {
    where.push('c.last_activity >= ?');
    params.push(cutoff);
  }
  return db.all(
    `SELECT c.id, c.project_id, c.name, c.username, c.avatar_url, c.funnel_status, c.responsible_type,
            c.last_message, c.last_activity, c.last_objection, c.step_at, p.name AS project_name
     FROM clients c JOIN projects p ON p.id = c.project_id
     WHERE ${where.join(' AND ')}
     ORDER BY c.last_activity DESC, c.id DESC LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE, Math.max(0, parseInt(offset, 10) || 0)]
  );
}

function parseSettings(project) {
  const raw = project && project.custom_ai_settings;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
}

module.exports = {
  MAX_STEPS,
  normalizeSteps,
  stepIndexOf,
  currentStep,
  stepPromptLines,
  stepsForAnalysis,
  scenarioOnStep,
  stepsReport,
  clientsOnStep,
  STATUSES,
  EVENTS,
  SCENARIO_WHEN,
  SCENARIO_THEN,
  MAX_SCENARIOS,
  SILENT_AFTER,
  scenarioName,
  SILENT_MINUTES,
  minutesLabel,
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
