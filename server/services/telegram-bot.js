// server/services/telegram-bot.js - Notifications from @smartflow_ai_support_bot.
//
// The bot can write to a person only if they allowed it (pressed Start in the bot, or allowed
// messages when the Mini App asked: Telegram.WebApp.requestWriteAccess). Otherwise Telegram
// answers 403 and we just skip: a notification must never break the main action.
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

/**
 * Sends a message with one button that opens the Mini App on startParam.
 * Returns true if Telegram accepted it. Never throws.
 */
async function notifyUser(userId, text, { buttonText = 'Открыть в SmartFlow', startParam } = {}) {
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
  notifyUser,
  testOutbox
};
