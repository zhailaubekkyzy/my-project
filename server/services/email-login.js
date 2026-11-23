// server/services/email-login.js - Вход по почте и коду (вход через браузер, часть 1; решения владелицы 23 нояб.).
// start: человек вписал почту → письмо с 6 цифрами (живёт 10 минут). verify: верный код → вход (новый человек —
// новый аккаунт). Хранится только отпечаток кода. Защита от перебора и спама:
//  - не чаще раза в минуту и не больше 5 писем в час на одну почту, не больше 20 запросов в час с одного адреса;
//  - на один код — до 5 попыток, потом нужен новый.
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');
const mail = require('./mail-service');

const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const PER_EMAIL_HOUR = 5;
const PER_IP_HOUR = 20;
const RESEND_SECONDS = 60;

class EmailLoginError extends Error {
  constructor(message, status = 400, code = 'EMAIL_LOGIN') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const sqlTime = (d) => d.toISOString().replace('T', ' ').slice(0, 19);
const toDate = (v) => (v instanceof Date ? v : new Date(String(v).replace(' ', 'T') + (/[Z+]/.test(String(v)) ? '' : 'Z')));

function normalizeEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new EmailLoginError('Проверьте почту — например, name@gmail.com', 400, 'BAD_EMAIL');
  }
  return email;
}

const hashOf = (email, code) => crypto.createHash('sha256').update(`${config.jwtSecret}|${email}|${code}`).digest('hex');

function letter(code) {
  const text = `Ваш код для входа в SmartFlow: ${code}\n\nКод действует ${CODE_MINUTES} минут. Если вы не входили в SmartFlow, просто не отвечайте на это письмо.`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#0f172a">
    <p>Ваш код для входа в SmartFlow:</p>
    <p style="font-size:30px;font-weight:bold;letter-spacing:6px;color:#0d9488">${code}</p>
    <p style="color:#64748b">Код действует ${CODE_MINUTES} минут. Если вы не входили в SmartFlow, просто не отвечайте на это письмо.</p>
  </div>`;
  return { subject: `${code} — код для входа в SmartFlow`, text, html };
}

/**
 * Sends a code. Returns { sent: true, seconds } (and devCode on a developer's computer without Resend, for tests).
 */
async function start(rawEmail, ip = '') {
  const email = normalizeEmail(rawEmail);
  const now = new Date();
  const hourAgo = sqlTime(new Date(now.getTime() - 3600 * 1000));
  const last = await db.get('SELECT created_at FROM email_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1', [email]);
  if (last && now - toDate(last.created_at) < RESEND_SECONDS * 1000) {
    throw new EmailLoginError('Код уже отправлен — подождите минуту и проверьте почту, в том числе «Спам»', 429, 'TOO_SOON');
  }
  const perEmail = await db.get('SELECT COUNT(*) AS n FROM email_codes WHERE email = ? AND created_at >= ?', [email, hourAgo]);
  if (Number(perEmail.n) >= PER_EMAIL_HOUR) throw new EmailLoginError('Слишком много кодов на эту почту. Попробуйте через час', 429, 'TOO_MANY');
  if (ip) {
    const perIp = await db.get('SELECT COUNT(*) AS n FROM email_codes WHERE ip = ? AND created_at >= ?', [ip, hourAgo]);
    if (Number(perIp.n) >= PER_IP_HOUR) throw new EmailLoginError('Слишком много попыток. Попробуйте через час', 429, 'TOO_MANY');
  }
  const devOnly = !mail.isConfigured() && config.devLoginAllowed;
  if (!mail.isConfigured() && !devOnly) {
    throw new EmailLoginError('Вход по почте скоро заработает — откройте SmartFlow в Telegram', 503, 'MAIL_NOT_CONFIGURED');
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await db.run(
    'INSERT INTO email_codes (id, email, code_hash, expires_at, ip) VALUES (?, ?, ?, ?, ?)',
    [`ecd_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`, email, hashOf(email, code), sqlTime(new Date(now.getTime() + CODE_MINUTES * 60000)), ip ? String(ip).slice(0, 64) : null]
  );
  if (devOnly) {
    console.log(`[SmartFlow Mail] (на компьютере разработчика, без Resend) код для ${email}: ${code}`);
    return { sent: true, seconds: RESEND_SECONDS, devCode: code };
  }
  const ok = await mail.send({ to: email, ...letter(code) });
  if (!ok) throw new EmailLoginError('Не получилось отправить письмо. Проверьте почту и попробуйте ещё раз', 502, 'MAIL_FAILED');
  return { sent: true, seconds: RESEND_SECONDS };
}

/** Checks the code. Returns the user ({ …, created }) — the caller signs them in. */
async function verify(rawEmail, rawCode) {
  const email = normalizeEmail(rawEmail);
  const code = String(rawCode || '').replace(/\D/g, '');
  if (code.length !== 6) throw new EmailLoginError('Код — 6 цифр из письма', 400, 'BAD_CODE');
  // Only the latest code works: asking for a new one makes the earlier ones useless
  const row = await db.get('SELECT * FROM email_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1', [email]);
  if (row && row.used_at) throw new EmailLoginError('Код уже использован — запросите новый', 400, 'USED');
  if (!row || toDate(row.expires_at) < new Date()) throw new EmailLoginError('Код устарел — запросите новый', 400, 'EXPIRED');
  if (Number(row.attempts) >= MAX_ATTEMPTS) throw new EmailLoginError('Слишком много попыток — запросите новый код', 429, 'TOO_MANY_ATTEMPTS');
  const a = Buffer.from(hashOf(email, code));
  const b = Buffer.from(row.code_hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    await db.run('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?', [row.id]);
    throw new EmailLoginError('Неверный код', 400, 'WRONG_CODE');
  }
  const used = await db.run('UPDATE email_codes SET used_at = CURRENT_TIMESTAMP WHERE id = ? AND used_at IS NULL', [row.id]);
  if (!used.changes) throw new EmailLoginError('Код уже использован — запросите новый', 400, 'USED');
  return require('./auth-service').findOrCreateEmailUser(email);
}

module.exports = { EmailLoginError, normalizeEmail, start, verify, CODE_MINUTES, MAX_ATTEMPTS };
