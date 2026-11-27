// server/services/payments/ledger.js - Деньги в нашем учёте: только целые минимальные единицы (центы).
//
// Whop присылает суммы строкой в основных единицах ("10.00") с числом знаков (decimals) —
// переводим в целые без float. Доли считаются целыми: комиссии округляются вниз,
// остаток всегда у продавца, сумма долей = сумме списания до цента.

// { amount: "10.50", decimals: 2 } → 1050; строка "10.5" с decimals=2 → 1050; число 10.5 → 1050
function moneyToMinor(money, decimalsFallback = 2) {
  if (money == null) return null;
  const amount = typeof money === 'object' ? money.amount : money;
  const decimals = typeof money === 'object' && Number.isInteger(money.decimals) ? money.decimals : decimalsFallback;
  const text = String(amount).trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m || decimals < 0 || decimals > 6) return null;
  const frac = (m[3] || '').padEnd(decimals, '0');
  if (frac.length > decimals && /[1-9]/.test(frac.slice(decimals))) return null; // больше знаков, чем у валюты
  const minor = parseInt(m[2] + frac.slice(0, decimals), 10);
  if (!Number.isSafeInteger(minor)) return null;
  return m[1] ? -minor : minor;
}

// Доля в сотых долях процента (1000 = 10%), округление вниз
function feeOf(amountMinor, bps) {
  if (!bps) return 0;
  return Math.floor((amountMinor * bps) / 10000);
}

/**
 * Разбивка одного списания на доли. platformBps / marketerBps — проценты из снимка заказа.
 * → { seller, platform, marketer, applicationFee } (applicationFee = platform + marketer —
 *   столько удерживает платформа при прямом списании на продавца в сценарии 5)
 */
function splitCharge(amountMinor, { platformBps = 0, marketerBps = 0 } = {}) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new Error('ledger: amount must be a non-negative integer');
  if ((platformBps || 0) + (marketerBps || 0) > 10000) throw new Error('ledger: fees above 100%');
  const platform = feeOf(amountMinor, platformBps);
  const marketer = feeOf(amountMinor, marketerBps);
  return { seller: amountMinor - platform - marketer, platform, marketer, applicationFee: platform + marketer };
}

module.exports = { moneyToMinor, feeOf, splitCharge };
