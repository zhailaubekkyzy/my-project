// server/services/auth-service.js - Telegram WebApp Verification & User Lifecycle
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

/**
 * Validates Telegram WebApp initData string using HMAC-SHA256
 * Reference: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
function verifyTelegramInitData(initDataString, maxAgeSeconds = config.telegramMaxAgeSeconds) {
  if (!initDataString || typeof initDataString !== 'string') {
    return { valid: false, error: 'empty_init_data' };
  }

  const botToken = config.telegramBotToken;
  if (!botToken) {
    return { valid: false, error: 'missing_bot_token_on_server' };
  }

  const urlParams = new URLSearchParams(initDataString);
  const hash = urlParams.get('hash');
  if (!hash) {
    return { valid: false, error: 'missing_hash' };
  }

  // Remove hash to assemble data-check-string
  urlParams.delete('hash');
  const items = Array.from(urlParams.entries());
  items.sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = items.map(([k, v]) => `${k}=${v}`).join('\n');

  // HMAC-SHA256 signature calculation
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // Timing safe comparison to protect against timing attacks
  const hashBuf = Buffer.from(hash, 'hex');
  const calcBuf = Buffer.from(calculatedHash, 'hex');
  if (hashBuf.length !== calcBuf.length || !crypto.timingSafeEqual(hashBuf, calcBuf)) {
    return { valid: false, error: 'invalid_signature' };
  }

  // Verify timestamp freshness
  const authDate = parseInt(urlParams.get('auth_date') || '0', 10);
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > maxAgeSeconds) {
    return { valid: false, error: 'expired_auth_data', authDate, now, age: now - authDate };
  }

  let user = null;
  const userStr = urlParams.get('user');
  if (userStr) {
    try {
      user = JSON.parse(userStr);
    } catch (e) {
      return { valid: false, error: 'malformed_user_payload' };
    }
  }

  return {
    valid: true,
    user,
    authDate,
    queryId: urlParams.get('query_id'),
    // The start parameter of the link the app was opened by (signed together with the user)
    startParam: urlParams.get('start_param') || null
  };
}

/**
 * Finds existing user by Telegram ID or creates a permanent internal user.
 * Internal user_id is the permanent source of truth across all platforms.
 */
async function findOrCreateTelegramUser(tgUser, requestedRole = 'expert') {
  if (!tgUser || !tgUser.id) {
    throw new Error('Telegram user object with id is required');
  }

  const telegramIdStr = String(tgUser.id);
  const displayName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || tgUser.username || `User ${tgUser.id}`;
  const username = tgUser.username || null;
  const avatarUrl = tgUser.photo_url || null;

  // Check if identity already exists
  const identity = await db.get(
    'SELECT * FROM auth_identities WHERE provider = ? AND provider_user_id = ?',
    ['telegram', telegramIdStr]
  );

  let user = null;

  if (identity) {
    // Identity exists, load permanent user
    user = await db.get('SELECT * FROM users WHERE id = ?', [identity.user_id]);
    if (user) {
      // Update display name or username if changed in Telegram
      await db.run(
        `UPDATE users SET display_name = ?, username = ?, avatar_url = COALESCE(?, avatar_url), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [displayName, username, avatarUrl, user.id]
      );
      // Re-fetch updated user
      user = await db.get('SELECT * FROM users WHERE id = ?', [user.id]);
    }
  }

  if (!user) {
    // Generate permanent internal user ID
    const internalUserId = `usr_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const allowedRoles = requestedRole === 'marketer' ? ['marketer'] : ['expert'];

    await db.run(
      `INSERT INTO users (id, display_name, username, avatar_url, roles, status, is_demo)
       VALUES (?, ?, ?, ?, ?, 'active', 0)`,
      [internalUserId, displayName, username, avatarUrl, JSON.stringify(allowedRoles)]
    );

    // Link Telegram identity to this internal user
    const identityId = `ident_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await db.run(
      `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, metadata)
       VALUES (?, ?, 'telegram', ?, ?)`,
      [identityId, internalUserId, telegramIdStr, JSON.stringify(tgUser)]
    );

    // Provision SmartFlow Platform Subscription (Free founder tier for first 100)
    const subId = `sub_plat_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const trialDays = config.defaultTrialDays;
    const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();

    await db.run(
      `INSERT INTO platform_subscriptions (id, user_id, plan_code, status, trial_ends_at, current_period_ends_at, auto_renew)
       VALUES (?, ?, 'founder_free_100', 'trial', ?, ?, 1)`,
      [subId, internalUserId, trialEndsAt, trialEndsAt]
    );

    // No SI-seller is created here: it appears only when the person creates one in the Office.
    // (Before 20 Nov. every sign-up got an empty "Проект: Имя": it confused experts, could be opened by
    // clients, and its link from the last 4 digits of the Telegram id broke the first sign-in of some
    // people without a @username. Migration 023 removes the untouched ones.)

    user = await db.get('SELECT * FROM users WHERE id = ?', [internalUserId]);
  }

  // Parse roles JSON
  let roles = ['expert'];
  try {
    roles = JSON.parse(user.roles);
  } catch (e) {}

  return {
    ...user,
    roles,
    telegramId: telegramIdStr
  };
}

/**
 * Finds the person by their e-mail (signed in from a browser, owner's decisions 23 Nov.) or creates a new account,
 * the same way as for Telegram: a permanent internal id, the e-mail identity, the free platform subscription.
 */
const newIdentityId = () => `ident_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

// A new account from the browser (e-mail or Google): the user, the e-mail identity, the free trial
async function createWebUser(displayName, address) {
  const internalUserId = `usr_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await db.run(
    `INSERT INTO users (id, display_name, username, avatar_url, roles, status, is_demo, email)
     VALUES (?, ?, NULL, NULL, ?, 'active', 0, ?)`,
    [internalUserId, displayName, JSON.stringify(['expert']), address]
  );
  await db.run(
    `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, metadata) VALUES (?, ?, 'email', ?, ?)`,
    [newIdentityId(), internalUserId, address, JSON.stringify({ email: address })]
  );
  const trialEndsAt = new Date(Date.now() + config.defaultTrialDays * 24 * 60 * 60 * 1000).toISOString();
  await db.run(
    `INSERT INTO platform_subscriptions (id, user_id, plan_code, status, trial_ends_at, current_period_ends_at, auto_renew)
     VALUES (?, ?, 'founder_free_100', 'trial', ?, ?, 1)`,
    [`sub_plat_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`, internalUserId, trialEndsAt, trialEndsAt]
  );
  return db.get('SELECT * FROM users WHERE id = ?', [internalUserId]);
}

