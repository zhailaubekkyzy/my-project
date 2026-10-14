// server/services/followup-service.js - "Клиент замолчал" scenarios, run by the alarm clock once a minute.
//
// The funnel is a tree: a follow-up belongs to the branch where the client went silent. The expert
// writes it in the methodology as an "if…, then…" scenario: "Если клиент замолчал на N минут
// (в любой момент / после оффера / после возражения / после «Купить», но без чека / после другого сценария)
// → SI пишет своими словами / отправить мой текст или ссылку / передать человеку / сообщить мне".
// No scenario exists by default.
//
// Platform rules for every expert, so that chats never turn into spam:
//  - the client is silent only if the last message is from the SI or a person (not the client),
//    and the client wrote at least once (people who only opened the chat are left alone);
//  - never to clients who bought or refused; the SI is quiet while a person answers the client;
//  - each scenario fires once per silence (until the client writes again), one action per client
//    per minute; at most 3 SI follow-ups per silence, with the pause between their minutes kept;
//  - dialogs silent for longer than the longest scenario + 3 days are not woken up;
//  - at most 50 actions per minute for the whole platform.
const db = require('../db');
const siEngine = require('./si-engine');
const telegramBot = require('./telegram-bot');
const businessService = require('./business-service');
const funnelService = require('./funnel-service');
const chatService = require('./chat-service');
const { sqlTime } = require('./scheduler-service');

const LATE_WINDOW_MINUTES = 3 * 24 * 60;
const MAX_ACTIONS_PER_RUN = 50;
const MAX_SI_PER_SILENCE = 3;

function parseJson(str, fallback = {}) {
  if (!str) return fallback;
  if (typeof str === 'object') return str;
  try { return JSON.parse(str); } catch (e) { return fallback; }
}

const minutesBefore = (now, minutes) => sqlTime(new Date(now.getTime() - minutes * 60 * 1000));
// SQLite gives 'YYYY-MM-DD HH:MM:SS' (UTC), PostgreSQL a Date
const toDate = (value) => (value instanceof Date ? value : new Date(String(value).replace(' ', 'T') + (/[Z+]/.test(String(value)) ? '' : 'Z')));

// "Is the last SI message the offer?" — asked once per message (remembered while the server runs;
// a positive answer is also written to the journal as offer_sent)
const offerChecked = new Map();

async function lastMessageIsOffer(project, client, lastMessage) {
  if (offerChecked.has(lastMessage.id)) return offerChecked.get(lastMessage.id);
  const saved = await db.all(`SELECT data FROM client_events WHERE client_id = ? AND type = 'offer_sent'`, [client.id]);
  if (saved.some(r => parseJson(r.data).messageId === lastMessage.id)) {
    offerChecked.set(lastMessage.id, true);
    return true;
  }
  const offer = await siEngine.isOffer({ project, text: lastMessage.text });
  if (offerChecked.size > 5000) offerChecked.clear();
  offerChecked.set(lastMessage.id, offer);
  if (offer) await funnelService.recordEvent(client, 'offer_sent', { type: 'si' }, { messageId: lastMessage.id });
  return offer;
}

// "После того, как …" in the expert's words: checked once per (scenario, last message)
const contextChecked = new Map();
async function describedContext(project, client, scenario, lastMessage) {
  const key = `${scenario.id}:${lastMessage.id}`;
  if (contextChecked.has(key)) return contextChecked.get(key);
  const messages = (await chatService.history(project.id, client.id)).slice(-6);
  const match = await siEngine.contextMatches({ project, messages, description: scenario.afterText });
  if (contextChecked.size > 5000) contextChecked.clear();
  contextChecked.set(key, match);
  return match;
}

// After what the client went silent: the branch of the scenario
async function onBranch(project, client, scenario, lastMessage, since) {
  if (scenario.after === 'objection') {
    return Boolean(await db.get(`SELECT id FROM client_events WHERE client_id = ? AND type = 'objection' AND created_at >= ? LIMIT 1`, [client.id, since]));
  }
  if (scenario.after === 'buy_clicked') {
    const click = await db.get(
      `SELECT created_at FROM client_events WHERE client_id = ? AND type = 'buy_clicked' AND created_at >= ? ORDER BY created_at DESC LIMIT 1`,
      [client.id, since]
    );
    if (!click) return false;
    return !(await db.get(`SELECT id FROM client_events WHERE client_id = ? AND type = 'receipt_sent' AND created_at >= ? LIMIT 1`, [client.id, click.created_at]));
  }
  if (scenario.after === 'offer') return lastMessageIsOffer(project, client, lastMessage);
  if (scenario.after === 'text') return describedContext(project, client, scenario, lastMessage);
  if (/^scn_/.test(scenario.after)) {
    // After another branch: it fired since the client's last message
    const rows = await db.all(`SELECT data FROM client_events WHERE client_id = ? AND type = 'scenario' AND created_at >= ?`, [client.id, since]);
    return rows.some(r => parseJson(r.data).scenarioId === scenario.after);
  }
  return true;
}

// SI messages to the client: "SI пишет сам" and "мой текст или ссылка"
const writesToClient = (then) => then === 'si_says' || then === 'send_text';

/**
 * The scenario to run for this client now (one per minute), or null.
 */
