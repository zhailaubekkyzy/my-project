// server/services/mail-service.js - Письма через Resend (resend.com): код для входа по почте, позже — важные
// уведомления (часть 2). Ключ — только в Railway (RESEND_API_KEY), отправитель — MAIL_FROM на домене, который
// подтверждён в Resend (techsmartflow.com, записи DNS — в Cloudflare). Без ключа письма не уходят.
const config = require('../config');

const RESEND_URL = 'https://api.resend.com/emails';

function isConfigured() {
  return Boolean(config.resendApiKey);
}

/** Sends one letter. Returns true when Resend accepted it. Never throws: the caller decides what to tell. */
async function send({ to, subject, text, html }) {
  if (!isConfigured()) return false;
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.mailFrom, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.warn(`[SmartFlow Mail] Resend ${res.status}: ${data.message || data.name || 'not sent'}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[SmartFlow Mail] not sent:', err.message);
    return false;
  }
}

module.exports = { isConfigured, send };
