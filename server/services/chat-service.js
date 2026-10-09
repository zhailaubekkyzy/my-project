// server/services/chat-service.js - A client's conversation with an SI-consultant.
// A client is a row in `clients` per (consultant, person); messages are in `conversations`.
const crypto = require('crypto');
const db = require('../db');
const siEngine = require('./si-engine');
const telegramBot = require('./telegram-bot');
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

  const leadId = newId('cli');
  await db.run(
    `INSERT INTO clients (id, project_id, external_client_id, name, username, avatar_url, status, funnel_step, deal_value, tags, last_message, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, 'new', 'step-1', 0, '[]', ?, 0)`,
    [leadId, project.id, clientId || `anon_${Date.now()}`, name || 'Клиент Telegram', username || null, avatarUrl || null, lastMessage || null]
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

function toMessage(row) {
  return {
    id: row.id,
    sender: row.sender,
    text: row.text,
    isVoice: Boolean(row.is_voice),
    createdAt: row.created_at
  };
}

async function history(projectId, clientId) {
  const rows = await db.all(
    'SELECT * FROM conversations WHERE project_id = ? AND client_id = ? ORDER BY created_at ASC, id ASC',
    [projectId, clientId]
  );
  return rows.map(toMessage);
}

async function saveMessage(projectId, clientId, sender, text) {
  const id = newMessageId();
  await db.run(
    `INSERT INTO conversations (id, project_id, client_id, sender, text, is_voice)
     VALUES (?, ?, ?, ?, ?, 0)`,
    [id, projectId, clientId, sender, text]
  );
  const prefix = sender === 'ai' ? '[SI]: ' : (sender === 'expert_human' ? '[Эксперт]: ' : '');
  await db.run(
    'UPDATE clients SET last_message = ?, last_activity = CURRENT_TIMESTAMP WHERE id = ?',
    [`${prefix}${text}`.slice(0, 500), clientId]
  );
  return toMessage(await db.get('SELECT * FROM conversations WHERE id = ?', [id]));
}

/**
 * A client's message: saved, then the SI answers unless the expert took over (SI paused)
 * or the per-client limit is used up. Returns { message, reply } (reply may be null).
 */
async function handleClientMessage(project, lead, text) {
  const past = await history(project.id, lead.id);
  const message = await saveMessage(project.id, lead.id, 'client', text);
  if (lead.status === 'new') {
    await db.run(`UPDATE clients SET status = 'active' WHERE id = ? AND status = 'new'`, [lead.id]);
  }

  // The expert answers personally: the SI stays silent ("Мне написали")
  if (lead.status === 'human_needed') return { message, reply: null, paused: true };

  const settings = parseJson(project.custom_ai_settings);
  const limit = Number(settings.clientLimit) || DEFAULT_CLIENT_LIMIT;
  const siCount = past.filter(m => m.sender === 'ai').length;
  if (siCount >= limit) {
    const lastSi = [...past].reverse().find(m => m.sender === 'ai');
    if (lastSi && lastSi.text === LIMIT_TEXT) return { message, reply: null, limitReached: true };
    return { message, reply: await saveMessage(project.id, lead.id, 'ai', LIMIT_TEXT), limitReached: true };
  }

  const result = await siEngine.generateReply({
    project,
    expertName: await expertNameOf(project),
    history: past,
    userText: text
  });
  const reply = await saveMessage(project.id, lead.id, 'ai', result.text);
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
  return saveMessage(project.id, lead.id, 'ai', result.text);
}

/**
 * "Связаться с человеком": a request for the expert, the SI pauses, the expert gets a bot message
 * with a button that opens this request in the Mini App.
 */
async function createHumanRequest(project, lead, { reason, leadName, leadUsername } = {}) {
  const inquiryId = newId('inq');
  const text = (reason || 'Клиент нажал «Связаться с человеком»').slice(0, 1000);
  await db.run(
    `INSERT INTO direct_inquiries (id, project_id, client_id, lead_name, lead_username, reason, urgency, status, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, 'urgent', 'waiting', 0)`,
    [inquiryId, project.id, lead.id, leadName || lead.name || 'Клиент Telegram', leadUsername || lead.username || null, text]
  );
  await db.run(
    `UPDATE clients SET status = 'human_needed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?`,
    [lead.id, project.id]
  );

  const notified = await telegramBot.notifyUser(
    project.owner_id,
    `🔔 ${leadName || lead.name || 'Клиент'} просит связаться лично.\nSI-консультант: «${project.name}».\n\n«${text}»`,
    { buttonText: 'Открыть обращение', startParam: `I_${project.id}` }
  );
  return { inquiryId, notified };
}

/**
 * The expert answers a client personally: the SI pauses for this client and the client gets
 * a bot message with a button back to the chat.
 */
async function expertReply(project, client, text) {
  const message = await saveMessage(project.id, client.id, 'expert_human', text);
  await db.run(`UPDATE clients SET status = 'human_needed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [client.id]);
  await db.run(
    `UPDATE direct_inquiries SET status = 'answered', updated_at = CURRENT_TIMESTAMP WHERE client_id = ? AND status = 'waiting'`,
    [client.id]
  );
  if (String(client.external_client_id || '').startsWith('usr_')) {
    await telegramBot.notifyUser(
      client.external_client_id,
      `💬 ${await expertNameOf(project)} ответил(а) вам лично в SmartFlow.`,
      { buttonText: 'Открыть чат', startParam: project.slug }
    );
  }
  return message;
}

module.exports = {
  LIMIT_TEXT,
  findOrCreateLead,
  leadForUser,
  activeProjectBySlug,
  expertNameOf,
  history,
  saveMessage,
  handleClientMessage,
  startConversation,
  createHumanRequest,
  expertReply
};
