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
    queryId: urlParams.get('query_id')
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

    // If expert, create initial project instance
    const projectId = `proj_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const slug = (username ? `${username}-sales` : `expert-${telegramIdStr.slice(-4)}-sales`).toLowerCase();

    await db.run(
      `INSERT INTO projects (id, owner_id, template_id, name, slug, status, niche, custom_ai_settings, pricing_options, stats, is_demo)
       VALUES (?, ?, NULL, ?, ?, 'active', ?, ?, ?, ?, 0)`,
      [
        projectId,
        internalUserId,
        `Проект: ${displayName}`,
        slug,
        'Экспертные услуги и консалтинг',
        JSON.stringify({
          systemRole: `SI-консультант и ассистент эксперта ${displayName}`,
          tone: 'экспертный, заботливый, конвертирующий',
          targetAudience: 'Целевые клиенты и подписчики',
          objectionsHandling: {
            дорого: 'Инвестиции в продукт окупаются за счет системного результата и персонального подхода',
            нет_времени: 'Формат гибкий и адаптирован под занятых людей'
          }
        }),
        JSON.stringify([]), // no made-up prices: the expert sets the price on the card
        JSON.stringify({ traffic: 0, leads: 0, qualified: 0, bookings: 0, cr: 0, revenueRub: 0, savedHours: 0 })
      ]
    );

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
 * Issue signed JWT for safe sessions
 */
function generateSessionToken(user) {
  const payload = {
    userId: user.id,
    telegramId: user.telegramId || null,
    roles: user.roles || ['expert']
  };

  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn
  });
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
  verifyTelegramInitData,
  findOrCreateTelegramUser,
  generateSessionToken,
  verifySessionToken
};
