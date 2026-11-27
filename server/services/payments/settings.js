// server/services/payments/settings.js - Настройки оплат из переменных Railway (без ключей в коде).
//
// Чистая функция: config.js вызывает её с process.env, тесты — со своим набором.
//
// WHOP_ENV — обязателен и пишется явно: sandbox (песочница) или production (боевой режим).
//   У песочницы и боевого Whop нет общих аккаунтов, товаров и вебхуков, а ключи выглядят одинаково,
//   поэтому без явного WHOP_ENV оплаты не запускаются (ручной режим — ссылка эксперта + чек — работает всегда).
//   Тестовая копия (APP_ENV=staging) боевой режим не берёт никогда.
// WHOP_API_KEY        — ключ API (только Railway; в логи, ответы, PostHog и Амплитуду не попадает).
// WHOP_WEBHOOK_SECRET — секрет подписи вебхуков (без верной подписи вебхук → 401).
// WHOP_COMPANY_ID     — аккаунт SmartFlow в Whop (biz_…): на нём подписка маркетолога (сценарий 1)
//                       и от него создаются подаккаунты продавцов.
// Проценты — настройки, не цифры в коде (решение владелицы): пусто = не задано, такие продажи не создаются.
//   PAYMENTS_PLATFORM_FEE_PERCENT — доля SmartFlow с продаж продавцов (сценарии 2–5), например 10 или 7.5.
//   PAYMENTS_MARKETER_FEE_PERCENT — доля маркетолога с продаж эксперта по его шаблону (сценарий 5).
// Выплаты маркетологу (сценарий 5) — правила владелицы, менять можно переменными:
//   PAYMENTS_RESERVE_PERCENT (10), PAYMENTS_RESERVE_DAYS (90); переводы — раз в неделю по понедельникам.

const WHOP_API = {
  sandbox: 'https://sandbox-api.whop.com/api/v1',
  production: 'https://api.whop.com/api/v1'
};

// "10" / "7.5" / "7,5" → сотые доли процента (1000 / 750); пусто или ерунда → null (не задано)
function percentToBps(value) {
  const text = String(value == null ? '' : value).trim().replace(',', '.');
  if (!text) return null;
  if (!/^\d{1,2}(\.\d{1,2})?$|^100(\.0{1,2})?$/.test(text)) return null;
  return Math.round(parseFloat(text) * 100);
}

function positiveInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function resolveWhopEnv(env, appEnv) {
  const raw = String(env.WHOP_ENV || '').trim().toLowerCase();
  if (raw === 'sandbox') return { env: 'sandbox', problem: null };
  if (raw === 'production') {
    if (appEnv === 'staging') return { env: null, problem: 'WHOP_ENV=production в тестовой копии запрещён — нужен sandbox' };
    return { env: 'production', problem: null };
  }
  if (!raw) return { env: null, problem: env.WHOP_API_KEY ? 'WHOP_ENV не задан — впишите sandbox или production' : null };
  return { env: null, problem: `WHOP_ENV="${raw}" не понят — впишите ровно sandbox или production` };
}

function resolvePaymentSettings(env = process.env, { appEnv = 'production' } = {}) {
  const whopEnv = resolveWhopEnv(env, appEnv);
  return {
    whop: {
      env: whopEnv.env,
      envProblem: whopEnv.problem,
      apiBase: whopEnv.env ? WHOP_API[whopEnv.env] : null,
      apiKey: String(env.WHOP_API_KEY || '').trim(),
      webhookSecret: String(env.WHOP_WEBHOOK_SECRET || '').trim(),
      companyId: String(env.WHOP_COMPANY_ID || '').trim()
    },
    platformFeeBps: percentToBps(env.PAYMENTS_PLATFORM_FEE_PERCENT),
    marketerFeeBps: percentToBps(env.PAYMENTS_MARKETER_FEE_PERCENT),
    reserveBps: percentToBps(env.PAYMENTS_RESERVE_PERCENT) ?? 1000,
    reserveDays: positiveInt(env.PAYMENTS_RESERVE_DAYS, 90),
    // 1 = понедельник (getUTCDay)
    payoutWeekday: 1
  };
}

module.exports = { resolvePaymentSettings, percentToBps, WHOP_API };
