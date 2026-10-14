// server/services/people-service.js - People find each other and write to each other inside SmartFlow.
//
// Owner's decisions (14 Oct.):
//  - anyone can be found (by name, @username, the line under the name) and written to; a person may
//    hide from search in the Profile;
//  - nothing to set up about who may write: the first message arrives with «Принять / Заблокировать»;
//  - the goal is that people get used to talking here: nobody is sent to Telegram.
// Protection against spam (platform rules, the same for everyone):
//  - until the person accepts, the one who started may send at most PENDING_LIMIT messages;
//  - at most NEW_PER_DAY new conversations a day from one person;
//  - blocked: the other side cannot write any more and does not find the blocker in search;
//  - «Пожаловаться» sends the last messages to the support team (they see a conversation only then).
const crypto = require('crypto');
const db = require('../db');
const telegramBot = require('./telegram-bot');
const profileService = require('./profile-service');
const supportService = require('./support-service');

const MAX_TEXT = 2000;
const PENDING_LIMIT = 3;
const NEW_PER_DAY = 20;
const SEARCH_LIMIT = 20;
const PAGE = 200;

class PeopleError extends Error {
  constructor(message, status = 400, code = 'PEOPLE') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const sqlTime = (date = new Date()) => date.toISOString().slice(0, 19).replace('T', ' ');
const toIso = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value).replace(' ', 'T') + (/[Z+]/.test(String(value)) ? '' : 'Z'));
  return isNaN(d) ? null : d.toISOString();
};

// Ids that sort by time (seconds in the database are not enough to order a quick exchange)
let counter = 0;
function newMessageId() {
  counter = (counter + 1) % 1679616;
  return `dmm_${Date.now().toString(36).padStart(9, '0')}${counter.toString(36).padStart(4, '0')}${crypto.randomBytes(3).toString('hex')}`;
}
const newThreadId = () => `dmt_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

const pairOf = (x, y) => (x < y ? [x, y] : [y, x]);

function personOf(user) {
  if (!user) return null;
  const u = profileService.toPublicUser(user);
  return {
    id: u.id,
    displayName: u.displayName || 'Без имени',
    username: u.username || null,
    photoUrl: u.photoUrl,
    headline: (u.profile && u.profile.headline) || ''
  };
}

async function activeUser(userId) {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user || user.is_demo || user.status === 'blocked') return null;
  return user;
}

// ---------- Search ----------
/**
 * People by name, @username or the line under the name. Hidden people, blocked people,
 * people who blocked me and I myself are left out.
 */
async function search(meId, query) {
  const q = String(query || '').trim().replace(/^@/, '').toLowerCase().slice(0, 60);
  if (q.length < 2) return [];
  const esc = (v) => v.replace(/[\\%_]/g, '\\$&');
  const like = `%${esc(q)}%`;
  // SQLite lowers only Latin letters: also look for "Анна" when "анна" is typed
  const title = `%${esc(q.charAt(0).toUpperCase() + q.slice(1))}%`;
  const rows = await db.all(
    `SELECT u.* FROM users u
     WHERE u.id <> ? AND u.is_demo = 0 AND u.status <> 'blocked' AND COALESCE(u.hidden_from_search, 0) = 0
       AND (LOWER(u.display_name) LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\'
            OR LOWER(COALESCE(u.username, '')) LIKE ? ESCAPE '\\'
            OR LOWER(COALESCE(u.profile, '')) LIKE ? ESCAPE '\\' OR COALESCE(u.profile, '') LIKE ? ESCAPE '\\')
       AND NOT EXISTS (
         SELECT 1 FROM dm_threads t WHERE t.status = 'blocked' AND t.blocked_by = u.id
           AND ((t.user_a = u.id AND t.user_b = ?) OR (t.user_b = u.id AND t.user_a = ?))
       )
     ORDER BY COALESCE(u.last_seen_at, u.created_at) DESC
     LIMIT 60`,
    [meId, like, title, like, like, title, meId, meId]
  );
  // The profile text matched may be "bio" or a link: keep only matches in the name, @username or headline
  return rows
    .map(personOf)
    .filter(p => [p.displayName, p.username || '', p.headline].some(v => v.toLowerCase().includes(q)))
    .slice(0, SEARCH_LIMIT);
}

async function setHidden(userId, hidden) {
  await db.run('UPDATE users SET hidden_from_search = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [hidden ? 1 : 0, userId]);
}

// ---------- Conversations ----------
async function threadWith(meId, otherId) {
  const [a, b] = pairOf(meId, otherId);
  return db.get('SELECT * FROM dm_threads WHERE user_a = ? AND user_b = ?', [a, b]);
}

function myReadAt(thread, meId) {
  return thread.user_a === meId ? thread.a_read_at : thread.b_read_at;
}

// What I see about a conversation
function view(thread, meId, other) {
  const iStarted = thread.started_by === meId;
  const lastActivity = toIso(thread.last_activity);
  const readAt = toIso(myReadAt(thread, meId));
  return {
    id: thread.id,
    person: other,
    status: thread.status,
    // pending: the question «Принять / Заблокировать» is mine to answer
    needsMyAnswer: thread.status === 'pending' && !iStarted,
    waitingForAnswer: thread.status === 'pending' && iStarted,
    blockedByMe: thread.status === 'blocked' && thread.blocked_by === meId,
    blockedMe: thread.status === 'blocked' && thread.blocked_by !== meId,
    lastMessage: thread.last_message || '',
    lastFromMe: thread.last_sender === meId,
    lastActivity,
    unread: Boolean(thread.last_sender && thread.last_sender !== meId && (!readAt || readAt < lastActivity))
  };
}

/**
 * My conversations with people, newest first. Someone who blocked me still shows (without saying it).
 */
async function myThreads(meId) {
  const rows = await db.all(
    `SELECT * FROM dm_threads WHERE (user_a = ? OR user_b = ?) AND last_message IS NOT NULL
     ORDER BY last_activity DESC LIMIT ?`,
    [meId, meId, PAGE]
  );
  const result = [];
  for (const t of rows) {
    const otherId = t.user_a === meId ? t.user_b : t.user_a;
    const other = personOf(await db.get('SELECT * FROM users WHERE id = ?', [otherId]));
    if (!other) continue;
    const v = view(t, meId, other);
    // The blocker does not see what is said about the block; the blocked one sees nothing special
    if (v.blockedMe) { v.status = 'accepted'; v.blockedMe = false; }
    result.push(v);
  }
  return result;
}

function toMessage(r, meId) {
  return { id: r.id, text: r.text, mine: r.sender_id === meId, createdAt: toIso(r.created_at) };
}

/**
 * The conversation with a person: messages and what I may do. Opening it marks it read.
 */
async function conversation(meId, otherId) {
  const otherUser = await activeUser(otherId);
  if (!otherUser || otherId === meId) throw new PeopleError('Человек не найден', 404, 'NOT_FOUND');
  const other = personOf(otherUser);
  const thread = await threadWith(meId, otherId);
  if (!thread) return { thread: null, person: other, messages: [], canWrite: true };
  const rows = await db.all(
    `SELECT * FROM dm_messages WHERE thread_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    [thread.id, PAGE]
  );
  await db.run(
    `UPDATE dm_threads SET ${thread.user_a === meId ? 'a_read_at' : 'b_read_at'} = ? WHERE id = ?`,
    [sqlTime(), thread.id]
  );
  const v = view(thread, meId, other);
  const blockedMe = v.blockedMe;
  if (blockedMe) { v.status = 'accepted'; v.blockedMe = false; }
  const mineWhilePending = thread.status === 'pending' && thread.started_by === meId
    ? rows.filter(r => r.sender_id === meId).length : 0;
  return {
    thread: v,
    person: other,
    messages: rows.reverse().map(r => toMessage(r, meId)),
    canWrite: !v.blockedByMe && mineWhilePending < PENDING_LIMIT,
    pendingLimit: PENDING_LIMIT
  };
}

