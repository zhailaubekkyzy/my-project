// server/config.js - Application Configuration & Environment Settings
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',

  // Security & Telegram Auth
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  jwtSecret: process.env.JWT_SECRET || 'smartflow_dev_jwt_secret_change_in_production_2026',
  jwtExpiresIn: '7d',
  telegramMaxAgeSeconds: 86400, // 24 hours max age for initData

  // Database settings
  dbDriver: process.env.DB_DRIVER || 'sqlite',
  dbFile: process.env.DB_FILE || path.join(__dirname, '../data/smartflow.db'),
  databaseUrl: process.env.DATABASE_URL || '',

  // Supabase Settings (if used)
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || 'sb_publishable_chPdMVynMO7fAhy4p8Hurg_LhjCHmwZ',
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
