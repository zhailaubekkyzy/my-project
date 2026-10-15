// server/services/chat-service.js - A client's conversation with an SI-consultant.
// A client is a row in `clients` per (consultant, person); messages are in `conversations`.
// Every message has an author and its type (si / client / owner / assistant); every dialog has a
// responsible: the SI or a person of the business. The SI answers only while it is responsible.
const crypto = require('crypto');
const db = require('../db');
const siEngine = require('./si-engine');
const brainService = require('./brain-service');
const telegramBot = require('./telegram-bot');
const businessService = require('./business-service');
const funnelService = require('./funnel-service');
const calendarService = require('./calendar-service');
const { mediaUrl } = require('./media-service');
const analytics = require('./analytics-service');

const DEFAULT_CLIENT_LIMIT = 40;
const LIMIT_TEXT = 'Я ответил на все вопросы, на которые могу. Чтобы продолжить, нажмите «Связаться с человеком» — эксперт ответит вам лично.';

const newId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

// Message ids grow with time, so "ORDER BY created_at, id" keeps the order even when the
// client's message and the SI reply are saved within the same second.
let messageCounter = 0;
function newMessageId() {
  messageCounter = (messageCounter + 1) % 1679616; // 36^4
  return `msg_${Date.now().toString(36).padStart(9, '0')}${messageCounter.toString(36).padStart(4, '0')}${crypto.randomBytes(3).toString('hex')}`;
}

function parseJson(str, fallback = {}) {
  if (!str) return fallback;
  if (typeof str === 'object') return str;
  try {
    return JSON.parse(str);
  } catch (e) {
    return fallback;
  }
}

function displayNameOf(user) {
  return (parseJson(user.profile).displayName || '').trim() || user.display_name;
}

/**
 * Find a lead of this project by internal id (cli_...) or external id; create it if missing.
 */
async function findOrCreateLead(project, { clientId, name, username, avatarUrl, lastMessage }) {
  if (clientId) {
    const existing = await db.get(
      'SELECT * FROM clients WHERE project_id = ? AND (id = ? OR external_client_id = ?)',
      [project.id, clientId, clientId]
    );
    if (existing) return existing;
  }

  // The SI-seller talks to clients: its owner's business exists from now on
  const businessId = await businessService.ensureProjectBusiness(project);
  const leadId = newId('cli');
  await db.run(
    `INSERT INTO clients (id, project_id, business_id, external_client_id, name, username, avatar_url, status, funnel_step, deal_value, tags, last_message, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'new', 'step-1', 0, '[]', ?, 0)`,
    [leadId, project.id, businessId, clientId || `anon_${Date.now()}`, name || 'Клиент Telegram', username || null, avatarUrl || null, lastMessage || null]
  );
  return db.get('SELECT * FROM clients WHERE id = ?', [leadId]);
}

// The signed-in person as a client of this consultant (external id = their SmartFlow user id)
async function leadForUser(project, userId, { create = true } = {}) {
  const existing = await db.get(
    'SELECT * FROM clients WHERE project_id = ? AND external_client_id = ?',
    [project.id, userId]
  );
  if (existing || !create) return existing;
  const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
  return findOrCreateLead(project, {
    clientId: userId,
    name: user ? displayNameOf(user) : 'Клиент Telegram',
    username: user ? user.username : null,
    avatarUrl: user ? (mediaUrl(user.photo_media_id) || user.avatar_url) : null
  });
}

async function activeProjectBySlug(slug) {
  return db.get('SELECT * FROM projects WHERE slug = ? AND status = ?', [slug, 'active']);
}

async function expertNameOf(project) {
  const owner = await db.get('SELECT display_name, profile FROM users WHERE id = ?', [project.owner_id]);
  return owner ? displayNameOf(owner) : '';
}

// Author type → the old `sender` column (the client app and the SI prompt still read it)
const SENDER_OF = { si: 'ai', client: 'client', owner: 'expert_human', assistant: 'expert_human' };
const LAST_MESSAGE_PREFIX = { si: '[SI]: ', owner: '[Эксперт]: ', assistant: '[Помощник]: ', client: '' };