/**
 * Sends a message. The first one starts a conversation (with «Принять / Заблокировать» for the
 * other person); the other person's answer accepts it.
 */
async function send(meId, otherId, rawText) {
  const text = String(rawText || '').trim().slice(0, MAX_TEXT);
  if (!text) throw new PeopleError('Сообщение не может быть пустым', 400, 'EMPTY');
  if (otherId === meId) throw new PeopleError('Нельзя написать самому себе', 400, 'SELF');
  const otherUser = await activeUser(otherId);
  if (!otherUser) throw new PeopleError('Человек не найден', 404, 'NOT_FOUND');
  const me = await db.get('SELECT * FROM users WHERE id = ?', [meId]);

  let thread = await threadWith(meId, otherId);
  if (!thread) {
    const today = await db.get(
      `SELECT COUNT(*) AS count FROM dm_threads WHERE started_by = ? AND created_at >= ?`,
      [meId, sqlTime(new Date(Date.now() - 24 * 3600000))]
    );
    if (Number(today.count) >= NEW_PER_DAY) {
      throw new PeopleError(`Сегодня вы уже начали ${NEW_PER_DAY} новых знакомств — продолжите завтра 🙂`, 429, 'NEW_LIMIT');
    }
    const [a, b] = pairOf(meId, otherId);
    await db.run(
      `INSERT INTO dm_threads (id, user_a, user_b, started_by, status) VALUES (?, ?, ?, ?, 'pending') ON CONFLICT (user_a, user_b) DO NOTHING`,
      [newThreadId(), a, b, meId]
    );
    thread = await threadWith(meId, otherId);
  }

  if (thread.status === 'blocked') {
    // The blocker unblocks first; the blocked one is not told why
    throw new PeopleError(thread.blocked_by === meId
      ? 'Вы заблокировали этого человека. Разблокируйте, чтобы написать.'
      : 'Сообщение не доставлено.', 403, 'BLOCKED');
  }
  if (thread.status === 'pending') {
    if (thread.started_by === meId) {
      const sent = await db.get('SELECT COUNT(*) AS count FROM dm_messages WHERE thread_id = ? AND sender_id = ?', [thread.id, meId]);
      if (Number(sent.count) >= PENDING_LIMIT) {
        throw new PeopleError('Подождите, пока человек ответит: до ответа можно отправить 3 сообщения.', 429, 'PENDING_LIMIT');
      }
    } else {
      // Answering is accepting
      await db.run(`UPDATE dm_threads SET status = 'accepted' WHERE id = ? AND status = 'pending'`, [thread.id]);
    }
  }

  const now = sqlTime();
  const id = newMessageId();
  await db.run('INSERT INTO dm_messages (id, thread_id, sender_id, text, created_at) VALUES (?, ?, ?, ?, ?)', [id, thread.id, meId, text, now]);
  const myRead = thread.user_a === meId ? 'a_read_at' : 'b_read_at';
  await db.run(
    `UPDATE dm_threads SET last_message = ?, last_sender = ?, last_activity = ?, ${myRead} = ? WHERE id = ?`,
    [text.slice(0, 200), meId, now, now, thread.id]
  );

  // Buddy, then Telegram: once per unread run (not on every message)
  const otherRead = toIso(thread.user_a === otherId ? thread.a_read_at : thread.b_read_at);
  const lastActivity = toIso(thread.last_activity);
  const alreadyUnread = thread.last_message && thread.last_sender === meId && (!otherRead || otherRead < lastActivity);
  if (!alreadyUnread) {
    const name = personOf(me).displayName;
    const firstTime = thread.status === 'pending' && thread.started_by === meId;
    await telegramBot.notifyUser(
      otherId,
      firstTime ? `👋 ${name} хочет с вами пообщаться в SmartFlow.` : `💬 Новое сообщение от ${name} в SmartFlow.`,
      { buttonText: 'Открыть', startParam: `U_${meId}` }
    );
  }
  return { message: toMessage({ id, text, sender_id: meId, created_at: now }, meId) };
}

