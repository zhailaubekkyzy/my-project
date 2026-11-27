// server/services/payments/provider.js - Что должен уметь любой провайдер оплат (сейчас один — Whop).
//
// Модуль оплат не привязан к провайдеру (решение владелицы): учёт денег — в наших таблицах
// (payment_orders / payment_charges / payment_shares / payment_payouts / payment_reserves),
// провайдер только проводит деньги. Новый провайдер = новый файл-адаптер с этими функциями.
//
// Шаг 0 (сейчас):
//   name                               'whop'
//   status()                           { env, configured, … } — без ключей, для /api/health и панели
//   isConfigured()                     ключ + секрет вебхуков + явный режим (песочница / боевой)
//   verifyWebhook(rawBody, headers)    { ok: true, eventId, event } или { ok: false, reason }
//   normalizeEvent(event)              { type, objectId, data } — тип события в нашем словаре
// Следующие шаги (добавляются в адаптер по мере сценариев):
//   createCheckout(order)              шаг 1: ссылка на оплату (план SmartFlow или прямое списание с комиссией)
//   createSellerAccount(user)          шаг 2: подаккаунт продавца
//   onboardingLink(account)            шаг 2: ссылка на проверку личности (KYC) на странице провайдера
//   transfer(payout)                   шаг 4: перевод доли маркетолога со счёта SmartFlow
const REQUIRED = ['status', 'isConfigured', 'verifyWebhook', 'normalizeEvent'];

// События, которые понимает наш модуль (провайдер переводит свои названия в эти)
const EVENT_TYPES = Object.freeze([
  'payment.succeeded', 'payment.failed', 'payment.pending',
  'refund.created', 'refund.updated',
  'dispute.created', 'dispute.updated',
  'membership.activated', 'membership.deactivated',
  'account.updated',
  'other'
]);

function assertProvider(adapter) {
  if (!adapter || typeof adapter.name !== 'string' || !adapter.name) throw new Error('payments: provider without a name');
  const missing = REQUIRED.filter(fn => typeof adapter[fn] !== 'function');
  if (missing.length) throw new Error(`payments: provider "${adapter.name}" lacks ${missing.join(', ')}`);
  return adapter;
}

// Ошибка провайдера: сообщение для логов и панели — без ключа и без данных клиента
class PaymentProviderError extends Error {
  constructor(message, { status = null, provider = null } = {}) {
    super(message);
    this.name = 'PaymentProviderError';
    this.providerStatus = status;
    this.provider = provider;
    this.status = 502;
  }
}

module.exports = { REQUIRED, EVENT_TYPES, assertProvider, PaymentProviderError };
