// server/config.js - Application Configuration & Environment Settings
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const isProd = process.env.NODE_ENV === 'production';

// JWT secret must come from the environment. In development a fixed fallback keeps
// sessions alive across restarts; in production a missing secret falls back to a
// random per-process value (sessions reset on restart) instead of a value known from git.
function resolveJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (isProd) {
    console.warn('[SmartFlow] JWT_SECRET is not set — using a random secret. Set JWT_SECRET in Railway Variables.');
    return crypto.randomBytes(48).toString('hex');
  }
  return 'smartflow_dev_only_jwt_secret';
}

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd,
  isTest: process.env.NODE_ENV === 'test',

  // Security & Telegram Auth
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  jwtSecret: resolveJwtSecret(),
  jwtExpiresIn: '7d',
  telegramMaxAgeSeconds: 86400, // 24 hours max age for initData

  // Frontend origins allowed by CORS (Cloudflare Pages domain, custom domain)
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map(o => o.trim().replace(/\/+$/, '')).filter(Boolean),

  // Database settings
  dbDriver: process.env.DB_DRIVER || 'sqlite',
  dbFile: process.env.DB_FILE || path.join(__dirname, '../data/smartflow.db'),
  databaseUrl: process.env.DATABASE_URL || '',

  // Supabase Settings (if used)
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',

  // PostHog Settings
  posthogApiKey: process.env.POSTHOG_API_KEY || '',
  posthogHost: process.env.POSTHOG_HOST || 'https://app.posthog.com',

  // SmartFlow Business Rules
  firstUsersFreeLimit: 100,
  defaultTrialDays: 14,
  appName: 'SmartFlow',
  appSlogan: 'From idea to selling. Faster.'
};

module.exports = config;
