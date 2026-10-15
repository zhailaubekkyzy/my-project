// server/services/telegram-bot.js - Notifications from @smartflow_ai_support_bot.
//
// The bot can write to a person only if they allowed it (pressed Start in the bot, or allowed
// messages when the Mini App asked: Telegram.WebApp.requestWriteAccess). Otherwise Telegram
// answers 403 and we just skip: a notification must never break the main action.
const crypto = require('crypto');
const { langOf, pick } = require('./i18n');
const db = require('../db');
const config = require('../config');

// In tests nothing goes to Telegram; sent messages are kept here for assertions.
const testOutbox = [];

// Link that opens the Mini App on a given screen: t.me/<bot>/<app>?startapp=<param>
// startapp allows only A-Z a-z 0-9 _ - and up to 64 characters.
function miniAppLink(startParam) {
  const base = `https://t.me/${config.telegramBotUsername}/${config.telegramAppShortName}`;
  if (!startParam) return base;
  const safe = String(startParam).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return `${base}?startapp=${safe}`;
}

async function telegramIdOfUser(userId) {
  if (!userId) return null;
  const identity = await db.get(
    'SELECT provider_user_id FROM auth_identities WHERE user_id = ? AND provider = ?',
    [userId, 'telegram']
  );
  return identity ? identity.provider_user_id : null;
}

// Every notification first goes to Buddy inside the app (table notifications), then to Telegram.
// A failure here never breaks the main action either.
async function saveInApp(userId, text, startParam) {
  if (!userId) return;
  try {
    await db.run(
      'INSERT INTO notifications (id, user_id, text, start_param) VALUES (?, ?, ?, ?)',
      [`ntf_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`, userId, String(text).slice(0, 1000), startParam ? String(startParam).slice(0, 64) : null]
    );
  } catch (err) {
    console.warn('[SmartFlow Notify] in-app notification not saved:', err.message);
  }
}

/**
 * Sends a notification: to Buddy in the app, then a Telegram message with one button that opens
 * the Mini App on startParam. Returns true if Telegram accepted it. Never throws.
 */
async function notifyUser(userId, rawText, { buttonText = 'Открыть в SmartFlow', startParam } = {}) {
  // Texts for clients may come as { ru, en }: the person's language decides (Russian by default)
  let text = rawText;
  let button = buttonText;
  if ((rawText && typeof rawText === 'object') || (buttonText && typeof buttonText === 'object')) {
    const lang = langOf(userId ? await db.get('SELECT lang, tg_lang FROM users WHERE id = ?', [userId]) : null);
    text = pick(rawText, lang);
    button = pick(buttonText, lang);
  }
  buttonText = button;
  await saveInApp(userId, text, startParam);
  try {
    const chatId = await telegramIdOfUser(userId);
    if (!chatId) return false;
    const payload = {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: buttonText, url: miniAppLink(startParam) }]] }
    };

    if (config.isTest) {
      testOutbox.push({ userId, ...payload });
      return true;
    }
    if (!config.telegramBotToken) return false;

    const res = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      // 403: the person has not allowed the bot to write to them
      console.warn(`[SmartFlow Bot] sendMessage ${res.status}: ${body.description || 'error'}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[SmartFlow Bot] notification failed:', err.message);
    return false;
  }
}

module.exports = {
  miniAppLink,
  telegramIdOfUser,
  notifyUser,
  testOutbox
};
