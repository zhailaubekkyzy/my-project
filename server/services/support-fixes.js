// server/services/support-fixes.js - Ready-made fixes for ONE person, used from the support panel.
//
// Rules (CLAUDE.md, "Поддержка"):
//  - every fix touches only the records of the person whose card is open;
//  - first a preview: what changes, "было → станет" and how many records;
//  - apply re-checks the count: the team saw 1 record, now it is 300 → stop, nothing is changed;
//  - every applied fix is written to admin_actions (who, whom, what, before → after).
//
// To add a fix: one more entry in FIXES with plan() and apply(), and a button in js/screens/admin.js.
const db = require('../db');
const config = require('../config');
const brainService = require('./brain-service');
const mediaService = require('./media-service');
const supportService = require('./support-service');

class FixError extends Error {
  constructor(message, status = 400, code = 'FIX_REFUSED') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const parseJson = supportService.parseJson;
const yesNo = (v) => (v ? 'да' : 'нет');

async function ownProject(user, projectId) {
  const project = await db.get('SELECT * FROM projects WHERE id = ? AND owner_id = ?', [String(projectId || ''), user.id]);
  if (!project) throw new FixError('Этот SI-консультант не принадлежит этому человеку.', 404, 'NOT_THIS_USER');
  return project;
}

// A chat row of this person: they are the client (external id = their usr_...) or the expert
async function ownChat(user, clientId) {
  const client = await db.get(
    `SELECT c.*, p.name AS project_name, p.owner_id FROM clients c JOIN projects p ON p.id = c.project_id
     WHERE c.id = ? AND (c.external_client_id = ? OR p.owner_id = ?)`,
    [String(clientId || ''), user.id, user.id]
  );
  if (!client) throw new FixError('Этот чат не относится к этому человеку.', 404, 'NOT_THIS_USER');
  return client;
}

const FIXES = {
  reset_device: {
    title: 'Очистить данные на телефоне человека',
    help: 'Когда у человека «зависло», показывается старое или пропало то, что на сервере есть. Данные на сервере не трогаются: при следующем открытии приложение само очистит свой кэш и загрузит всё заново.',
    async plan(user) {
      return {
        count: 1,
        changes: [{ label: 'Кэш приложения на телефоне', before: user.client_reset_at ? `очищали ${user.client_reset_at}` : 'ни разу не очищали', after: 'очистится при следующем открытии' }]
      };
    },
    async apply(user) {
      await db.run('UPDATE users SET client_reset_at = ? WHERE id = ?', [new Date().toISOString(), user.id]);
    }
  },

  resume_si: {
    title: 'Включить SI обратно в чате',
    help: 'SI молчит в чате (после «Связаться с человеком» или ответа эксперта). Включает SI только в этом одном чате.',
    async plan(user, { clientId }) {
      const chat = await ownChat(user, clientId);
      const paused = chat.status === 'human_needed';
      return {
        count: paused ? 1 : 0,
        changes: [{ label: `SI в чате «${chat.project_name}» с ${chat.name}`, before: paused ? 'молчит (ждёт эксперта)' : 'уже отвечает', after: 'отвечает' }]
      };
    },
    async apply(user, { clientId }) {
      const chat = await ownChat(user, clientId);
      await db.run(`UPDATE clients SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'human_needed'`, [chat.id]);
      await db.run(`UPDATE direct_inquiries SET status = 'answered', updated_at = CURRENT_TIMESTAMP WHERE client_id = ? AND status = 'waiting'`, [chat.id]);
    }
  },

  reset_name: {
    title: 'Вернуть имя из Telegram',
    help: 'Имя в приложении сломалось или человек не может его поправить. Имя, выбранное в приложении, стирается — снова показывается имя из Telegram.',
    async plan(user) {
      const profile = parseJson(user.profile, {}) || {};
      const custom = (profile.displayName || '').trim();
      return {
        count: custom ? 1 : 0,
        changes: [{ label: 'Имя в приложении', before: custom || `(уже имя из Telegram: ${user.display_name})`, after: user.display_name }]
      };
    },
    async apply(user) {
      const profile = parseJson(user.profile, {}) || {};
      profile.displayName = '';
      await db.run('UPDATE users SET profile = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(profile), user.id]);
    }
  },

  remove_photo: {
    title: 'Удалить своё фото человека',
    help: 'Фото не грузится, сломано или неприемлемо. Вместо него будет фото из Telegram.',
    async plan(user) {
      return {
        count: user.photo_media_id ? 1 : 0,
        changes: [{ label: 'Фото профиля', before: user.photo_media_id ? 'загруженное фото' : '(своего фото нет)', after: user.avatar_url ? 'фото из Telegram' : 'без фото' }]
      };
    },
    async apply(user) {
      await db.run('UPDATE users SET photo_media_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
      await mediaService.deleteImage(user.photo_media_id);
    }
  },

  consultant_listing: {
    title: 'Показать / скрыть консультанта в Маркетплейсе',
    help: 'Жалоба на карточку (обман, неприемлемый текст) — скрыть. Владелец просит вернуть — показать. Ссылка консультанта продолжает работать.',
    async plan(user, { projectId, listed }) {
      const project = await ownProject(user, projectId);
      const want = Boolean(listed);
      return {
        count: Boolean(project.is_listed) === want ? 0 : 1,
        changes: [{ label: `«${project.name}» в Маркетплейсе`, before: project.is_listed ? 'показан' : 'скрыт', after: want ? 'показан' : 'скрыт' }]
      };
    },
    async apply(user, { projectId, listed }) {
      const project = await ownProject(user, projectId);
      await db.run('UPDATE projects SET is_listed = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [listed ? 1 : 0, project.id]);
    }
  },

  consultant_status: {
    title: 'Выключить / включить SI-консультанта',
    help: 'Выключенный консультант не отвечает и не открывается по ссылке (клиенты видят «не найден»). Для серьёзных жалоб. Переписки сохраняются.',
    async plan(user, { projectId, active }) {
      const project = await ownProject(user, projectId);
      const want = active ? 'active' : 'paused';
      return {
        count: project.status === want ? 0 : 1,
        changes: [{ label: `SI-консультант «${project.name}»`, before: project.status === 'active' ? 'включён' : 'выключен', after: active ? 'включён' : 'выключен' }]
      };
    },
    async apply(user, { projectId, active }) {
      const project = await ownProject(user, projectId);
      await db.run('UPDATE projects SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [active ? 'active' : 'paused', project.id]);
    }
  },

  consultant_remove_photo: {
    title: 'Удалить фото SI-консультанта',
    help: 'Фото консультанта сломано или неприемлемо. Будет стандартная картинка.',
    async plan(user, { projectId }) {
      const project = await ownProject(user, projectId);
      return {
        count: project.photo_media_id ? 1 : 0,
        changes: [{ label: `Фото «${project.name}»`, before: project.photo_media_id ? 'загруженное фото' : '(фото нет)', after: 'стандартная картинка' }]
      };
    },
    async apply(user, { projectId }) {
      const project = await ownProject(user, projectId);
      await db.run('UPDATE projects SET photo_media_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [project.id]);
      await mediaService.deleteImage(project.photo_media_id);
    }
  },

  brain_process: {
    title: 'Досчитать SI-мозг',
    help: 'SI плохо находит ответы в материалах: часть текста не обработана OpenAI (не было ключа или денег на счёте). Обрабатывает необработанные части этого эксперта.',
    maxCount: 5000,
    async plan(user) {
      const pending = await brainService.piecesWithoutMeaning(user.id);
      const plan = {
        count: pending.length,
        changes: [{ label: 'Необработанные части материалов', before: String(pending.length), after: pending.length > brainService.BACKFILL_LIMIT ? `меньше на ${brainService.BACKFILL_LIMIT} (нажмите ещё раз)` : '0' }]
      };
      if (pending.length && !config.openaiApiKey) plan.blocked = 'На сервере нет ключа OpenAI (OPENAI_API_KEY в Railway) — обработать нечем.';
      return plan;
    },
    async apply(user) {
      const done = await brainService.processPendingPieces(user.id);
      if (!done) throw new FixError('OpenAI не ответил (нет денег на счёте или сбой). Ничего не изменилось — попробуйте позже.', 502, 'OPENAI_UNAVAILABLE');
      return `Обработано частей: ${done}`;
    }
  },

  block_user: {
    title: 'Заблокировать / разблокировать человека',
    help: 'Только для спама и злоупотреблений. Заблокированный не может войти и ничего делать в приложении; его данные сохраняются.',
    ownerOnly: true,
    async plan(user, { blocked }) {
      const want = blocked ? 'blocked' : 'active';
      if (blocked && await supportService.staffRoleOf(user.id)) {
        return { count: 0, blocked: 'Это человек из команды поддержки — сначала уберите его из команды.', changes: [] };
      }
      return {
        count: user.status === want ? 0 : 1,
        changes: [{ label: 'Доступ к приложению', before: user.status === 'blocked' ? 'заблокирован' : 'есть', after: blocked ? 'заблокирован' : 'есть' }]
      };
    },
    async apply(user, { blocked }) {
      await db.run('UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [blocked ? 'blocked' : 'active', user.id]);
      supportService.setBlocked(user.id, Boolean(blocked));
    }
  }
};

function getFix(fixId, staffRole) {
  const fix = Object.prototype.hasOwnProperty.call(FIXES, fixId) ? FIXES[fixId] : null;
  if (!fix) throw new FixError('Такого исправления нет.', 404, 'UNKNOWN_FIX');
  if (fix.ownerOnly && staffRole !== 'owner') throw new FixError('Это может сделать только владелица.', 403, 'OWNER_ONLY');
  return fix;
}

async function loadUser(userId) {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [String(userId || '')]);
  if (!user) throw new FixError('Человек не найден.', 404, 'USER_NOT_FOUND');
  return user;
}

/**
 * What the fix would change. Nothing is written.
 */
async function previewFix(fixId, userId, params = {}, staffRole) {
  const fix = getFix(fixId, staffRole);
  const user = await loadUser(userId);
  const plan = await fix.plan(user, params || {});
  return {
    fixId,
    title: fix.title,
    help: fix.help,
    count: plan.count,
    changes: plan.changes,
    blocked: plan.blocked || (plan.count === 0 ? 'Менять нечего: всё уже так, как нужно.' : null)
  };
}

/**
 * Applies the fix if the number of records is still what the team saw in the preview.
 */
async function applyFix(fixId, userId, params = {}, expectedCount, staff) {
  const fix = getFix(fixId, staff.role);
  const user = await loadUser(userId);
  const plan = await fix.plan(user, params || {});
  if (plan.blocked) throw new FixError(plan.blocked, 409, 'FIX_BLOCKED');
  if (plan.count === 0) throw new FixError('Менять нечего: всё уже так, как нужно.', 409, 'NOTHING_TO_CHANGE');
  if (Number(expectedCount) !== plan.count) {
    throw new FixError(`Стоп: ожидали записей — ${expectedCount}, а сейчас — ${plan.count}. Ничего не изменено. Откройте карточку заново и проверьте.`, 409, 'COUNT_MISMATCH');
  }
  if (plan.count > (fix.maxCount || 5)) {
    throw new FixError(`Стоп: изменится слишком много записей (${plan.count}). Ничего не изменено — передайте разработчику.`, 409, 'TOO_MANY');
  }
  const result = await fix.apply(user, params || {}, plan);
  await supportService.logAction(staff.userId, user.id, `fix:${fixId}`, { title: fix.title, params, count: plan.count, changes: plan.changes, result: result || null });
  return { fixId, title: fix.title, count: plan.count, changes: plan.changes, result: result || null };
}

function listFixes(staffRole) {
  return Object.entries(FIXES)
    .filter(([, f]) => !f.ownerOnly || staffRole === 'owner')
    .map(([id, f]) => ({ id, title: f.title, help: f.help }));
}

module.exports = {
  FixError,
  FIXES,
  previewFix,
  applyFix,
  listFixes
};
