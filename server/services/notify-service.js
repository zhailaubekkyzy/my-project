// server/services/notify-service.js - Every notification to a person goes through here.
//
// 1. It is saved in SmartFlow first: Buddy → «Уведомления» (table notifications).
//    This is ours and works without any outside service. Exception: groups in «Чаты» (buddy: false) —
//    they are seen in «Чаты» itself (the number on the tab, marks in the group).
// 2. Then it goes to the person's phone through the delivery channels below. Today there is one,
//    Telegram (the bot). Later: web notifications (Web Push), our own app, e-mail — each is one
//    more entry in CHANNELS, nothing else changes (owner's decision 16 Oct.: do not depend on Telegram).
// A failure never breaks the main action.
const crypto = require('crypto');
const db = require('../db');
const { langOf, pick } = require('./i18n');
const telegramBot = require('./telegram-bot');

// A channel: { name, send(userId, { text, buttonText, startParam }) → true if delivered }. Never throws.
const CHANNELS = [
  { name: 'telegram', send: telegramBot.sendTelegram }
];

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
 * Sends a notification: to Buddy in the app, then to every delivery channel. buttonText opens the
 * app on startParam. Texts for clients may come as { ru, en } (the person's language decides).
 * Returns true if at least one channel delivered it to the phone. Never throws.
 */
// buddy: false — only to the phone, not to Buddy (owner's decision 21 Nov.: groups in «Чаты» do not go to
// Buddy; Buddy will have a function of its own). The rest still goes to Buddy first.
async function notifyUser(userId, rawText, { buttonText = 'Открыть в SmartFlow', startParam, buddy = true } = {}) {
  let text = rawText;
  let button = buttonText;
  try {
    if ((rawText && typeof rawText === 'object') || (buttonText && typeof buttonText === 'object')) {
      const lang = langOf(userId ? await db.get('SELECT lang, tg_lang FROM users WHERE id = ?', [userId]) : null);
      text = pick(rawText, lang);
      button = pick(buttonText, lang);
    }
  } catch (err) {
    text = pick(rawText, 'ru');
    button = pick(buttonText, 'ru');
  }
  if (buddy) await saveInApp(userId, text, startParam);
  if (!userId) return false;

  let delivered = false;
  for (const channel of CHANNELS) {
    try {
      if (await channel.send(userId, { text, buttonText: button, startParam })) delivered = true;
    } catch (err) {
      console.warn(`[SmartFlow Notify] ${channel.name} failed:`, err.message);
    }
  }
  return delivered;
}

module.exports = { notifyUser, CHANNELS };