function authorTypeOf(row) {
  if (row.author_type) return row.author_type;
  return row.sender === 'ai' ? 'si' : (row.sender === 'expert_human' ? 'owner' : 'client');
}

function toMessage(row) {
  return {
    id: row.id,
    sender: row.sender,
    authorType: authorTypeOf(row),
    authorUserId: row.author_user_id || null,
    text: row.text,
    isVoice: Boolean(row.is_voice),
    voiceId: row.voice_id || null,
    voiceSeconds: row.voice_seconds ? Number(row.voice_seconds) : null,
    isBroadcast: Boolean(row.is_broadcast),
    createdAt: row.created_at
  };
}

// The SI is quiet while a person of the business is responsible for the dialog
function isSiPaused(client) {
  return Boolean(client) && client.responsible_type === 'human';
}

/**
 * Who answers this client: { type: 'si' } or { type: 'human', userId }.
 */
async function setResponsible(client, responsible) {
  const human = responsible.type === 'human';
  await db.run(
    'UPDATE clients SET responsible_type = ?, responsible_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [human ? 'human' : 'si', human ? responsible.userId || null : null, client.id]
  );
  client.responsible_type = human ? 'human' : 'si';
  client.responsible_user_id = human ? responsible.userId || null : null;
}

async function history(projectId, clientId) {
  const rows = await db.all(
    'SELECT * FROM conversations WHERE project_id = ? AND client_id = ? ORDER BY created_at ASC, id ASC',
    [projectId, clientId]
  );
  return rows.map(toMessage);
}

/**
 * author: { type: 'si' | 'client' | 'owner' | 'assistant', userId? } (userId for owner / assistant)
 */
