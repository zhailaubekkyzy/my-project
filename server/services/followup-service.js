// server/services/followup-service.js - "Догоняющие сообщения", run by the alarm clock once a minute.
//
// The expert sets the chain per SI-seller (custom_ai_settings.followups, off by default): steps
// "через N минут молчания → написать клиенту / сообщить мне / передать человеку" and the rules
// (how many follow-ups one client gets at most, whether to write to people who never answered,
// whether the chain starts again after the client answers). See funnel-service.normalizeFollowups.
//
// Platform rules for every expert, so that chats never turn into spam:
//  - the client is silent only if the last message is from the SI or a person (not the client);
//  - never to clients who bought or refused;
//  - the SI does not write while a person of the business answers the client;
//  - steps go one at a time: step 2 waits its own pause after step 1, even if the chain was turned
//    on late; dialogs silent for longer than the last step + 3 days are not woken up;
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

function parseJson(str, fallback = {}) {
  if (!str) return fallback;
  if (typeof str === 'object') return str;
  try { return JSON.parse(str); } catch (e) { return fallback; }
}

const minutesBefore = (now, minutes) => sqlTime(new Date(now.getTime() - minutes * 60 * 1000));
// SQLite gives 'YYYY-MM-DD HH:MM:SS' (UTC), PostgreSQL a Date
const toDate = (value) => (value instanceof Date ? value : new Date(String(value).replace(' ', 'T') + (/[Z+]/.test(String(value)) ? '' : 'Z')));

/**
 * Which step (if any) is due for this client now. Returns the step or null.
 */
async function dueStep(client, cfg, now) {
  const last = await db.get(
    'SELECT author_type, sender FROM conversations WHERE client_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
    [client.id]
  );
  if (!last || (last.author_type || last.sender) === 'client') return null; // the client waits for an answer

  // The silence is counted from the client's last message (or the first message, if allowed for
  // people who never answered)
  const lastClient = await db.get(
    `SELECT created_at FROM client_events WHERE client_id = ? AND type = 'client_message' ORDER BY created_at DESC LIMIT 1`,
    [client.id]
  );
  let since = lastClient && lastClient.created_at;
  if (!since) {
    if (!cfg.includeNeverReplied) return null;
    const first = await db.get('SELECT created_at FROM conversations WHERE client_id = ? ORDER BY created_at ASC, id ASC LIMIT 1', [client.id]);
    if (!first) return null;
    since = first.created_at;
  }
  const sinceDate = toDate(since);

  const done = (await db.all(
    `SELECT data, created_at FROM client_events WHERE client_id = ? AND type = 'followup' ORDER BY created_at ASC`,
    [client.id]
  )).map(r => ({ ...parseJson(r.data), at: toDate(r.created_at) }));
  // The chain ran before the client's last answer: start again only if the expert allowed it
  const before = done.filter(d => d.at < sinceDate);
  if (before.length && !cfg.restartOnReply) return null;
  const current = done.filter(d => d.at >= sinceDate);

  const step = cfg.steps[current.length];
  if (!step) return null;
  const silentMinutes = (now - sinceDate) / 60000;
  if (silentMinutes < step.minutes) return null;
  // One step at a time: the pause between two steps is kept even if the chain was turned on late
  if (current.length) {
    const previous = cfg.steps[current.length - 1];
    const lastAt = current[current.length - 1].at;
    if ((now - lastAt) / 60000 < step.minutes - previous.minutes) return null;
  }
  if (step.action === 'message') {
    if (chatService.isSiPaused(client)) return null;
    const sent = done.filter(d => d.action === 'message').length;
    if (sent >= cfg.maxPerClient) return null;
  }
  return step;
}

async function act(project, client, step) {
  // Written first: if the action fails, it is not repeated every minute
  await funnelService.recordEvent(client, 'followup', { type: 'system' }, { stepId: step.id, action: step.action, minutes: step.minutes });
  if (step.action === 'message') {
    const text = step.mode === 'exact'
      ? step.text
      : (await siEngine.generateFollowUp({
        project,
        expertName: await chatService.expertNameOf(project),
        history: await chatService.history(project.id, client.id),
        instruction: step.text
      })).text;
    await chatService.saveMessage(client, { type: 'si' }, text);
    if (String(client.external_client_id || '').startsWith('usr_')) {
      await telegramBot.notifyUser(client.external_client_id, `💬 «${project.name}» написал(а) вам в SmartFlow.`, {
        buttonText: 'Открыть чат', startParam: project.slug
      });
    }
  } else if (step.action === 'handover') {
    if (!chatService.isSiPaused(client)) {
      await chatService.createHumanRequest(project, client, {
        reason: `Клиент молчит ${funnelService.minutesLabel(step.minutes)}${step.text ? `. ${step.text}` : ''}`
      });
    }
  } else if (step.action === 'notify') {
    const people = client.business_id ? await businessService.activeMemberIds(client.business_id) : [];
    if (!people.includes(project.owner_id)) people.unshift(project.owner_id);
    for (const userId of people) {
      await telegramBot.notifyUser(
        userId,
        `⏰ ${client.name || 'Клиент'} молчит ${funnelService.minutesLabel(step.minutes)}.\nSI-продавец: «${project.name}».${step.text ? `\n\n${step.text}` : ''}`,
        { buttonText: 'Открыть', startParam: `I_${project.id}` }
      );
    }
  }
}

/**
 * One run of the job. Returns { checked, sent } for the support panel.
 */
async function runFollowups(now = new Date()) {
  const projects = await db.all(
    `SELECT * FROM projects WHERE status = 'active' AND is_demo = 0 AND custom_ai_settings LIKE ?`,
    ['%"followups"%']
  );
  let checked = 0;
  let sent = 0;
  for (const project of projects) {
    const cfg = funnelService.normalizeFollowups(parseJson(project.custom_ai_settings).followups);
    if (!cfg.enabled || !cfg.steps.length) continue;
    const lastStep = cfg.steps[cfg.steps.length - 1].minutes;
    const clients = await db.all(
      `SELECT * FROM clients
       WHERE project_id = ? AND funnel_status NOT IN ('bought', 'refused')
         AND last_activity <= ? AND last_activity >= ?
       ORDER BY last_activity ASC LIMIT ?`,
      [project.id, minutesBefore(now, smallestPause(cfg)), minutesBefore(now, lastStep + LATE_WINDOW_MINUTES), MAX_ACTIONS_PER_RUN * 4]
    );
    for (const client of clients) {
      if (sent >= MAX_ACTIONS_PER_RUN) return { checked, sent, more: true };
      checked++;
      const step = await dueStep(client, cfg, now);
      if (!step) continue;
      try {
        await act(project, client, step);
        sent++;
      } catch (err) {
        console.warn(`[SmartFlow Followup] ${client.id}: ${err.message}`);
      }
    }
  }
  return { checked, sent };
}

// After a follow-up, last_activity moves to that moment; the next step comes after the pause
// between the steps, which can be shorter than the first step
function smallestPause(cfg) {
  let gap = cfg.steps[0].minutes;
  for (let i = 1; i < cfg.steps.length; i++) gap = Math.min(gap, cfg.steps[i].minutes - cfg.steps[i - 1].minutes);
  return Math.max(1, gap);
}

module.exports = { runFollowups, dueStep, LATE_WINDOW_MINUTES };
