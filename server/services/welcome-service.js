// server/services/welcome-service.js - Новичок без ссылки (решение владелицы 24 нояб.): первый экран — Маркетплейс,
// а через минуту Бадди пишет приветствие (у Бадди + на телефон, как любое уведомление).
//
// Телефон после первой регистрации сам зовёт POST /api/buddy/welcome; сервер ставит время, только если аккаунт
// создан только что и приветствия ещё не было. «Будильник» (scheduler-service) раз в минуту отправляет созревшие.
const db = require('../db');
const config = require('../config');
const notifyService = require('./notify-service');

const DELAY_SECONDS = 60;
const FRESH_MINUTES = 30; // старый аккаунт приветствие не получает, даже если телефон попросит
const BATCH = 50;

const sqlTime = (date) => date.toISOString().slice(0, 19).replace('T', ' ');

const TEXT = {
  ru: '👋 Как вам Маркетплейс? Найдёте эксперта — его SI-продавец ответит за секунды. А я помогу не забыть важное: напишите мне, например, «завтра в 10:00 тренировка» — запишу в календарь и напомню.',
  en: '👋 How do you like the Marketplace? Find an expert — their SI seller replies in seconds. And I’ll help you remember what matters: write to me, for example, “gym tomorrow at 10:00” — I’ll add it to your calendar and remind you.'
};
const BUTTON = { ru: 'Открыть Бадди', en: 'Open Buddy' };

/** Ставит приветствие через минуту. true — поставлено; false — не новичок или уже было. */
async function schedule(userId, now = new Date()) {
  const res = await db.run(
    `UPDATE users SET buddy_welcome_due_at = ?
     WHERE id = ? AND buddy_welcome_due_at IS NULL AND buddy_welcome_sent_at IS NULL AND created_at >= ?`,
    [sqlTime(new Date(now.getTime() + DELAY_SECONDS * 1000)), userId, sqlTime(new Date(now.getTime() - FRESH_MINUTES * 60000))]
  );
  const ok = Number(res.changes) === 1;
  // Ровно через минуту; «будильник» — запасной путь (перезапуск сервера), он же не даст отправить дважды
  if (ok && !config.isTest) {
    setTimeout(() => runWelcomes().catch(err => console.warn('[SmartFlow Welcome]', err.message)), (DELAY_SECONDS + 1) * 1000).unref();
  }
  return ok;
}

/** Задача «будильника»: отправляет созревшие приветствия, каждое ровно один раз. */
async function runWelcomes(now = new Date()) {
  const due = await db.all(
    `SELECT id FROM users WHERE buddy_welcome_due_at IS NOT NULL AND buddy_welcome_due_at <= ? AND buddy_welcome_sent_at IS NULL
     ORDER BY buddy_welcome_due_at LIMIT ?`,
    [sqlTime(now), BATCH]
  );
  let sent = 0;
  for (const { id } of due) {
    const took = await db.run(
      'UPDATE users SET buddy_welcome_sent_at = ? WHERE id = ? AND buddy_welcome_sent_at IS NULL',
      [sqlTime(now), id]
    );
    if (Number(took.changes) !== 1) continue; // другая копия сервера уже отправила
    await notifyService.notifyUser(id, TEXT, { buttonText: BUTTON });
    sent++;
  }
  return { sent };
}

module.exports = { schedule, runWelcomes, TEXT, DELAY_SECONDS, FRESH_MINUTES };