const withRoles = (user, created) => {
  let roles = ['expert'];
  try { roles = JSON.parse(user.roles); } catch (e) {}
  return { ...user, roles, created };
};

async function findOrCreateEmailUser(email) {
  const address = String(email || '').trim().toLowerCase();
  if (!address) throw new Error('E-mail is required');
  const identity = await db.get(`SELECT * FROM auth_identities WHERE provider = 'email' AND provider_user_id = ?`, [address]);
  let user = identity ? await db.get('SELECT * FROM users WHERE id = ?', [identity.user_id]) : null;
  let created = false;
  if (!user) {
    created = true;
    // The name until the person writes their own: the part of the address before «@»
    user = await createWebUser(address.split('@')[0].slice(0, 60) || 'Новый пользователь', address);
  } else if (!user.email) {
    await db.run('UPDATE users SET email = ? WHERE id = ?', [address, user.id]);
    user.email = address;
  }
  return withRoles(user, created);
}

/**
 * Sign-in through Google (part 3): the same Google account — the same SmartFlow account; a person who signed in
 * by e-mail before with the same (Google-confirmed) address — that account, now also with Google.
 * { sub, email, name } come from google-login.verify.
 */
async function findOrCreateGoogleUser({ sub, email, name }) {
  const address = String(email || '').trim().toLowerCase();
  if (!sub || !address) throw new Error('Google account is required');
  const google = await db.get(`SELECT * FROM auth_identities WHERE provider = 'google' AND provider_user_id = ?`, [String(sub)]);
  let user = google ? await db.get('SELECT * FROM users WHERE id = ?', [google.user_id]) : null;
  let created = false;
  if (!user) {
    const byEmail = await db.get(`SELECT * FROM auth_identities WHERE provider = 'email' AND provider_user_id = ?`, [address]);
    user = byEmail ? await db.get('SELECT * FROM users WHERE id = ?', [byEmail.user_id]) : null;
    if (!user) {
      created = true;
      user = await createWebUser(name || address.split('@')[0].slice(0, 60) || 'Новый пользователь', address);
    }
    await db.run(
      `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, metadata) VALUES (?, ?, 'google', ?, ?)`,
      [newIdentityId(), user.id, String(sub), JSON.stringify({ email: address })]
    );
  }
  if (!user.email) {
    await db.run('UPDATE users SET email = ? WHERE id = ?', [address, user.id]);
    user.email = address;
  }
  return withRoles(user, created);
}

/**
 * Issue signed JWT for safe sessions. expiresIn: longer for the browser / installed app (no Telegram to sign in again)
 */
function generateSessionToken(user, { expiresIn = config.jwtExpiresIn } = {}) {
  const payload = {
    userId: user.id,
    telegramId: user.telegramId || null,
    roles: user.roles || ['expert']
  };

  return jwt.sign(payload, config.jwtSecret, { expiresIn });
}

/**
 * Verify JWT token
 */
function verifySessionToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch (err) {
    return null;
  }
}

module.exports = {
  findOrCreateEmailUser,
  findOrCreateGoogleUser,
  verifyTelegramInitData,
  findOrCreateTelegramUser,
  generateSessionToken,
  verifySessionToken
};
