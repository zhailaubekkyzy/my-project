// server/routes/admin.js - Support panel: complaints, people, errors, ready-made fixes, the team.
// Only the owner (ADMIN_USERS in Railway) and the support team she added. Everything that changes
// data or looks into someone's chat is written to admin_actions.
const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const migrator = require('../db/migrator');
const { requireStaff } = require('../middleware/staff');
const supportService = require('../services/support-service');
const supportFixes = require('../services/support-fixes');
const telegramBot = require('../services/telegram-bot');
const siEngine = require('../services/si-engine');
const { mediaUrl } = require('../services/media-service');

const { parseJson, displayNameOf } = supportService;
const FEEDBACK_STATUSES = ['new', 'in_progress', 'done'];

router.use(requireStaff('support'));

function personSummary(row) {
  return {
    id: row.id,
    supportCode: row.support_code || null,
    displayName: displayNameOf(row),
    telegramName: row.display_name,
    username: row.username || null,
    photoUrl: mediaUrl(row.photo_media_id) || row.avatar_url || null,
    status: row.status,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at || null
  };
}

// ---------------------------------------------------------------
// Overview: what needs attention + system state
// ---------------------------------------------------------------
router.get('/overview', async (req, res, next) => {
  try {
    const count = async (sql, params = []) => Number((await db.get(sql, params)).count) || 0;
    const { activeDriver } = db.getDatabase();
    const warnings = [];
    if (!siEngine.isConfigured()) warnings.push('Сервер не видит ключ OpenAI: SI отвечает шаблоном. Railway → Variables → OPENAI_API_KEY.');
    if (!config.telegramBotToken) warnings.push('Нет TELEGRAM_BOT_TOKEN: вход и уведомления бота не работают.');
    if (config.isProd && activeDriver !== 'postgres') warnings.push('Сервер работает НЕ на Supabase (DB_DRIVER). Данные могут пропасть при перезапуске!');
    if (!(await supportService.ownerUserIds()).length) warnings.push('ADMIN_USERS не задан или номер не найден.');

    res.json({
      me: { userId: req.staff.userId, role: req.staff.role, roleLabel: supportService.ROLE_LABELS[req.staff.role] },
      feedback: {
        new: await count(`SELECT COUNT(*) AS count FROM feedback WHERE status = 'new'`),
        inProgress: await count(`SELECT COUNT(*) AS count FROM feedback WHERE status = 'in_progress'`)
      },
      errors24h: await count('SELECT COUNT(*) AS count FROM error_log WHERE created_at >= ?', [supportService.hoursAgo(24)]),
      users: {
        total: await count('SELECT COUNT(*) AS count FROM users WHERE is_demo = 0'),
        new24h: await count('SELECT COUNT(*) AS count FROM users WHERE is_demo = 0 AND created_at >= ?', [supportService.hoursAgo(24)])
      },
      system: {
        commit: (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7) || null,
        environment: config.nodeEnv,
        database: activeDriver,
        migrations: (await migrator.getAppliedMigrations()).length,
        openai: siEngine.isConfigured(),
        openaiModel: config.openaiModel,
        bot: Boolean(config.telegramBotToken),
        warnings
      }
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// Complaints
// ---------------------------------------------------------------
const FEEDBACK_SQL = `
  SELECT f.*, u.display_name, u.profile, u.username, u.support_code, u.photo_media_id, u.avatar_url, u.status AS user_status,
         u.created_at AS user_created_at, u.last_seen_at, r.display_name AS replied_by_name
  FROM feedback f
  JOIN users u ON u.id = f.user_id
  LEFT JOIN users r ON r.id = f.replied_by`;

function toFeedback(row) {
  return {
    id: row.id,
    text: row.text,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
    context: parseJson(row.context, null),
    note: row.note || '',
    reply: row.reply || null,
    repliedAt: row.replied_at || null,
    repliedBy: row.replied_by_name || null,
    user: personSummary({ ...row, id: row.user_id, status: row.user_status, created_at: row.user_created_at })
  };
}

router.get('/feedback', async (req, res, next) => {
  try {
    const status = FEEDBACK_STATUSES.includes(req.query.status) ? req.query.status : null;
    const rows = await db.all(
      `${FEEDBACK_SQL} ${status ? 'WHERE f.status = ?' : ''} ORDER BY f.created_at DESC LIMIT 200`,
      status ? [status] : []
    );
    res.json({ feedback: rows.map(toFeedback) });
  } catch (err) {
    next(err);
  }
});

router.get('/feedback/:id', async (req, res, next) => {
  try {
    const row = await db.get(`${FEEDBACK_SQL} WHERE f.id = ?`, [req.params.id]);
    if (!row) return res.status(404).json({ error: 'not_found', message: 'Жалоба не найдена' });
    res.json({ feedback: toFeedback(row) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/feedback/:id  { status?, note? }
 */
router.post('/feedback/:id', async (req, res, next) => {
  try {
    const fb = await db.get('SELECT * FROM feedback WHERE id = ?', [req.params.id]);
    if (!fb) return res.status(404).json({ error: 'not_found', message: 'Жалоба не найдена' });
    const status = FEEDBACK_STATUSES.includes(req.body?.status) ? req.body.status : fb.status;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 2000) : (fb.note || '');
    await db.run('UPDATE feedback SET status = ?, note = ?, updated_at = ? WHERE id = ?', [status, note, supportService.sqlTime(), fb.id]);
    await supportService.logAction(req.staff.userId, fb.user_id, 'feedback:update', { feedbackId: fb.id, status: { before: fb.status, after: status }, noteChanged: note !== (fb.note || '') });
    const row = await db.get(`${FEEDBACK_SQL} WHERE f.id = ?`, [fb.id]);
    res.json({ feedback: toFeedback(row) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/feedback/:id/reply  { text, close }
 * The answer is shown in the person's "Поддержка" chat; the bot also sends it to Telegram.
 */
router.post('/feedback/:id/reply', async (req, res, next) => {
  try {
    const fb = await db.get('SELECT * FROM feedback WHERE id = ?', [req.params.id]);
    if (!fb) return res.status(404).json({ error: 'not_found', message: 'Жалоба не найдена' });
    const text = String(req.body?.text || '').trim().slice(0, 2000);
    if (!text) return res.status(400).json({ error: 'bad_request', message: 'Напишите ответ' });
    const status = req.body?.close ? 'done' : 'in_progress';
    const now = supportService.sqlTime();
    await db.run(
      'UPDATE feedback SET reply = ?, replied_at = ?, replied_by = ?, status = ?, updated_at = ? WHERE id = ?',
      [text, now, req.staff.userId, status, now, fb.id]
    );
    const notified = await telegramBot.notifyUser(fb.user_id, `💬 Ответ поддержки SmartFlow:\n\n${text}`, { buttonText: 'Открыть поддержку', startParam: 'S_support' });
    await supportService.logAction(req.staff.userId, fb.user_id, 'feedback:reply', { feedbackId: fb.id, text, status, notified });
    const row = await db.get(`${FEEDBACK_SQL} WHERE f.id = ?`, [fb.id]);
    res.json({ feedback: toFeedback(row), notified });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// People
// ---------------------------------------------------------------
/**
 * GET /api/admin/users?q=  — by number SF-48213, usr_..., Telegram id, @username or name
 */
router.get('/users', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 100);
    let rows;
    const supportCode = supportService.normalizeSupportCode(q);
    if (!q) {
      rows = await db.all('SELECT * FROM users WHERE is_demo = 0 ORDER BY COALESCE(last_seen_at, created_at) DESC LIMIT 30');
    } else if (supportCode && /^(sf|\d{5}$)/i.test(q)) {
      rows = await db.all('SELECT * FROM users WHERE support_code = ?', [supportCode]);
    } else if (/^(usr|user)_/.test(q)) {
      rows = await db.all('SELECT * FROM users WHERE id = ?', [q]);
    } else if (/^\d{5,}$/.test(q)) {
      rows = await db.all(
        `SELECT u.* FROM users u JOIN auth_identities a ON a.user_id = u.id WHERE a.provider = 'telegram' AND a.provider_user_id = ?`, [q]
      );
    } else {
      const like = `%${q.replace(/^@/, '').toLowerCase().replace(/[\\%_]/g, ch => `\\${ch}`)}%`;
      rows = await db.all(
        `SELECT * FROM users WHERE LOWER(COALESCE(username, '')) LIKE ? ESCAPE '\\' OR LOWER(display_name) LIKE ? ESCAPE '\\'
           OR LOWER(COALESCE(profile, '')) LIKE ? ESCAPE '\\'
         ORDER BY COALESCE(last_seen_at, created_at) DESC LIMIT 30`,
        [like, like, like]
      );
    }
    res.json({ users: rows.map(personSummary) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/users/:id — everything about one person, for finding the cause of a problem
 */
router.get('/users/:id', async (req, res, next) => {
  try {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'not_found', message: 'Человек не найден' });
    const profile = parseJson(user.profile, {}) || {};

    const projects = await db.all('SELECT * FROM projects WHERE owner_id = ? ORDER BY created_at DESC', [user.id]);
    const consultants = [];
    for (const p of projects) {
      const stats = await db.get(
        `SELECT COUNT(*) AS clients, SUM(CASE WHEN status = 'human_needed' THEN 1 ELSE 0 END) AS paused FROM clients WHERE project_id = ?`, [p.id]
      );
      const waiting = await db.get(`SELECT COUNT(*) AS count FROM direct_inquiries WHERE project_id = ? AND status = 'waiting'`, [p.id]);
      const settings = parseJson(p.custom_ai_settings, {}) || {};
      consultants.push({
        id: p.id,
        name: p.name,
        slug: p.slug,
        roleTitle: p.role_title || 'SI-консультант',
        status: p.status,
        isListed: Boolean(p.is_listed),
        isDemo: Boolean(p.is_demo),
        photoUrl: mediaUrl(p.photo_media_id),
        hasOffer: Boolean((p.offer || '').trim()),
        priceLabel: p.price_label || '',
        paymentUrl: p.payment_url || '',
        clientLimit: Number(settings.clientLimit) || 40,
        clients: Number(stats.clients) || 0,
        siPaused: Number(stats.paused) || 0,
        waitingInquiries: Number(waiting.count) || 0,
        link: telegramBot.miniAppLink(p.slug)
      });
    }

    const materials = await db.all(
      `SELECT m.id, m.title, m.source_type, m.char_count, m.chunk_count, m.created_at,
              (SELECT COUNT(*) FROM brain_chunks c WHERE c.material_id = m.id AND c.embedding IS NULL) AS pending,
              (SELECT COUNT(*) FROM consultant_materials cm WHERE cm.material_id = m.id) AS consultants
       FROM brain_materials m WHERE m.owner_id = ? ORDER BY m.created_at DESC`, [user.id]
    );

    const chatsAsClient = await db.all(
      `SELECT c.id, c.status, c.last_activity, p.name AS project_name, p.slug, p.status AS project_status,
              (SELECT COUNT(*) FROM conversations m WHERE m.client_id = c.id) AS messages
       FROM clients c JOIN projects p ON p.id = c.project_id
       WHERE c.external_client_id = ? ORDER BY c.last_activity DESC LIMIT 50`, [user.id]
    );

    // The expert's clients: paused SI first (most common complaint), then the latest
    const myClients = projects.length ? await db.all(
      `SELECT c.id, c.name, c.username, c.status, c.last_activity, p.name AS project_name,
              (SELECT COUNT(*) FROM conversations m WHERE m.client_id = c.id) AS messages
       FROM clients c JOIN projects p ON p.id = c.project_id
       WHERE p.owner_id = ? ORDER BY CASE WHEN c.status = 'human_needed' THEN 0 ELSE 1 END, c.last_activity DESC LIMIT 30`, [user.id]
    ) : [];

    const feedback = await db.all('SELECT id, text, status, created_at, reply FROM feedback WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', [user.id]);
    const errors = await db.all('SELECT * FROM error_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 30', [user.id]);
    const actions = await db.all(
      `SELECT a.*, s.display_name AS staff_name FROM admin_actions a LEFT JOIN users s ON s.id = a.staff_user_id
       WHERE a.target_user_id = ? ORDER BY a.created_at DESC LIMIT 30`, [user.id]
    );

    res.json({
      user: {
        ...personSummary(user),
        telegramId: await supportService.telegramIdOf(user.id),
        botCanWrite: user.telegram_write_allowed === null || user.telegram_write_allowed === undefined ? null : Boolean(user.telegram_write_allowed),
        clientResetAt: user.client_reset_at || null,
        hasUploadedPhoto: Boolean(user.photo_media_id),
        customName: (profile.displayName || '').trim() || null,
        headline: profile.headline || '',
        businessAgreedAt: profile.businessAgreedAt || null,
        isDemo: Boolean(user.is_demo),
        staffRole: await supportService.staffRoleOf(user.id)
      },
      consultants,
      materials: materials.map(m => ({
        id: m.id, title: m.title, sourceType: m.source_type, chars: Number(m.char_count) || 0,
        chunks: Number(m.chunk_count) || 0, pending: Number(m.pending) || 0, consultants: Number(m.consultants) || 0, createdAt: m.created_at
      })),
      chatsAsClient: chatsAsClient.map(c => ({
        clientId: c.id, consultantName: c.project_name, slug: c.slug, consultantActive: c.project_status === 'active',
        siPaused: c.status === 'human_needed', messages: Number(c.messages) || 0, lastActivity: c.last_activity
      })),
      myClients: myClients.map(c => ({
        clientId: c.id, name: c.name, username: c.username, consultantName: c.project_name,
        siPaused: c.status === 'human_needed', messages: Number(c.messages) || 0, lastActivity: c.last_activity
      })),
      feedback: feedback.map(f => ({ id: f.id, text: f.text, status: f.status, createdAt: f.created_at, replied: Boolean(f.reply) })),
      errors: errors.map(toError),
      actions: actions.map(toAction)
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/users/:id/chats/:clientId — read one chat of this person (written to the log)
 */
router.get('/users/:id/chats/:clientId', async (req, res, next) => {
  try {
    const chat = await db.get(
      `SELECT c.*, p.name AS project_name, p.owner_id FROM clients c JOIN projects p ON p.id = c.project_id
       WHERE c.id = ? AND (c.external_client_id = ? OR p.owner_id = ?)`,
      [req.params.clientId, req.params.id, req.params.id]
    );
    if (!chat) return res.status(404).json({ error: 'not_found', message: 'Чат не найден у этого человека' });
    const messages = await db.all(
      'SELECT id, sender, text, created_at FROM conversations WHERE client_id = ? ORDER BY created_at DESC, id DESC LIMIT 200', [chat.id]
    );
    await supportService.logAction(req.staff.userId, req.params.id, 'view_chat', { clientId: chat.id, consultant: chat.project_name });
    res.json({
      chat: { clientId: chat.id, consultantName: chat.project_name, clientName: chat.name, siPaused: chat.status === 'human_needed' },
      messages: messages.reverse().map(m => ({ id: m.id, sender: m.sender, text: m.text, createdAt: m.created_at }))
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/users/:id/message  { text } — the bot writes to the person in Telegram
 */
router.post('/users/:id/message', async (req, res, next) => {
  try {
    const user = await db.get('SELECT id FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'not_found', message: 'Человек не найден' });
    const text = String(req.body?.text || '').trim().slice(0, 2000);
    if (!text) return res.status(400).json({ error: 'bad_request', message: 'Напишите сообщение' });
    const notified = await telegramBot.notifyUser(user.id, `💬 Поддержка SmartFlow:\n\n${text}`, { buttonText: 'Открыть SmartFlow' });
    await supportService.logAction(req.staff.userId, user.id, 'message', { text, notified });
    res.json({ notified });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// Ready-made fixes for one person
// ---------------------------------------------------------------
router.get('/fixes', (req, res) => {
  res.json({ fixes: supportFixes.listFixes(req.staff.role) });
});

function fixErrorResponse(res, err, next) {
  if (err instanceof supportFixes.FixError) {
    return res.status(err.status).json({ error: 'fix_refused', code: err.code, message: err.message });
  }
  next(err);
}

router.post('/users/:id/fixes/:fixId/preview', async (req, res, next) => {
  try {
    res.json({ preview: await supportFixes.previewFix(req.params.fixId, req.params.id, req.body?.params, req.staff.role) });
  } catch (err) {
    fixErrorResponse(res, err, next);
  }
});

router.post('/users/:id/fixes/:fixId/apply', async (req, res, next) => {
  try {
    res.json({ result: await supportFixes.applyFix(req.params.fixId, req.params.id, req.body?.params, req.body?.expectedCount, req.staff) });
  } catch (err) {
    fixErrorResponse(res, err, next);
  }
});

// ---------------------------------------------------------------
// Errors (code from the screen → who, where, what)
// ---------------------------------------------------------------
function toError(row) {
  return {
    id: row.id,
    code: row.code,
    source: row.source,
    method: row.method,
    path: row.path,
    status: row.status,
    message: row.message,
    context: parseJson(row.context, null),
    createdAt: row.created_at,
    user: row.support_code !== undefined && row.user_id ? { id: row.user_id, supportCode: row.support_code, displayName: displayNameOf(row) } : null
  };
}

router.get('/errors', async (req, res, next) => {
  try {
    const code = supportService.normalizeErrorCode(req.query.code);
    const rows = await db.all(
      `SELECT e.*, u.support_code, u.display_name, u.profile FROM error_log e LEFT JOIN users u ON u.id = e.user_id
       ${code ? 'WHERE e.code = ?' : ''} ORDER BY e.created_at DESC LIMIT 100`,
      code ? [code] : []
    );
    res.json({ errors: rows.map(toError) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// What the team did
// ---------------------------------------------------------------
function toAction(row) {
  return {
    id: row.id,
    action: row.action,
    details: parseJson(row.details, {}),
    staffName: row.staff_name || row.staff_user_id,
    targetUserId: row.target_user_id,
    targetName: row.target_name || null,
    createdAt: row.created_at
  };
}

router.get('/actions', async (req, res, next) => {
  try {
    const rows = await db.all(
      `SELECT a.*, s.display_name AS staff_name, t.display_name AS target_name
       FROM admin_actions a LEFT JOIN users s ON s.id = a.staff_user_id LEFT JOIN users t ON t.id = a.target_user_id
       ORDER BY a.created_at DESC LIMIT 100`
    );
    res.json({ actions: rows.map(toAction) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// The team (owner only)
// ---------------------------------------------------------------
router.get('/staff', requireStaff('owner'), async (req, res, next) => {
  try {
    const owners = [];
    for (const id of await supportService.ownerUserIds()) {
      const u = await db.get('SELECT * FROM users WHERE id = ?', [id]);
      if (u) owners.push({ ...personSummary(u), role: 'owner', roleLabel: supportService.ROLE_LABELS.owner, fromSettings: true });
    }
    const rows = await db.all('SELECT u.*, s.role AS staff_role, s.created_at AS added_at FROM staff s JOIN users u ON u.id = s.user_id ORDER BY s.created_at');
    const team = rows.map(u => ({ ...personSummary(u), role: u.staff_role, roleLabel: supportService.ROLE_LABELS[u.staff_role] || u.staff_role, addedAt: u.added_at }));
    res.json({ staff: [...owners, ...team.filter(t => !owners.some(o => o.id === t.id))] });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/staff  { supportCode } — the person opens their Profile and dictates their number
 */
router.post('/staff', requireStaff('owner'), async (req, res, next) => {
  try {
    const code = supportService.normalizeSupportCode(req.body?.supportCode);
    const user = code ? await db.get('SELECT * FROM users WHERE support_code = ?', [code]) : null;
    if (!user) return res.status(404).json({ error: 'not_found', message: 'Человек с таким номером не найден. Номер — в его Профиле, вида SF-48213.' });
    await db.run(
      `INSERT INTO staff (user_id, role, added_by) VALUES (?, 'support', ?) ON CONFLICT (user_id) DO NOTHING`,
      [user.id, req.staff.userId]
    );
    await supportService.logAction(req.staff.userId, user.id, 'staff:add', { role: 'support' });
    res.status(201).json({ user: personSummary(user) });
  } catch (err) {
    next(err);
  }
});

router.delete('/staff/:userId', requireStaff('owner'), async (req, res, next) => {
  try {
    const result = await db.run('DELETE FROM staff WHERE user_id = ?', [req.params.userId]);
    if (!result.changes) return res.status(404).json({ error: 'not_found', message: 'Этого человека нет в команде (владелицу убирают в ADMIN_USERS в Railway).' });
    await supportService.logAction(req.staff.userId, req.params.userId, 'staff:remove', {});
    res.json({ removed: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