async function dueScenario(project, client, scenarios, now, steps = []) {
  const lastMessage = await db.get(
    'SELECT id, author_type, sender, text FROM conversations WHERE client_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
    [client.id]
  );
  if (!lastMessage || (lastMessage.author_type || lastMessage.sender) === 'client') return null; // the client waits for an answer
  const lastClient = await db.get(
    `SELECT created_at FROM client_events WHERE client_id = ? AND type = 'client_message' ORDER BY created_at DESC LIMIT 1`,
    [client.id]
  );
  if (!lastClient) return null; // only opened the chat, never wrote
  const since = lastClient.created_at;
  const silentMinutes = (now - toDate(since)) / 60000;

  const fired = (await db.all(
    `SELECT data, created_at FROM client_events WHERE client_id = ? AND type = 'scenario' AND created_at >= ? ORDER BY created_at ASC`,
    [client.id, since]
  )).map(r => ({ ...parseJson(r.data), at: toDate(r.created_at) }));
  const siFired = fired.filter(f => writesToClient(f.then) && f.minutes);

  for (const scenario of scenarios) {
    if (silentMinutes < scenario.minutes) break; // sorted by minutes
    if (fired.some(f => f.scenarioId === scenario.id)) continue;
    // "Только на шаге …": the client is silent on that step of the funnel
    if (!funnelService.scenarioOnStep(scenario, steps, client.step_id)) continue;
    if (writesToClient(scenario.then)) {
      if (chatService.isSiPaused(client) || siFired.length >= MAX_SI_PER_SILENCE) continue;
      const previous = siFired[siFired.length - 1];
      if (previous && (now - previous.at) / 60000 < scenario.minutes - previous.minutes) continue;
    }
    if (!(await onBranch(project, client, scenario, lastMessage, since))) continue;
    return scenario;
  }
  return null;
}

async function act(project, client, scenario, scenarios) {
  // Written first: if the action fails, it is not repeated every minute
  await funnelService.recordEvent(client, 'scenario', { type: 'system' }, { scenarioId: scenario.id, then: scenario.then, minutes: scenario.minutes });
  const branch = (scenario.after === 'text' && `после «${scenario.afterText}»`) || funnelService.SILENT_AFTER[scenario.after]
    || `после сценария «${funnelService.scenarioName(scenarios.find(s => s.id === scenario.after))}»`;
  const step = scenario.step && funnelService.normalizeSteps(parseJson(project.custom_ai_settings).steps).find(s => s.id === scenario.step);
  const silence = `молчит ${funnelService.minutesLabel(scenario.minutes)} ${branch}${step ? ` (шаг «${step.title}»)` : ''}`;
  if (writesToClient(scenario.then)) {
    const text = scenario.then === 'send_text'
      ? scenario.text
      : (await siEngine.generateFollowUp({
        project: { ...project, clientStepId: client.step_id },
        expertName: await chatService.expertNameOf(project),
        history: await chatService.history(project.id, client.id),
        instruction: scenario.text
      })).text;
    await chatService.saveMessage(client, { type: 'si' }, text);
    if (String(client.external_client_id || '').startsWith('usr_')) {
      await telegramBot.notifyUser(client.external_client_id, `💬 «${project.name}» написал(а) вам в SmartFlow.`, {
        buttonText: 'Открыть чат', startParam: project.slug
      });
    }
  } else if (scenario.then === 'handover') {
    if (!chatService.isSiPaused(client)) {
      await chatService.createHumanRequest(project, client, { reason: `Сценарий: клиент ${silence}${scenario.text ? `. ${scenario.text}` : ''}` });
    }
  } else if (scenario.then === 'notify') {
    const people = client.business_id ? await businessService.activeMemberIds(client.business_id) : [];
    if (!people.includes(project.owner_id)) people.unshift(project.owner_id);
    for (const userId of people) {
      await telegramBot.notifyUser(
        userId,
        `⏰ ${client.name || 'Клиент'} ${silence}.\nSI-продавец: «${project.name}».${scenario.text ? `\n\n${scenario.text}` : ''}`,
        { buttonText: 'Открыть', startParam: `I_${project.id}` }
      );
    }
  }
}

/**
 * One run of the job. Returns { checked, fired } for the support panel.
 */
async function runSilentScenarios(now = new Date()) {
  const projects = await db.all(
    `SELECT * FROM projects WHERE status = 'active' AND is_demo = 0 AND custom_ai_settings LIKE ?`,
    ['%"silent"%']
  );
  let checked = 0;
  let fired = 0;
  for (const project of projects) {
    const settings = parseJson(project.custom_ai_settings);
    const all = funnelService.normalizeScenarios(settings.scenarios);
    const scenarios = all.filter(s => s.when === 'silent').sort((a, b) => a.minutes - b.minutes);
    if (!scenarios.length) continue;
    // After a follow-up last_activity moves on; the next one may come after the pause between two scenarios
    let pause = scenarios[0].minutes;
    for (let i = 1; i < scenarios.length; i++) pause = Math.min(pause, Math.max(1, scenarios[i].minutes - scenarios[i - 1].minutes));
    const clients = await db.all(
      `SELECT * FROM clients
       WHERE project_id = ? AND funnel_status NOT IN ('bought', 'refused')
         AND last_activity <= ? AND last_activity >= ?
       ORDER BY last_activity ASC LIMIT ?`,
      [project.id, minutesBefore(now, pause), minutesBefore(now, scenarios[scenarios.length - 1].minutes + LATE_WINDOW_MINUTES), MAX_ACTIONS_PER_RUN * 4]
    );
    for (const client of clients) {
      if (fired >= MAX_ACTIONS_PER_RUN) return { checked, fired, more: true };
      checked++;
      try {
        const scenario = await dueScenario(project, client, scenarios, now, settings.steps);
        if (!scenario) continue;
        await act(project, client, scenario, all);
        fired++;
      } catch (err) {
        console.warn(`[SmartFlow Followup] ${client.id}: ${err.message}`);
      }
    }
  }
  return { checked, fired };
}

module.exports = { runSilentScenarios, LATE_WINDOW_MINUTES, MAX_SI_PER_SILENCE };