/**
 * «Принять» / «Заблокировать» / «Разблокировать».
 */
async function answer(meId, otherId, action) {
  const thread = await threadWith(meId, otherId);
  if (!thread) throw new PeopleError('Переписка не найдена', 404, 'NOT_FOUND');
  if (action === 'accept') {
    if (thread.status !== 'pending' || thread.started_by === meId) throw new PeopleError('Нечего принимать', 409, 'NOT_PENDING');
    await db.run(`UPDATE dm_threads SET status = 'accepted' WHERE id = ?`, [thread.id]);
  } else if (action === 'block') {
    await db.run(`UPDATE dm_threads SET status = 'blocked', blocked_by = ? WHERE id = ?`, [meId, thread.id]);
  } else if (action === 'unblock') {
    if (thread.status !== 'blocked' || thread.blocked_by !== meId) throw new PeopleError('Человек не заблокирован', 409, 'NOT_BLOCKED');
    await db.run(`UPDATE dm_threads SET status = 'accepted', blocked_by = NULL WHERE id = ?`, [thread.id]);
  } else {
    throw new PeopleError('Неизвестное действие', 400, 'BAD_ACTION');
  }
  return conversation(meId, otherId);
}

/**
 * «Пожаловаться»: the team gets the complaint with the last messages of this conversation
 * (the only way the team sees a private conversation). The person is blocked at once.
 */
async function report(meId, otherId, reason) {
  const thread = await threadWith(meId, otherId);
  if (!thread) throw new PeopleError('Переписка не найдена', 404, 'NOT_FOUND');
  const other = personOf(await db.get('SELECT * FROM users WHERE id = ?', [otherId]));
  const code = ((await db.get('SELECT support_code FROM users WHERE id = ?', [otherId])) || {}).support_code;
  const rows = (await db.all(
    'SELECT * FROM dm_messages WHERE thread_id = ? ORDER BY created_at DESC, id DESC LIMIT 20', [thread.id]
  )).reverse();
  const lines = rows.map(r => `${r.sender_id === meId ? 'Я' : other.displayName}: ${r.text.slice(0, 200)}`);
  let text = `Жалоба на переписку с ${other.displayName}${code ? ` (${code})` : ''}.`;
  const why = String(reason || '').trim().slice(0, 300);
  if (why) text += `\nПричина: ${why}`;
  text += `\n\nПоследние сообщения:\n${lines.join('\n')}`;
  const id = `fb_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await db.run('INSERT INTO feedback (id, user_id, text, context) VALUES (?, ?, ?, ?)', [
    id, meId, text.slice(0, 4000), JSON.stringify({ screen: 'chats/person', reportedUserId: otherId })
  ]);
  await supportService.notifyStaffAboutFeedback(id);
  await db.run(`UPDATE dm_threads SET status = 'blocked', blocked_by = ? WHERE id = ?`, [meId, thread.id]);
  return { reported: true };
}

module.exports = {
  PeopleError,
  PENDING_LIMIT,
  NEW_PER_DAY,
  search,
  setHidden,
  myThreads,
  conversation,
  send,
  answer,
  report
};