async function saveMessage(client, author, text, voice = null, { broadcast = false } = {}) {
  const id = newMessageId();
  await db.run(
    `INSERT INTO conversations (id, project_id, client_id, business_id, sender, author_type, author_user_id, text, is_voice, voice_id, voice_seconds, is_broadcast)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, client.project_id, client.id, client.business_id || null, SENDER_OF[author.type], author.type, author.userId || null, text,
      voice ? 1 : 0, voice ? voice.id : null, voice ? voice.seconds : null, broadcast ? 1 : 0]
  );
  await db.run(
    'UPDATE clients SET last_message = ?, last_activity = CURRENT_TIMESTAMP WHERE id = ?',
    [`${LAST_MESSAGE_PREFIX[author.type] || ''}${voice ? '🎤 ' : ''}${text}`.slice(0, 500), client.id]
  );
  return toMessage(await db.get('SELECT * FROM conversations WHERE id = ?', [id]));
}

const SI = { type: 'si' };
const CLIENT = { type: 'client' };

/**
 * A client's message: saved, then the SI answers unless the expert took over (SI paused)
 * or the per-client limit is used up. Returns { message, reply } (reply may be null).
 */
async function handleClientMessage(project, lead, text, voice = null) {
  const past = await history(project.id, lead.id);
  const message = await saveMessage(lead, CLIENT, text, voice);
  await funnelService.recordEvent(lead, 'client_message', CLIENT);
  if (lead.status === 'new') {
    await db.run(`UPDATE clients SET status = 'active' WHERE id = ? AND status = 'new'`, [lead.id]);
  }

  // A person of the business answers: the SI stays silent ("Мне написали")
  if (isSiPaused(lead)) {
    await applyAnalysis(project, lead, await analyze(project, lead, past, text), text);
    return { message, reply: null, paused: true };
  }

  const settings = parseJson(project.custom_ai_settings);
  const limit = Number(settings.clientLimit) || DEFAULT_CLIENT_LIMIT;
  const siCount = past.filter(m => m.sender === 'ai').length;
  if (siCount >= limit) {
    const lastSi = [...past].reverse().find(m => m.sender === 'ai');
    if (lastSi && lastSi.text === LIMIT_TEXT) return { message, reply: null, limitReached: true };
    return { message, reply: await saveMessage(lead, SI, LIMIT_TEXT), limitReached: true };
  }

  // Search the SI-brain by this message plus the client's previous one (a follow-up like
  // "а сколько это длится?" needs the earlier question to make sense). Only when OpenAI answers.
  let knowledge = [];
  if (siEngine.isConfigured()) {
    const previous = [...past].reverse().find(m => m.sender === 'client');
    knowledge = await brainService.contextFor(project.id, [previous && previous.text, text].filter(Boolean).join('\n'));
  }
  // With free windows in the calendar the SI may offer the «Записаться» button
  const calendarEnabled = await calendarService.isEnabled(lead.business_id);
  const [result, analysis] = await Promise.all([
    siEngine.generateReply({
      project: { ...project, calendarEnabled, clientStepId: lead.step_id },
      expertName: await expertNameOf(project),
      history: past,
      userText: text,
      knowledge
    }),
    analyze(project, lead, past, text)
  ]);
  const reply = await saveMessage(lead, SI, result.text);
  await applyAnalysis(project, lead, analysis, text);
  return { message, reply, source: result.source };
}

// Funnel events of this turn (offer, answer to it, objection, refusal), asked from OpenAI next to
// the SI reply. A failure never breaks the chat: the journal just gets fewer events.
async function analyze(project, lead, past, text) {
  try {
    const lastOther = [...past].reverse().find(m => m.sender !== 'client');
    const settings = parseJson(project.custom_ai_settings);
    // Only the conditions of the client's step; the steps to see whether the client moved forward
    const conditions = funnelService.customConditions(settings.scenarios, settings.steps, lead.step_id);
    const steps = activeFunnel(lead) ? funnelService.stepsForAnalysis(settings.steps, lead) : null;
    return await siEngine.analyzeTurn({ project, lastSiText: lastOther && lastOther.text, clientText: text, conditions, steps });
  } catch (err) {
    console.warn('[SmartFlow funnel] analysis failed:', err.message);
    return null;
  }
}

async function applyAnalysis(project, lead, analysis, text) {
  if (!analysis) return;
  try {
    if (analysis.offerMade && !(await funnelService.hasEvent(lead.id, 'offer_sent'))) {
      await funnelService.recordEvent(lead, 'offer_sent', SI);
    }
    if (analysis.offerAnswered && !lead.offer_answered_at) {
      await clientEvent(project, lead, 'offer_answered', CLIENT);
    }
    if (analysis.objection) {
      await clientEvent(project, lead, 'objection', CLIENT, { objection: analysis.objection, text });
    }
    if (analysis.refused && lead.funnel_status !== 'refused' && lead.funnel_status !== 'bought') {
      await clientEvent(project, lead, 'refused', CLIENT);
    }
    if (analysis.matched && analysis.matched.length) {
      const own = funnelService.customConditions(parseJson(project.custom_ai_settings).scenarios);
      const texts = own.filter(c => analysis.matched.includes(c.id)).map(c => c.text);
      if (texts.length) await clientEvent(project, lead, 'condition', CLIENT, { matched: analysis.matched, condition: texts.join('; ') });
    }
    // Last: the message was said on the client's step; after it the client goes on to the next one
    if (Number.isInteger(analysis.stepIndex) && activeFunnel(lead)) {
      const steps = funnelService.normalizeSteps(parseJson(project.custom_ai_settings).steps);
      if (steps[analysis.stepIndex] && analysis.stepIndex > funnelService.stepIndexOf(steps, lead.step_id)) {
        await moveToStep(project, lead, steps[analysis.stepIndex].id, SI, { sendMaterial: true });
      }
    }
  } catch (err) {
    console.warn('[SmartFlow funnel] events not saved:', err.message);
  }
}

/**
 * An event of a client's path + the expert's "if…, then…" scenarios on it:
 * "передать человеку" pauses the SI and opens a request in "Мне написали",
 * "сообщить мне" sends the owner and the assistant a bot message. Each fires once per client.
 */
// Buttons the client pressed, as words for the expert's own conditions ("клиент нажал «Купить»")
const ACTION_WORDS = {
  buy_clicked: '(Клиент нажал кнопку «Купить»)',
  receipt_sent: '(Клиент отправил чек об оплате)',
  contact_shared: '(Клиент поделился своим номером телефона)'
};

async function clientEvent(project, client, type, actor, data = null) {
  let saved = null;
  if (data && data.objection) saved = { objection: data.objection };
  if (data && data.condition) saved = { condition: data.condition };
  if (data && data.stepId) saved = { stepId: data.stepId, title: data.title || '', ...(data.materialOf ? { materialOf: data.materialOf } : {}) };
  const stepBefore = client.step_id;
  const status = await funnelService.recordEvent(client, type, actor, saved);
  if (ACTION_WORDS[type]) await matchActionConditions(project, client, ACTION_WORDS[type]);
  const settings = parseJson(project.custom_ai_settings);
  // A scenario "только на шаге …" works on the step where the client was when it happened
  const scenarios = funnelService.normalizeScenarios(settings.scenarios)
    .filter(sc => sc.then !== 'si_says' && funnelService.scenarioMatches(sc, type, data || {})
      && funnelService.scenarioOnStep(sc, settings.steps, stepBefore));
  for (const scenario of scenarios) {
    if (await funnelService.scenarioFired(client.id, scenario.id)) continue;
    await funnelService.recordEvent(client, 'scenario', { type: 'system' }, { scenarioId: scenario.id, then: scenario.then });
    let what = `${funnelService.SCENARIO_WHEN[scenario.when]}${data && data.objection ? ` («${data.objection}»)` : ''}`;
    if (scenario.when === 'custom') what = `Условие «${scenario.condition}»`;
    if (scenario.when === 'step_reached') what = `Перешёл на шаг «${(data && data.title) || ''}»`;
    if (scenario.title) what = `Сценарий «${scenario.title}»: ${what.charAt(0).toLowerCase()}${what.slice(1)}`;
    if (scenario.then === 'handover') {
      if (!isSiPaused(client)) {
        await createHumanRequest(project, client, { reason: `Сценарий: ${what}${scenario.text ? `. ${scenario.text}` : ''}` });
      }
    } else if (scenario.then === 'send_text') {
      // The expert's material as is (a text or a link), right after the SI's answer
      await saveMessage(client, SI, scenario.text);
    } else if (scenario.then === 'notify') {
      const people = client.business_id ? await businessService.activeMemberIds(client.business_id) : [];
      if (!people.includes(project.owner_id)) people.unshift(project.owner_id);
      for (const userId of people) {
        await telegramBot.notifyUser(
          userId,
          `📍 ${client.name || 'Клиент'}: ${what}.\nSI-продавец: «${project.name}».${scenario.text ? `\n\n${scenario.text}` : ''}`,
          { buttonText: 'Открыть', startParam: `I_${project.id}` }
        );
      }
    }
  }
  return status;
}

/**
 * Buttons above the client's input appear only when the conversation needs them (they must not
 * scare a client by default):
 *  - "Отправить чек": the client pressed «Купить», or the SI / a person just spoke about payment
 *    or a receipt; hidden again once the client has bought;
 *  - "Поделиться контактом": the SI / a person just asked for a phone number or contact; hidden
 *    once the client shared it.
 *  - "Записаться": the business has free windows and the SI / a person just spoke about a meeting
 *    or a call, or the client already has a meeting (to see, move or cancel it).
 * "Just" = the last 3 messages from the SI or a person.
 */
const RECENT_OTHER = 3;
const ASKS_RECEIPT = /(чек|оплат|оплач)/i;
const ASKS_CONTACT = /(номер|телефон|контакт)/i;
const ASKS_MEETING = /(запис|встреч|созвон|консультац|zoom|зум)/i;
async function chatTools(project, lead, messages) {
  if (!lead) return { contact: false, receipt: false, booking: false };
  const recent = messages.filter(m => m.sender !== 'client').slice(-RECENT_OTHER).map(m => m.text || '');
  const contact = !lead.contact_consent_at && recent.some(t => ASKS_CONTACT.test(t));
  let receipt = false;
  if (project.payment_url && lead.funnel_status !== 'bought') {
    receipt = recent.some(t => ASKS_RECEIPT.test(t)) || await funnelService.hasEvent(lead.id, 'buy_clicked');
  }
  // booking: 'meeting' — the client has a meeting; 'book' — the conversation came to a meeting
  let booking = false;
  if (await calendarService.isEnabled(lead.business_id)) {
    if (await calendarService.upcomingOfClient(lead.id)) booking = 'meeting';
    else if (recent.some(t => ASKS_MEETING.test(t))) booking = 'book';
  }
  return { contact, receipt, booking };
}

// The expert's own conditions (and "шаг пройден, когда…") may be about buttons too:
// the press is checked like a message
async function matchActionConditions(project, client, words) {
  const settings = parseJson(project.custom_ai_settings);
  const conditions = funnelService.customConditions(settings.scenarios, settings.steps, client.step_id);
  const steps = activeFunnel(client) ? funnelService.stepsForAnalysis(settings.steps, client) : null;
  if (!conditions.length && !steps) return;
  try {
    const past = await history(project.id, client.id);
    const lastOther = [...past].reverse().find(m => m.sender !== 'client');
    const analysis = await siEngine.analyzeTurn({ project, lastSiText: lastOther && lastOther.text, clientText: words, conditions, steps });
    if (!analysis) return;
    const matched = analysis.matched || [];
    const texts = conditions.filter(c => matched.includes(c.id)).map(c => c.text);
    if (texts.length) await clientEvent(project, client, 'condition', { type: 'client' }, { matched, condition: texts.join('; ') });
    if (steps && Number.isInteger(analysis.stepIndex) && analysis.stepIndex > steps.index && activeFunnel(client)) {
      await moveToStep(project, client, steps.steps[analysis.stepIndex].id, SI, { sendMaterial: true });
    }
  } catch (err) {
    console.warn('[SmartFlow funnel] action conditions:', err.message);
  }
}

// Steps move only while the client is still in the funnel (not bought, not refused)
function activeFunnel(client) {
  return client.funnel_status !== 'bought' && client.funnel_status !== 'refused';
}

/**
 * The client comes to a step of the funnel: the journal, the "Клиент перешёл на шаг" scenarios
 * and — when the SI moved them (sendMaterial) — the step's material as a message from the SI,
 * once per step for this client. A person moving a client by hand sends no material.
 */
async function moveToStep(project, client, stepId, actor, { sendMaterial = false } = {}) {
  const steps = funnelService.normalizeSteps(parseJson(project.custom_ai_settings).steps);
  const step = steps.find(s => s.id === stepId);
  if (!step || (client.step_id || (steps[0] && steps[0].id)) === stepId) return null;
  const material = sendMaterial && step.material && !(await materialSent(client, step.id));
  await clientEvent(project, client, 'step_reached', actor, { stepId, title: step.title, materialOf: material ? step.id : null });
  if (material) await saveMessage(client, SI, step.material);
  return step;
}

// The material of a step goes to a client once (the step_reached event remembers it)
async function materialSent(client, stepId) {
  const rows = await db.all(`SELECT data FROM client_events WHERE client_id = ? AND type = 'step_reached'`, [client.id]);
  return rows.some(r => parseJson(r.data).materialOf === stepId);
}

/**
 * Outcome marked by a person of the business: bought, refused, or back into the funnel.
 */
const OUTCOMES = { paid: 'paid', refused: 'refused', reopened: 'reopened' };
async function markOutcome(project, client, outcome, member) {
  if (!OUTCOMES[outcome]) return null;
  const actor = { type: member.role === 'assistant' ? 'assistant' : 'owner', userId: member.userId };
  return clientEvent(project, client, OUTCOMES[outcome], actor);
}

/**
 * The person opened the consultant's link: the SI writes first (once, only into an empty chat).
 * Returns the opening message or null if the chat already has messages.
 */
async function startConversation(project, lead) {
  const past = await history(project.id, lead.id);
  if (past.length) return null;
  const result = await siEngine.generateOpener({ project: { ...project, clientStepId: lead.step_id }, expertName: await expertNameOf(project) });
  // Another request may have started the chat meanwhile: keep a single opener
  if ((await history(project.id, lead.id)).length) return null;
  const opener = await saveMessage(lead, SI, result.text);
  analytics.capture('si_chat_started', lead.external_client_id, { project_id: project.id, business_id: lead.business_id || '' });
  // The material of the first step of the funnel, right after the hello
  const steps = funnelService.normalizeSteps(parseJson(project.custom_ai_settings).steps);
  if (steps[0] && steps[0].material && !(await materialSent(lead, steps[0].id))) {
    await funnelService.recordEvent(lead, 'step_reached', SI, { stepId: steps[0].id, title: steps[0].title, materialOf: steps[0].id });
    await saveMessage(lead, SI, steps[0].material);
  }
  return opener;
}

/**
 * "Связаться с человеком": a request in "Мне написали", the owner becomes responsible for the
 * dialog (SI pauses), the owner and the assistant get a bot message with a button to the request.
 */
async function createHumanRequest(project, lead, { reason, leadName, leadUsername } = {}) {
  const inquiryId = newId('inq');
  const text = (reason || 'Клиент нажал «Связаться с человеком»').slice(0, 1000);
  await db.run(
    `INSERT INTO direct_inquiries (id, project_id, client_id, business_id, lead_name, lead_username, reason, urgency, status, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'urgent', 'waiting', 0)`,
    [inquiryId, project.id, lead.id, lead.business_id || null, leadName || lead.name || 'Клиент Telegram', leadUsername || lead.username || null, text]
  );
  if (!isSiPaused(lead)) await setResponsible(lead, { type: 'human', userId: project.owner_id });
  await funnelService.recordEvent(lead, 'handed_to_human', CLIENT);

  const people = lead.business_id ? await businessService.activeMemberIds(lead.business_id) : [];
  if (!people.includes(project.owner_id)) people.unshift(project.owner_id);
  let notified = false;
  for (const userId of people) {
    const sent = await telegramBot.notifyUser(
      userId,
      `🔔 ${leadName || lead.name || 'Клиент'} просит связаться лично.\nSI-продавец: «${project.name}».\n\n«${text}»`,
      { buttonText: 'Открыть обращение', startParam: `I_${project.id}` }
    );
    if (userId === project.owner_id) notified = sent;
  }
  return { inquiryId, notified };
}

/**
 * A person of the business (owner or assistant) answers a client personally: they become
 * responsible for the dialog (SI pauses), the client gets a bot message with a button back.
 * member: { userId, role: 'owner' | 'assistant' }
 */
async function humanReply(project, client, text, member) {
  const author = { type: member.role === 'assistant' ? 'assistant' : 'owner', userId: member.userId };
  const message = await saveMessage(client, author, text);
  await setResponsible(client, { type: 'human', userId: member.userId });
  await db.run(
    `UPDATE direct_inquiries SET status = 'answered', updated_at = CURRENT_TIMESTAMP WHERE client_id = ? AND status = 'waiting'`,
    [client.id]
  );
  await funnelService.recordEvent(client, 'human_replied', author);
  if (String(client.external_client_id || '').startsWith('usr_')) {
    const expertName = await expertNameOf(project);
    await telegramBot.notifyUser(
      client.external_client_id,
      author.type === 'assistant'
        ? `💬 Помощник ${expertName} ответил(а) вам лично в SmartFlow.`
        : `💬 ${expertName} ответил(а) вам лично в SmartFlow.`,
      { buttonText: 'Открыть чат', startParam: project.slug }
    );
  }
  return message;
}

/**
 * Pause the SI (the person becomes responsible) or give the dialog back to the SI.
 */
async function setSiEnabled(client, enabled, member) {
  const actor = { type: member.role === 'assistant' ? 'assistant' : 'owner', userId: member.userId };
  if (enabled) {
    await setResponsible(client, { type: 'si' });
    // Requests waiting in "Мне написали" are closed: the SI answers again
    await db.run(
      `UPDATE direct_inquiries SET status = 'answered', updated_at = CURRENT_TIMESTAMP WHERE client_id = ? AND status = 'waiting'`,
      [client.id]
    );
  } else {
    await setResponsible(client, { type: 'human', userId: member.userId });
  }
  await funnelService.recordEvent(client, enabled ? 'si_resumed' : 'si_paused', actor);
}

module.exports = {
  LIMIT_TEXT,
  findOrCreateLead,
  leadForUser,
  activeProjectBySlug,
  expertNameOf,
  history,
  saveMessage,
  isSiPaused,
  setResponsible,
  handleClientMessage,
  clientEvent,
  moveToStep,
  markOutcome,
  chatTools,
  startConversation,
  createHumanRequest,
  humanReply,
  setSiEnabled
};
