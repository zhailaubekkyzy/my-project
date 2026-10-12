// server/services/followup-service.js - "Клиент замолчал" scenarios, run by the alarm clock.
//
// A client is silent when the last message in the dialog is from the SI or a person, the client
// wrote at least once before, and nothing happened for N hours (the scenario's hours). Each scenario
// fires once per silence: it waits for the client to write again before it can fire again, so the
// SI never sends reminder after reminder. Clients who bought or refused are left alone; the SI does
// not write while a person of the business answers the client. Old dialogs (silent for N + 3 days)
// are not woken up when an expert adds a new scenario.
const db = require('../db');
const siEngine = require('./si-engine');
const telegramBot = require('./telegram-bot');
const businessService = require('./business-service');
const funnelService = require('./funnel-service');
const chatService = require('./chat-service');
const { sqlTime } = require('./scheduler-service');

const LATE_WINDOW_HOURS = 72;
const MAX_ACTIONS_PER_RUN = 50;

function parseJson(str, fallback = {}) {
  if (!str) return fallback;
  if (typeof str === 'object') return str;
  try { return JSON.parse(str); } catch (e) { return fallback; }
}

const hoursBefore = (now, hours) => sqlTime(new Date(now.getTime() - hours * 3600 * 1000));

async function isSilent(client, scenario) {
  const last = await db.get(
    'SELECT author_type, sender FROM conversations WHERE client_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
    [client.id]
  );
  if (!last || (last.author_type || last.sender) === 'client') return false;
  const lastClient = await db.get(
    `SELECT created_at FROM client_events WHERE client_id = ? AND type = 'client_message' ORDER BY created_at DESC LIMIT 1`,
    [client.id]
  );
  if (!lastClient) return false; // the person only opened the chat and never wrote
  // Already fired since the client's last message?
  const fired = await db.all(
    `SELECT data FROM client_events WHERE client_id = ? AND type = 'scenario' AND created_at >= ?`,
    [client.id, lastClient.created_at]
  );
  return !fired.some(r => parseJson(r.data).scenarioId === scenario.id);
}

async function act(project, client, scenario) {
  await funnelService.recordEvent(client, 'scenario', { type: 'system' }, { scenarioId: scenario.id, then: scenario.then, silentHours: scenario.hours });
  if (scenario.then === 'si_says') {
    const result = await siEngine.generateFollowUp({
      project,
      expertName: await chatService.expertNameOf(project),
      history: await chatService.history(project.id, client.id),
      instruction: scenario.text,
      hours: scenario.hours
    });
    await chatService.saveMessage(client, { type: 'si' }, result.text);
    if (String(client.external_client_id || '').startsWith('usr_')) {
      await telegramBot.notifyUser(client.external_client_id, `💬 «${project.name}» написал(а) вам в SmartFlow.`, {
        buttonText: 'Открыть чат', startParam: project.slug
      });
    }
  } else if (scenario.then === 'handover') {
    await chatService.createHumanRequest(project, client, {
      reason: `Сценарий: клиент молчит ${scenario.hours} ч${scenario.text ? `. ${scenario.text}` : ''}`
    });
  } else if (scenario.then === 'notify') {
    const people = client.business_id ? await businessService.activeMemberIds(client.business_id) : [];
    if (!people.includes(project.owner_id)) people.unshift(project.owner_id);
    for (const userId of people) {
      await telegramBot.notifyUser(
        userId,
        `⏰ ${client.name || 'Клиент'} молчит ${scenario.hours} ч.\nSI-продавец: «${project.name}».${scenario.text ? `\n\n${scenario.text}` : ''}`,
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
    const scenarios = funnelService.normalizeScenarios(parseJson(project.custom_ai_settings).scenarios)
      .filter(s => s.when === 'silent');
    for (const scenario of scenarios) {
      const clients = await db.all(
        `SELECT * FROM clients
         WHERE project_id = ? AND funnel_status NOT IN ('bought', 'refused')
           AND last_activity <= ? AND last_activity >= ?
         ORDER BY last_activity ASC LIMIT ?`,
        [project.id, hoursBefore(now, scenario.hours), hoursBefore(now, scenario.hours + LATE_WINDOW_HOURS), MAX_ACTIONS_PER_RUN]
      );
      for (const client of clients) {
        if (fired >= MAX_ACTIONS_PER_RUN) return { checked, fired, more: true };
        checked++;
        // The SI does not write while a person of the business is talking to the client
        if (scenario.then === 'si_says' && chatService.isSiPaused(client)) continue;
        if (!(await isSilent(client, scenario))) continue;
        try {
          await act(project, client, scenario);
          fired++;
        } catch (err) {
          console.warn(`[SmartFlow Followup] ${client.id}: ${err.message}`);
        }
      }
    }
  }
  return { checked, fired };
}

module.exports = { runSilentScenarios, LATE_WINDOW_HOURS };
