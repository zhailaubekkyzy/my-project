// server/services/group-service.js - Group conversations in «Чаты» (owner's decisions 21 Nov.).
//
// A group is a plain conversation of several people; anyone can create one. (A community with a feed,
// courses and points is a different thing, made only by a business profile — later.)
//  - up to MAX_MEMBERS people; the creator and admins add people from search, each gets an invitation
//    «Вступить / Отказаться» (nobody is put into a group by force); there is also an invitation link;
//  - roles: owner (one) · admin (up to MAX_ADMINS) · member. The owner and admins rename, change the
//    photo, add and remove people, pin a message, delete any message; the owner names admins;
//  - text, voice (1.5 min), photo, round video (30 s) — the same rules as private conversations;
//    a reply to a message; one pinned message;
//  - reactions: the author gets a notification (in Buddy; on the phone at most once an hour);
//  - new messages: one notification per unread run, «Без звука» turns them off;
//  - someone who blocked me in a private conversation cannot be invited by me;
//  - the only SI here: «Кратко» — a short summary of the conversation on request (daily limit).
// Identity always comes from the login, never from the request body.
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const analytics = require('./analytics-service');
const notifyService = require('./notify-service');
const profileService = require('./profile-service');
const supportService = require('./support-service');
const mediaService = require('./media-service');
const siEngine = require('./si-engine');
const peopleService = require('./people-service');
const { detectImageType } = require('./media-service');
const { detectAudioType } = require('./voice-service');

const MAX_MEMBERS = 50;
const MAX_ADMINS = 2;
const NEW_GROUPS_PER_DAY = 10;
const INVITES_PER_DAY = 100;
const MAX_NAME = 60;
const MAX_TEXT = 2000;
const PAGE = 200;
const FILES_PER_DAY = 60;
const SUMMARIES_PER_DAY = 10;
const SUMMARY_MIN_MESSAGES = 5;
const SUMMARY_MESSAGES = 150;
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👏'];
const FILES = peopleService.FILES;

class GroupError extends Error {
  constructor(message, status = 400, code = 'GROUP') {
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
const dayAgo = () => sqlTime(new Date(Date.now() - 24 * 3600000));

// Ids that sort by time (seconds in the database are not enough to order a quick exchange)
let counter = 0;
function newMessageId() {
  counter = (counter + 1) % 1679616;
  return `grm_${Date.now().toString(36).padStart(9, '0')}${counter.toString(36).padStart(4, '0')}${crypto.randomBytes(3).toString('hex')}`;
}
const newId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
const newInviteCode = () => crypto.randomBytes(6).toString('hex');

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

function cleanName(value) {
  const name = String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  if (!name) throw new GroupError('Напишите название группы', 400, 'NO_NAME');
  return name;
}

async function groupById(groupId) {
  return db.get('SELECT * FROM chat_groups WHERE id = ?', [String(groupId || '')]);
}

async function memberOf(groupId, userId) {
  return db.get('SELECT * FROM chat_group_members WHERE group_id = ? AND user_id = ?', [groupId, userId]);
}

async function activeCount(groupId) {
  const row = await db.get(`SELECT COUNT(*) AS n FROM chat_group_members WHERE group_id = ? AND status IN ('active', 'invited')`, [groupId]);
  return Number(row.n) || 0;
}

const touch = (groupId) => db.run('UPDATE chat_groups SET changed_at = ? WHERE id = ?', [sqlTime(), groupId]);

// The group and my membership; only active members (or invited, when allowed) pass
async function requireMember(meId, groupId, { allowInvited = false } = {}) {
  const group = await groupById(groupId);
  const member = group ? await memberOf(group.id, meId) : null;
  if (!group || !member || !(member.status === 'active' || (allowInvited && member.status === 'invited'))) {
    throw new GroupError('Группа не найдена', 404, 'NOT_FOUND');
  }
  return { group, member };
}

async function requireAdmin(meId, groupId) {
  const ctx = await requireMember(meId, groupId);
  if (!['owner', 'admin'].includes(ctx.member.role)) throw new GroupError('Это может только создатель или админ группы', 403, 'NOT_ADMIN');
  return ctx;
}

// Did this person block me in a private conversation? Then I cannot invite them (they are not told).
async function blockedMe(meId, otherId) {
  const [a, b] = meId < otherId ? [meId, otherId] : [otherId, meId];
  const t = await db.get('SELECT status, blocked_by FROM dm_threads WHERE user_a = ? AND user_b = ?', [a, b]);
  return Boolean(t && t.status === 'blocked');
}

function groupView(g, member, memberCount) {
  const lastActivity = toIso(g.last_activity);
  const readAt = toIso(member.read_at);
  return {
    id: g.id,
    name: g.name,
    photoUrl: mediaService.mediaUrl(g.photo_media_id) || null,
    role: member.role,
    invited: member.status === 'invited',
    muted: Boolean(member.muted),
    memberCount,
    lastMessage: g.last_message || '',
    lastSenderName: null,
    lastFromMe: g.last_sender === member.user_id,
    lastActivity,
    unread: member.status === 'active' && Boolean(g.last_sender && g.last_sender !== member.user_id && (!readAt || readAt < lastActivity))
  };
}

// ---------- Invitations ----------
async function inviteUsers(meId, group, userIds) {
  const me = personOf(await db.get('SELECT * FROM users WHERE id = ?', [meId]));
  const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map(String))].filter(id => id && id !== meId).slice(0, MAX_MEMBERS);
  const today = await db.get(
    `SELECT COUNT(*) AS n FROM chat_group_members WHERE invited_by = ? AND created_at >= ?`, [meId, dayAgo()]
  );
  let room = MAX_MEMBERS - await activeCount(group.id);
  let left = INVITES_PER_DAY - Number(today.n);
  const invited = [];
  for (const userId of ids) {
    if (room <= 0) break;
    if (left <= 0) throw new GroupError('На сегодня приглашений достаточно — продолжите завтра 🙂', 429, 'INVITES_LIMIT');
    const user = await activeUser(userId);
    if (!user) continue;
    const existing = await memberOf(group.id, userId);
    if (existing && existing.status !== 'removed') continue;
    if (await blockedMe(meId, userId)) continue;
    if (existing) {
      await db.run(
        `UPDATE chat_group_members SET status = 'invited', role = 'member', invited_by = ?, created_at = ? WHERE group_id = ? AND user_id = ?`,
        [meId, sqlTime(), group.id, userId]
      );
    } else {
      await db.run(
        `INSERT INTO chat_group_members (group_id, user_id, role, status, invited_by, created_at) VALUES (?, ?, 'member', 'invited', ?, ?)`,
        [group.id, userId, meId, sqlTime()]
      );
    }
    room -= 1;
    left -= 1;
    invited.push(userId);
    await notifyService.notifyUser(
      userId,
      { ru: `👥 ${me.displayName} приглашает вас в группу «${group.name}» в SmartFlow.`, en: `👥 ${me.displayName} invites you to the group «${group.name}» in SmartFlow.` },
      { buttonText: { ru: 'Открыть', en: 'Open' }, startParam: `G_${group.id}` }
    );
  }
  if (invited.length) await touch(group.id);
  return invited;
}

