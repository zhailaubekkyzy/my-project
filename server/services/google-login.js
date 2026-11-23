// server/services/google-login.js - Вход через Google (вход через браузер, часть 3; решения владелицы 23 нояб.).
// Кнопка «Войти через Google» на экране входа переводит человека на страницу Google; Google возвращает его в
// SmartFlow с «пропуском» (id_token — подписанная Google запись: кто это и его почта). Сервер проверяет подпись по
// открытым ключам Google, адресата (наш GOOGLE_CLIENT_ID), срок, одноразовое число (nonce) и что почта подтверждена.
// Пароли и доступ к почте/диску человека мы не получаем — только имя и адрес почты.
// GOOGLE_CLIENT_ID — в Railway (Google Cloud → APIs & Services → Credentials → OAuth client ID, тип «Web application»).
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

class GoogleLoginError extends Error {
  constructor(message, status = 400, code = 'GOOGLE_LOGIN') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const isConfigured = () => Boolean(config.googleClientId);

// Google's public keys change rarely: kept for as long as Google says (Cache-Control), at least 1 hour
let certs = { keys: [], until: 0 };
let testKeys = null;
async function publicKeys(forceFresh = false) {
  if (testKeys) return testKeys;
  if (!forceFresh && certs.until > Date.now() && certs.keys.length) return certs.keys;
  const res = await fetch(CERTS_URL, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new GoogleLoginError('Google сейчас не отвечает — попробуйте через минуту', 502, 'GOOGLE_UNAVAILABLE');
  const body = await res.json();
  const maxAge = Number((/max-age=(\d+)/.exec(res.headers.get('cache-control') || '') || [])[1]) || 3600;
  certs = { keys: body.keys || [], until: Date.now() + Math.max(maxAge, 3600) * 1000 };
  return certs.keys;
}

/** Tests only: the keys «Google» signs with. */
function setTestKeys(keys) {
  testKeys = keys;
}

/**
 * Checks the id_token from Google. nonce — the one-time number this device sent to Google.
 * Returns { sub, email, name }.
 */
async function verify(idToken, nonce) {
  if (!isConfigured()) throw new GoogleLoginError('Вход через Google скоро заработает — войдите по почте', 503, 'GOOGLE_NOT_CONFIGURED');
  const token = String(idToken || '');
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || !decoded.header || decoded.header.alg !== 'RS256' || !decoded.header.kid) {
    throw new GoogleLoginError('Google не подтвердил вход — попробуйте ещё раз', 400, 'BAD_TOKEN');
  }
  let jwk = (await publicKeys()).find(k => k.kid === decoded.header.kid);
  if (!jwk) jwk = (await publicKeys(true)).find(k => k.kid === decoded.header.kid);
  if (!jwk) throw new GoogleLoginError('Google не подтвердил вход — попробуйте ещё раз', 400, 'UNKNOWN_KEY');
  let claims;
  try {
    claims = jwt.verify(token, crypto.createPublicKey({ key: jwk, format: 'jwk' }), {
      algorithms: ['RS256'],
      audience: config.googleClientId,
      issuer: ISSUERS,
      clockTolerance: 60
    });
  } catch (err) {
    throw new GoogleLoginError(/expired/i.test(err.message) ? 'Вход через Google устарел — нажмите кнопку ещё раз' : 'Google не подтвердил вход — попробуйте ещё раз', 400, 'BAD_TOKEN');
  }
  if (!nonce || claims.nonce !== String(nonce)) throw new GoogleLoginError('Вход через Google не совпал — нажмите кнопку ещё раз', 400, 'BAD_NONCE');
  const email = String(claims.email || '').trim().toLowerCase();
  if (!email || !(claims.email_verified === true || claims.email_verified === 'true')) {
    throw new GoogleLoginError('У этого аккаунта Google не подтверждена почта — войдите по почте', 400, 'EMAIL_NOT_VERIFIED');
  }
  return { sub: String(claims.sub), email, name: String(claims.name || claims.given_name || '').trim().slice(0, 60) };
}

module.exports = { GoogleLoginError, isConfigured, verify, setTestKeys, ISSUERS };
