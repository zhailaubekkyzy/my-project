// server/services/notify-service.js - Every notification to a person goes through here.
//
// 1. It is saved in SmartFlow first: Buddy → «Уведомления» (table notifications).
//    This is ours and works without any outside service. Exception: groups in «Чаты» (buddy: false) —
//    they are seen in «Чаты» itself (the number on the tab, marks in the group).
// 2. Then it goes to the person's phone through the delivery channels below: Telegram (the bot) and
//    web notifications (Web Push — SmartFlow in the browser or on the home screen; part 2 of the browser
//    login, 23 Nov.). A new channel (our own app) is one more entry in CHANNELS
//    (owner's decision 16 Oct.: do not depend on Telegram).
// 3. important: true (meetings, payments, a client waiting for a person, the support's answer) — if no
//    channel delivered it (notifications not allowed), the same goes by e-mail to a person who signed in
//    by e-mail and has not turned «Важное на почту» off. Not more than 20 letters a day per person.
// A failure never breaks the main action.
const crypto = require('crypto');
const db = require('../db');
const { langOf, pick } = require('./i18n');
const config = require('../config');
const telegramBot = require('./telegram-bot');
const pushService = require('./push-service');
const mail = require('./mail-service');

// A channel: { name, send(userId, { text, buttonText, startParam }) → true if delivered }. Never throws.
const CHANNELS = [
  { name: 'telegram', send: telegramBot.sendTelegram },
  { name: 'push', send: pushService.sendPush }
];

const EMAILS_PER_DAY = 20;
const emailOutbox = []; // tests only

const escHtml = (v) => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The e-mail fallback for important notifications. Returns true if the letter went. Never throws. */
async function sendImportantEmail(userId, { text, buttonText, startParam }) {
  try {
    const user = await db.get('SELECT email, email_notify FROM users WHERE id = ?', [userId]);
    if (!user || !user.email || Number(user.email_notify) === 0) return false;
    if (!config.isTest && !mail.isConfigured()) return false;
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    const sent = await db.get('SELECT COUNT(*) AS n FROM email_notifications WHERE user_id = ? AND created_at >= ?', [userId, dayAgo]);
    if (Number(sent.n) >= EMAILS_PER_DAY) return false;
    const url = pushService.appUrl(startParam);
    const firstLine = String(text).split('\n')[0].replace(/^[^\p{L}\p{N}«]+/u, '').slice(0, 90) || 'Новое в SmartFlow';
    const letter = {
      to: user.email,
      subject: `SmartFlow: ${firstLine}`,
      text: `${text}\n\n${buttonText}: ${url}\n\nЧтобы письма не приходили, включите уведомления в SmartFlow или выключите «Важное на почту» в Настройках.`,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#0f172a;line-height:1.45">
        <p style="white-space:pre-line">${escHtml(text)}</p>
        <p><a href="${escHtml(url)}" style="display:inline-block;padding:10px 18px;border-radius:10px;background:#0d9488;color:#fff;text-decoration:none;font-weight:bold">${escHtml(buttonText)}</a></p>
        <p style="color:#64748b;font-size:12px">Чтобы письма не приходили, включите уведомления в SmartFlow или выключите «Важное на почту» в Настройках.</p>
      </div>`
    };
    let ok;
    if (config.isTest) {
      emailOutbox.push({ userId, ...letter });
      ok = true;
    } else {
      ok = await mail.send(letter);
    }
    if (ok) {
      await db.run('INSERT INTO email_notifications (id, user_id) VALUES (?, ?)', [`eml_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`, userId]);
    }
    return ok;
  } catch (err) {
    console.warn('[SmartFlow Notify] e-mail not sent:', err.message);
    return false;
  }
}

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
async function notifyUser(userId, rawText, { buttonText = 'Открыть в SmartFlow', startParam, buddy = true, important = false } = {}) {
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
  if (!delivered && important) delivered = await sendImportantEmail(userId, { text, buttonText: button, startParam });
  return delivered;
}

module.exports = { notifyUser, CHANNELS, sendImportantEmail, emailOutbox, EMAILS_PER_DAY };