/**
 * Creates a group: I am its owner; the people I chose get invitations.
 */
async function create(meId, { name, memberIds } = {}) {
  const groupName = cleanName(name);
  const today = await db.get('SELECT COUNT(*) AS n FROM chat_groups WHERE owner_id = ? AND created_at >= ?', [meId, dayAgo()]);
  if (Number(today.n) >= NEW_GROUPS_PER_DAY) throw new GroupError('Сегодня вы уже создали достаточно групп — продолжите завтра 🙂', 429, 'GROUPS_LIMIT');
  const id = newId('grp');
  const now = sqlTime();
  await db.run(
    `INSERT INTO chat_groups (id, name, owner_id, invite_code, last_activity, changed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, groupName, meId, newInviteCode(), now, now, now]
  );
  await db.run(
    `INSERT INTO chat_group_members (group_id, user_id, role, status, joined_at, read_at, created_at) VALUES (?, ?, 'owner', 'active', ?, ?, ?)`,
    [id, meId, now, now, now]
  );
  const group = await groupById(id);
  const invited = await inviteUsers(meId, group, memberIds);
  analytics.capture('group_created', meId, { invited: invited.length });
  return { groupId: id, invited: invited.length };
}

async function invite(meId, groupId, userIds) {
  const { group } = await requireAdmin(meId, groupId);
  const invited = await inviteUsers(meId, group, userIds);
  return { invited: invited.length };
}

/**
 * «Вступить» (accept: true) or «Отказаться» on an invitation.
 */
async function answerInvite(meId, groupId, accept) {
  const { group, member } = await requireMember(meId, groupId, { allowInvited: true });
  if (member.status !== 'invited') return conversation(meId, groupId);
  if (accept) {
    const now = sqlTime();
    await db.run(`UPDATE chat_group_members SET status = 'active', joined_at = ?, read_at = ? WHERE group_id = ? AND user_id = ?`, [now, now, group.id, meId]);
    analytics.capture('group_joined', meId, { via: 'invite' });
    await touch(group.id);
    return conversation(meId, groupId);
  }
  await db.run('DELETE FROM chat_group_members WHERE group_id = ? AND user_id = ?', [group.id, meId]);
  await touch(group.id);
  return { declined: true };
}

/**
 * What the invitation link shows before joining: the name, photo and how many people are inside.
 */
async function preview(meId, code) {
  const group = await db.get('SELECT * FROM chat_groups WHERE invite_code = ?', [String(code || '')]);
  if (!group) throw new GroupError('Ссылка-приглашение устарела', 404, 'NOT_FOUND');
  const member = await memberOf(group.id, meId);
  const count = await db.get(`SELECT COUNT(*) AS n FROM chat_group_members WHERE group_id = ? AND status = 'active'`, [group.id]);
  return {
    groupId: group.id,
    name: group.name,
    photoUrl: mediaService.mediaUrl(group.photo_media_id) || null,
    memberCount: Number(count.n) || 0,
    isMember: Boolean(member && member.status === 'active'),
    removed: Boolean(member && member.status === 'removed')
  };
}

async function joinByCode(meId, code) {
  const group = await db.get('SELECT * FROM chat_groups WHERE invite_code = ?', [String(code || '')]);
  if (!group) throw new GroupError('Ссылка-приглашение устарела', 404, 'NOT_FOUND');
  const member = await memberOf(group.id, meId);
  if (member && member.status === 'active') return conversation(meId, group.id);
  if (member && member.status === 'removed') throw new GroupError('Вас удалили из этой группы — вступить по ссылке нельзя', 403, 'REMOVED');
  if (!member && await activeCount(group.id) >= MAX_MEMBERS) throw new GroupError(`В группе уже ${MAX_MEMBERS} человек — мест нет`, 409, 'FULL');
  const now = sqlTime();
  if (member) {
    await db.run(`UPDATE chat_group_members SET status = 'active', joined_at = ?, read_at = ? WHERE group_id = ? AND user_id = ?`, [now, now, group.id, meId]);
  } else {
    await db.run(
      `INSERT INTO chat_group_members (group_id, user_id, role, status, joined_at, read_at, created_at) VALUES (?, ?, 'member', 'active', ?, ?, ?)`,
      [group.id, meId, now, now, now]
    );
  }
  analytics.capture('group_joined', meId, { via: 'link' });
  await touch(group.id);
  return conversation(meId, group.id);
}

// ---------- Lists and the conversation ----------
/**
 * My groups (active and invitations), newest first.
 */
async function myGroups(meId) {
  const rows = await db.all(
    `SELECT g.*, m.user_id AS m_user_id, m.role AS m_role, m.status AS m_status, m.muted AS m_muted, m.read_at AS m_read_at,
       (SELECT COUNT(*) FROM chat_group_members c WHERE c.group_id = g.id AND c.status = 'active') AS member_count
     FROM chat_group_members m JOIN chat_groups g ON g.id = m.group_id
     WHERE m.user_id = ? AND m.status IN ('active', 'invited')
     ORDER BY g.last_activity DESC LIMIT ?`,
    [meId, PAGE]
  );
  const result = [];
  for (const r of rows) {
    const member = { user_id: r.m_user_id, role: r.m_role, status: r.m_status, muted: r.m_muted, read_at: r.m_read_at };
    const v = groupView(r, member, Number(r.member_count) || 0);
    if (r.last_sender && r.last_sender !== meId) {
      const sender = personOf(await db.get('SELECT * FROM users WHERE id = ?', [r.last_sender]));
      v.lastSenderName = sender ? sender.displayName : null;
    }
    result.push(v);
  }
  return result;
}

function shortText(r) {
  if (!r) return '';
  if (r.deleted_at) return 'Сообщение удалено';
  return String(r.text || '').slice(0, 120);
}

/**
 * The group: messages (with replies and reactions), members, the pinned message. Opening marks it read.
 * An invited person sees only the name, who invited them and the buttons «Вступить / Отказаться».
 */
async function conversation(meId, groupId) {
  const { group, member } = await requireMember(meId, groupId, { allowInvited: true });
  const memberRows = await db.all(
    `SELECT u.*, m.role AS m_role, m.status AS m_status FROM chat_group_members m JOIN users u ON u.id = m.user_id
     WHERE m.group_id = ? AND m.status IN ('active', 'invited') ORDER BY m.joined_at, m.created_at`,
    [group.id]
  );
  const people = new Map();
  const members = [];
  for (const r of memberRows) {
    const p = personOf(r);
    if (!p) continue;
    people.set(p.id, p);
    members.push({ ...p, role: r.m_role, invited: r.m_status === 'invited' });
  }
  const activeMembers = members.filter(m => !m.invited);
  const info = groupView(group, member, activeMembers.length);
  info.inviteCode = ['owner', 'admin'].includes(member.role) ? group.invite_code : null;

  if (member.status === 'invited') {
    const inviter = member.invited_by ? personOf(await db.get('SELECT * FROM users WHERE id = ?', [member.invited_by])) : null;
    return { group: info, invitedBy: inviter, members: [], messages: [], pinned: null, canWrite: false };
  }

  const rows = (await db.all(
    'SELECT * FROM chat_group_messages WHERE group_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    [group.id, PAGE]
  )).reverse();
  const byId = new Map(rows.map(r => [r.id, r]));
  // Replies to older messages and a pinned older message
  const missing = [...new Set([...rows.map(r => r.reply_to), group.pinned_message_id].filter(id => id && !byId.has(id)))];
  for (const id of missing) {
    const r = await db.get('SELECT * FROM chat_group_messages WHERE id = ? AND group_id = ?', [id, group.id]);
    if (r) byId.set(r.id, r);
  }
  const senderOf = async (userId) => {
    if (!people.has(userId)) people.set(userId, personOf(await db.get('SELECT * FROM users WHERE id = ?', [userId])) || { id: userId, displayName: 'Бывший участник', photoUrl: null });
    return people.get(userId);
  };
  const reactionRows = rows.length
    ? await db.all(`SELECT message_id, user_id, emoji FROM chat_group_reactions WHERE group_id = ? AND message_id IN (${rows.map(() => '?').join(',')})`, [group.id, ...rows.map(r => r.id)])
    : [];
  const reactions = new Map();
  for (const r of reactionRows) {
    const list = reactions.get(r.message_id) || {};
    list[r.emoji] = list[r.emoji] || { emoji: r.emoji, count: 0, mine: false };
    list[r.emoji].count += 1;
    if (r.user_id === meId) list[r.emoji].mine = true;
    reactions.set(r.message_id, list);
  }
  const quote = async (id) => {
    const r = id && byId.get(id);
    if (!r) return null;
    const s = await senderOf(r.sender_id);
    return { id: r.id, senderName: s.displayName, text: shortText(r), kind: r.deleted_at ? 'text' : r.kind };
  };

  const messages = [];
  for (const r of rows) {
    const s = await senderOf(r.sender_id);
    const deleted = Boolean(r.deleted_at);
    messages.push({
      id: r.id,
      kind: deleted ? 'text' : (r.kind || 'text'),
      text: deleted ? '' : (r.kind && r.kind !== 'text' ? '' : r.text),
      deleted,
      fileId: deleted ? null : (r.file_id || null),
      seconds: r.seconds ? Number(r.seconds) : null,
      mine: r.sender_id === meId,
      sender: { id: s.id, displayName: s.displayName, photoUrl: s.photoUrl },
      replyTo: await quote(r.reply_to),
      reactions: Object.values(reactions.get(r.id) || {}),
      createdAt: toIso(r.created_at)
    });
  }
  // Read: the next new message is news again (notified_at is cleared)
  await db.run('UPDATE chat_group_members SET read_at = ?, notified_at = NULL WHERE group_id = ? AND user_id = ?', [sqlTime(), group.id, meId]);
  return {
    group: info,
    members,
    messages,
    pinned: await quote(group.pinned_message_id),
    canWrite: true,
    reactions: REACTIONS,
    summaryAvailable: siEngine.isConfigured()
  };
}

// What a file really is, by its own first bytes (never by what the phone says)
function detectFile(kind, buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return null;
  if (kind === 'photo') return detectImageType(buffer);
  if (kind === 'voice') {
    const type = detectAudioType(buffer);
    return type && type.mime;
  }
  if (kind === 'video') {
    if (buffer.length < 12) return null;
    if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return 'video/webm';
    if (buffer.slice(4, 8).toString('ascii') === 'ftyp') return 'video/mp4';
  }
  return null;
}

/**
 * Sends a message to the group: text, or a file (voice / photo / video), maybe as a reply.
 * The other members get one notification per unread run, unless they turned «Без звука» on.
 */
async function send(meId, groupId, rawText, file = null, replyTo = null) {
  const { group } = await requireMember(meId, groupId);
  const kind = file ? file.kind : 'text';
  if (file && !FILES[kind]) throw new GroupError('Неизвестный тип файла', 400, 'BAD_KIND');
  const text = file ? FILES[kind].label : String(rawText || '').trim().slice(0, MAX_TEXT);
  if (!text) throw new GroupError('Сообщение не может быть пустым', 400, 'EMPTY');
  let mime = null;
  let seconds = null;
  if (file) {
    const rule = FILES[kind];
    if (!Buffer.isBuffer(file.buffer) || !file.buffer.length) throw new GroupError('Файл не получен. Попробуйте ещё раз.', 400, 'EMPTY_FILE');
    if (file.buffer.length > rule.maxBytes) throw new GroupError('Файл слишком большой.', 413, 'FILE_TOO_LARGE');
    mime = detectFile(kind, file.buffer);
    if (!mime) throw new GroupError(kind === 'photo' ? 'Это не фото (подходят JPEG, PNG, WebP).' : 'Не получилось прочитать запись. Попробуйте ещё раз.', 400, 'INVALID_FILE');
    if (rule.maxSeconds) seconds = Math.max(1, Math.min(rule.maxSeconds, parseInt(file.seconds, 10) || 1));
    const today = await db.get('SELECT COUNT(*) AS n FROM chat_group_files WHERE sender_id = ? AND created_at >= ?', [meId, dayAgo()]);
    if (Number(today.n) >= FILES_PER_DAY) throw new GroupError('На сегодня файлов достаточно — продолжите завтра 🙂', 429, 'FILES_LIMIT');
  }
  let reply = null;
  if (replyTo) {
    reply = await db.get('SELECT id FROM chat_group_messages WHERE id = ? AND group_id = ?', [String(replyTo), group.id]);
  }

  const now = sqlTime();
  const id = newMessageId();
  let fileId = null;
  if (file) {
    fileId = newId('grf');
    await db.run(
      'INSERT INTO chat_group_files (id, group_id, sender_id, mime_type, size_bytes, data_base64, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [fileId, group.id, meId, mime, file.buffer.length, file.buffer.toString('base64'), now]
    );
  }
  await db.run(
    'INSERT INTO chat_group_messages (id, group_id, sender_id, text, kind, file_id, seconds, reply_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, group.id, meId, text, kind, fileId, seconds, reply ? reply.id : null, now]
  );
  await db.run(
    'UPDATE chat_groups SET last_message = ?, last_sender = ?, last_activity = ?, changed_at = ? WHERE id = ?',
    [text.slice(0, 200), meId, now, now, group.id]
  );
  await db.run('UPDATE chat_group_members SET read_at = ?, notified_at = NULL WHERE group_id = ? AND user_id = ?', [now, group.id, meId]);
  analytics.capture('group_message', meId, { kind, reply: Boolean(reply) });

  // One notification per unread run: told already (notified_at) and has not opened the group since → quiet
  const me = personOf(await db.get('SELECT * FROM users WHERE id = ?', [meId]));
  const others = await db.all(
    `SELECT user_id, read_at, notified_at FROM chat_group_members WHERE group_id = ? AND status = 'active' AND user_id <> ? AND muted = 0`,
    [group.id, meId]
  );
  for (const m of others) {
    if (m.notified_at) continue;
    await db.run('UPDATE chat_group_members SET notified_at = ? WHERE group_id = ? AND user_id = ?', [now, group.id, m.user_id]);
    await notifyService.notifyUser(
      m.user_id,
      { ru: `👥 «${group.name}»: новое сообщение от ${me.displayName}.`, en: `👥 «${group.name}»: a new message from ${me.displayName}.` },
      { buttonText: { ru: 'Открыть', en: 'Open' }, startParam: `G_${group.id}` }
    );
  }
  return { messageId: id };
}

/**
 * A file of the group — only for its active members.
 */
async function fileOf(meId, groupId, fileId) {
  const group = await groupById(groupId);
  const member = group ? await memberOf(group.id, meId) : null;
  if (!member || member.status !== 'active') return null;
  const row = await db.get('SELECT * FROM chat_group_files WHERE id = ? AND group_id = ?', [String(fileId || ''), group.id]);
  return row ? { mimeType: row.mime_type, buffer: Buffer.from(row.data_base64, 'base64') } : null;
}

/**
 * A reaction on a message (emoji from REACTIONS); the same emoji again takes it back.
 * The author is told in Buddy; on the phone at most once an hour (reactions come in bursts).
 */
async function react(meId, groupId, messageId, emoji) {
  const { group } = await requireMember(meId, groupId);
  const msg = await db.get('SELECT * FROM chat_group_messages WHERE id = ? AND group_id = ?', [String(messageId || ''), group.id]);
  if (!msg || msg.deleted_at) throw new GroupError('Сообщение не найдено', 404, 'NOT_FOUND');
  if (!REACTIONS.includes(emoji)) throw new GroupError('Такой реакции нет', 400, 'BAD_REACTION');
  const existing = await db.get('SELECT emoji FROM chat_group_reactions WHERE message_id = ? AND user_id = ?', [msg.id, meId]);
  if (existing && existing.emoji === emoji) {
    await db.run('DELETE FROM chat_group_reactions WHERE message_id = ? AND user_id = ?', [msg.id, meId]);
    await touch(group.id);
    return { reacted: null };
  }
  if (existing) {
    await db.run('UPDATE chat_group_reactions SET emoji = ?, created_at = ? WHERE message_id = ? AND user_id = ?', [emoji, sqlTime(), msg.id, meId]);
  } else {
    await db.run('INSERT INTO chat_group_reactions (message_id, user_id, group_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)', [msg.id, meId, group.id, emoji, sqlTime()]);
  }
  await touch(group.id);
  analytics.capture('group_reaction', meId, { emoji });

  // A first reaction of this person on this message is news for the author (a change is not)
  if (!existing && msg.sender_id !== meId) {
    const author = await memberOf(group.id, msg.sender_id);
    if (author && author.status === 'active') {
      const me = personOf(await db.get('SELECT * FROM users WHERE id = ?', [meId]));
      const recent = await db.get(
        `SELECT COUNT(*) AS n FROM chat_group_reactions r JOIN chat_group_messages m ON m.id = r.message_id
         WHERE m.sender_id = ? AND r.user_id <> ? AND r.created_at >= ?`,
        [msg.sender_id, msg.sender_id, sqlTime(new Date(Date.now() - 3600000))]
      );
      const quoted = msg.kind && msg.kind !== 'text' ? msg.text : `«${String(msg.text).slice(0, 60)}${String(msg.text).length > 60 ? '…' : ''}»`;
      await notifyService.notifyUser(
        msg.sender_id,
        { ru: `${emoji} ${me.displayName} — на ваше сообщение ${quoted} в группе «${group.name}».`, en: `${emoji} ${me.displayName} reacted to your message ${quoted} in «${group.name}».` },
        { buttonText: { ru: 'Открыть', en: 'Open' }, startParam: `G_${group.id}`, phone: Number(recent.n) <= 1 }
      );
    }
  }
  return { reacted: emoji };
}

/**
 * Deletes a message: its author, or the owner / an admin. The text and the file are erased.
 */
async function removeMessage(meId, groupId, messageId) {
  const { group, member } = await requireMember(meId, groupId);
  const msg = await db.get('SELECT * FROM chat_group_messages WHERE id = ? AND group_id = ?', [String(messageId || ''), group.id]);
  if (!msg || msg.deleted_at) throw new GroupError('Сообщение не найдено', 404, 'NOT_FOUND');
  if (msg.sender_id !== meId && !['owner', 'admin'].includes(member.role)) throw new GroupError('Удалить чужое сообщение может только создатель или админ', 403, 'NOT_ADMIN');
  await db.run(`UPDATE chat_group_messages SET deleted_at = ?, text = '' WHERE id = ?`, [sqlTime(), msg.id]);
  if (msg.file_id) await db.run('DELETE FROM chat_group_files WHERE id = ?', [msg.file_id]);
  await db.run('DELETE FROM chat_group_reactions WHERE message_id = ?', [msg.id]);
  if (group.pinned_message_id === msg.id) await db.run('UPDATE chat_groups SET pinned_message_id = NULL WHERE id = ?', [group.id]);
  const last = await db.get('SELECT * FROM chat_group_messages WHERE group_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', [group.id]);
  if (last && last.id === msg.id) await db.run(`UPDATE chat_groups SET last_message = 'Сообщение удалено' WHERE id = ?`, [group.id]);
  await touch(group.id);
  return { removed: true };
}

/**
 * Pins a message (or unpins with null): the owner or an admin.
 */
async function pin(meId, groupId, messageId) {
  const { group } = await requireAdmin(meId, groupId);
  let id = null;
  if (messageId) {
    const msg = await db.get('SELECT id, deleted_at FROM chat_group_messages WHERE id = ? AND group_id = ?', [String(messageId), group.id]);
    if (!msg || msg.deleted_at) throw new GroupError('Сообщение не найдено', 404, 'NOT_FOUND');
    id = msg.id;
  }
  await db.run('UPDATE chat_groups SET pinned_message_id = ? WHERE id = ?', [id, group.id]);
  await touch(group.id);
  return { pinned: id };
}

// ---------- Settings and members ----------
async function rename(meId, groupId, name) {
  const { group } = await requireAdmin(meId, groupId);
  await db.run('UPDATE chat_groups SET name = ? WHERE id = ?', [cleanName(name), group.id]);
  await touch(group.id);
  return { renamed: true };
}

async function setPhoto(meId, groupId, buffer) {
  const { group } = await requireAdmin(meId, groupId);
  const saved = await mediaService.saveImage(meId, buffer, 'group_photo');
  await db.run('UPDATE chat_groups SET photo_media_id = ? WHERE id = ?', [saved.id, group.id]);
  if (group.photo_media_id) await mediaService.deleteImage(group.photo_media_id);
  await touch(group.id);
  return { photoUrl: saved.url };
}

async function setMuted(meId, groupId, muted) {
  const { group } = await requireMember(meId, groupId);
  await db.run('UPDATE chat_group_members SET muted = ? WHERE group_id = ? AND user_id = ?', [muted ? 1 : 0, group.id, meId]);
  return { muted: Boolean(muted) };
}

/**
 * The owner names an admin (up to MAX_ADMINS) or takes the role back.
 */
async function setRole(meId, groupId, userId, role) {
  const { group, member } = await requireMember(meId, groupId);
  if (member.role !== 'owner') throw new GroupError('Админов назначает только создатель группы', 403, 'NOT_OWNER');
  if (!['admin', 'member'].includes(role)) throw new GroupError('Неизвестная роль', 400, 'BAD_ROLE');
  const target = await memberOf(group.id, String(userId || ''));
  if (!target || target.status !== 'active' || target.role === 'owner') throw new GroupError('Участник не найден', 404, 'NOT_FOUND');
  if (role === 'admin' && target.role !== 'admin') {
    const admins = await db.get(`SELECT COUNT(*) AS n FROM chat_group_members WHERE group_id = ? AND role = 'admin' AND status = 'active'`, [group.id]);
    if (Number(admins.n) >= MAX_ADMINS) throw new GroupError(`Админов может быть не больше ${MAX_ADMINS}`, 409, 'ADMINS_LIMIT');
  }
  await db.run('UPDATE chat_group_members SET role = ? WHERE group_id = ? AND user_id = ?', [role, group.id, target.user_id]);
  await touch(group.id);
  return { role };
}

/**
 * Removes a person (or cancels an invitation). The owner removes anyone, an admin — only members.
 */
async function removeMember(meId, groupId, userId) {
  const { group, member } = await requireAdmin(meId, groupId);
  const target = await memberOf(group.id, String(userId || ''));
  if (!target || !['active', 'invited'].includes(target.status) || target.user_id === meId) throw new GroupError('Участник не найден', 404, 'NOT_FOUND');
  if (target.role === 'owner' || (target.role === 'admin' && member.role !== 'owner')) throw new GroupError('Админа может удалить только создатель группы', 403, 'NOT_OWNER');
  if (target.status === 'invited') {
    await db.run('DELETE FROM chat_group_members WHERE group_id = ? AND user_id = ?', [group.id, target.user_id]);
  } else {
    await db.run(`UPDATE chat_group_members SET status = 'removed', role = 'member' WHERE group_id = ? AND user_id = ?`, [group.id, target.user_id]);
  }
  await touch(group.id);
  return { removed: true };
}

/**
 * Leaving a group. The owner's role goes to an admin (or the longest member); the last one out
 * leaves an empty group that nobody sees.
 */
async function leave(meId, groupId) {
  const { group, member } = await requireMember(meId, groupId);
  await db.run('DELETE FROM chat_group_members WHERE group_id = ? AND user_id = ?', [group.id, meId]);
  if (member.role === 'owner') {
    const next = await db.get(
      `SELECT user_id FROM chat_group_members WHERE group_id = ? AND status = 'active'
       ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, joined_at LIMIT 1`,
      [group.id]
    );
    if (next) {
      await db.run(`UPDATE chat_group_members SET role = 'owner' WHERE group_id = ? AND user_id = ?`, [group.id, next.user_id]);
      await db.run('UPDATE chat_groups SET owner_id = ? WHERE id = ?', [next.user_id, group.id]);
    }
  }
  await touch(group.id);
  return { left: true };
}

/**
 * «Пожаловаться»: the team gets the complaint with the last messages of the group (the only way the
 * team sees a group). With messageId — about one message.
 */
async function report(meId, groupId, messageId, reason) {
  const { group } = await requireMember(meId, groupId);
  const rows = (await db.all('SELECT * FROM chat_group_messages WHERE group_id = ? ORDER BY created_at DESC, id DESC LIMIT 20', [group.id])).reverse();
  const names = new Map();
  const nameOf = async (id) => {
    if (!names.has(id)) {
      const u = await db.get('SELECT * FROM users WHERE id = ?', [id]);
      names.set(id, u ? `${personOf(u).displayName}${u.support_code ? ` (${u.support_code})` : ''}` : id);
    }
    return names.get(id);
  };
  const lines = [];
  for (const r of rows) {
    const body = r.deleted_at ? '[удалено]' : r.kind && r.kind !== 'text' ? `[${r.text}]` : r.text;
    lines.push(`${r.id === messageId ? '👉 ' : ''}${r.sender_id === meId ? 'Я' : await nameOf(r.sender_id)}: ${String(body).slice(0, 200)}`);
  }
  let text = `Жалоба на группу «${group.name}»${messageId ? ' (сообщение отмечено 👉)' : ''}.`;
  const why = String(reason || '').trim().slice(0, 300);
  if (why) text += `\nПричина: ${why}`;
  text += `\n\nПоследние сообщения:\n${lines.join('\n')}`;
  const id = `fb_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await db.run('INSERT INTO feedback (id, user_id, text, context) VALUES (?, ?, ?, ?)', [
    id, meId, text.slice(0, 4000), JSON.stringify({ screen: 'chats/group', groupId: group.id, messageId: messageId || null })
  ]);
  await supportService.notifyStaffAboutFeedback(id);
  return { reported: true };
}

// ---------- «Кратко» by SI ----------
/**
 * A short summary of the conversation: since my last visit if there is enough new, otherwise the
 * last messages. Only texts (a voice or a photo is mentioned as such). Daily limit per person.
 */
async function summary(meId, groupId, since = null) {
  const { group } = await requireMember(meId, groupId);
  if (!siEngine.isConfigured()) throw new GroupError('Краткое содержание пока недоступно', 503, 'NO_SI');
  const today = await db.get('SELECT COUNT(*) AS n FROM chat_group_summaries WHERE user_id = ? AND created_at >= ?', [meId, dayAgo()]);
  if (Number(today.n) >= SUMMARIES_PER_DAY) throw new GroupError('На сегодня кратких содержаний достаточно — продолжите завтра 🙂', 429, 'SUMMARY_LIMIT');
  let rows = [];
  const sinceIso = toIso(since);
  if (sinceIso) {
    rows = await db.all(
      'SELECT * FROM chat_group_messages WHERE group_id = ? AND deleted_at IS NULL AND created_at > ? ORDER BY created_at, id LIMIT ?',
      [group.id, sqlTime(new Date(sinceIso)), SUMMARY_MESSAGES]
    );
  }
  if (rows.length < SUMMARY_MIN_MESSAGES) {
    rows = (await db.all(
      'SELECT * FROM chat_group_messages WHERE group_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT ?',
      [group.id, SUMMARY_MESSAGES]
    )).reverse();
  }
  if (rows.length < SUMMARY_MIN_MESSAGES) throw new GroupError('Пока мало сообщений — прочитайте сами 🙂', 409, 'TOO_FEW');
  const names = new Map();
  const lines = [];
  for (const r of rows) {
    if (!names.has(r.sender_id)) names.set(r.sender_id, (personOf(await db.get('SELECT * FROM users WHERE id = ?', [r.sender_id])) || {}).displayName || 'Участник');
    lines.push(`${names.get(r.sender_id)}: ${r.kind && r.kind !== 'text' ? `[${r.text}]` : String(r.text).slice(0, 500)}`);
  }
  const me = await db.get('SELECT lang, tg_lang FROM users WHERE id = ?', [meId]);
  const english = (me && (me.lang || '').startsWith('en'));
  const prompt = [
    {
      role: 'system',
      content: `Ты делаешь краткое содержание переписки группы «${group.name}» для участника, который пропустил разговор. ` +
        'Пиши 3–6 коротких пунктов: о чём говорили, что решили, кто что спросил или пообещал, что ждёт ответа. ' +
        'Только то, что есть в сообщениях, ничего не додумывай и не давай советов. Имена — как в переписке. ' +
        `Без вступлений и заголовков. Язык: ${english ? 'английский' : 'русский'}.`
    },
    { role: 'user', content: lines.join('\n').slice(0, 30000) }
  ];
  const text = await siEngine.callOpenAI(prompt, { model: config.buddyModel });
  if (!text) throw new GroupError('Не получилось сделать краткое содержание. Попробуйте ещё раз', 502, 'SI_FAILED');
  await db.run('INSERT INTO chat_group_summaries (id, group_id, user_id, created_at) VALUES (?, ?, ?, ?)', [newId('grs'), group.id, meId, sqlTime()]);
  analytics.capture('group_summary', meId, { messages: rows.length });
  return { summary: text, messages: rows.length };
}

module.exports = {
  GroupError,
  MAX_MEMBERS,
  MAX_ADMINS,
  REACTIONS,
  create,
  invite,
  answerInvite,
  preview,
  joinByCode,
  myGroups,
  conversation,
  send,
  fileOf,
  react,
  removeMessage,
  pin,
  rename,
  setPhoto,
  setMuted,
  setRole,
  removeMember,
  leave,
  report,
  summary
};
