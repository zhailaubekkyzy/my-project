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
const { mediaUrl } = require('./media-service');

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
async function saveMessage(client, author, text) {
  const id = newMessageId();
  await db.run(
    `INSERT INTO conversations (id, project_id, client_id, business_id, sender, author_type, author_user_id, text, is_voice)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [id, client.project_id, client.id, client.business_id || null, SENDER_OF[author.type], author.type, author.userId || null, text]
  );
  await db.run(
    'UPDATE clients SET last_message = ?, last_activity = CURRENT_TIMESTAMP WHERE id = ?',
    [`${LAST_MESSAGE_PREFIX[author.type] || ''}${text}`.slice(0, 500), client.id]
  );
  return toMessage(await db.get('SELECT * FROM conversations WHERE id = ?', [id]));
}

const SI = { type: 'si' };
const CLIENT = { type: 'client' };

/**
 * A client's message: saved, then the SI answers unless the expert took over (SI paused)
 * or the per-client limit is used up. Returns { message, reply } (reply may be null).
 */
async function handleClientMessage(project, lead, text) {
  const past = await history(project.id, lead.id);
  const message = await saveMessage(lead, CLIENT, text);
  await funnelService.recordEvent(lead, 'client_message', CLIENT);
  if (lead.status === 'new') {
    await db.run(`UPDATE clients SET status = 'active' WHERE id = ? AND status = 'new'`, [lead.id]);
  }

  // A person of the business answers: the SI stays silent ("Мне написали")
  if (isSiPaused(lead)) return { message, reply: null, paused: true };

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
  const result = await siEngine.generateReply({
    project,
    expertName: await expertNameOf(project),
    history: past,
    userText: text,
    knowledge
  });
  const reply = await saveMessage(lead, SI, result.text);
  return { message, reply, source: result.source };
}

/**
 * The person opened the consultant's link: the SI writes first (once, only into an empty chat).
 * Returns the opening message or null if the chat already has messages.
 */
async function startConversation(project, lead) {
  const past = await history(project.id, lead.id);
  if (past.length) return null;
  const result = await siEngine.generateOpener({ project, expertName: await expertNameOf(project) });
  // Another request may have started the chat meanwhile: keep a single opener
  if ((await history(project.id, lead.id)).length) return null;
  return saveMessage(lead, SI, result.text);
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
  startConversation,
  createHumanRequest,
  humanReply,
  setSiEnabled
};
