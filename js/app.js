// app.js - SmartFlow shell: bottom navigation, screen routing, Telegram login and back button.
//
// Structure (see docs/ARCHITECTURE.md):
//   Комьюнити · Маркетплейс (+ Офис, только в бизнес-профиле) · Бадди (center, home) · Чаты · Профиль
// Every tab keeps a stack of screens in store.data.ui.routes[tab]; screens are rendered by
// window.SF.screens[tab].render(route, state) from js/screens/*.js.

const SF = window.SF;

// Bottom navigation, left to right. «Комьюнити» replaced «Инкубатор» (owner's decision 21 Nov.)
const TABS = [
  { id: 'community', label: 'Комьюнити', icon: 'users', enabled: true },
  { id: 'marketplace', label: 'Маркетплейс', icon: 'store', enabled: true },
  { id: 'buddy', label: 'Бадди', icon: 'sparkles', enabled: true, center: true },
  { id: 'chats', label: 'Чаты', icon: 'messages-square', enabled: true },
  { id: 'profile', label: 'Настройки', icon: 'settings', enabled: true }
];

// Новичок без ссылки (решение владелицы 24 нояб.): первый экран — Маркетплейс, а Бадди пишет через минуту
// (сервер, welcome-service.js). Пришёл по ссылке (SI-продавец, карточка, приглашение…) — ссылка решает сама.
const startParamNow = () => window.Telegram?.WebApp?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get('startapp');
function afterSignIn(res) {
  // Signed up in the browser (from the home page with ?lang=, or by this device's choice): the server keeps that
  // language, so Buddy's welcome and notifications come in it too. In Telegram, Telegram's language decides.
  if (res && res.signedUp && !SF.inTelegram() && !(res.user && res.user.langChosen)) {
    window.smartFlowApi.setLanguage(SF.lang()).catch(() => {});
  }
  if (!res || !res.signedUp || startParamNow()) return false;
  SF.go('marketplace');
  window.smartFlowApi.buddyWelcome().catch(() => {});
  return true;
}

// -------------------------------------------------------------
// Login: Telegram inside the Mini App, dev login in a local browser preview
// -------------------------------------------------------------
async function initTelegramAuth() {
  const store = window.funnelStore;
  const api = window.smartFlowApi;
  if (!api || !store) return;

  api.onSessionExpired((err) => {
    store.setSessionExpired(err);
  });

  const initData = window.Telegram?.WebApp?.initData;

  if (initData) {
    try {
      const res = await api.loginWithTelegram(initData, 'expert');
      store.setAuth(res);
      afterSignIn(res);
      // The language the server knows (chosen in Профиль or Telegram's) wins over this device's guess
      if (res.user && res.user.lang && SF.setLang && res.user.lang !== SF.lang()) {
        SF.setLang(res.user.lang, { remember: Boolean(res.user.langChosen) });
        store.notify();
      }
    } catch (err) {
      if (err.data?.code === 'TELEGRAM_INITDATA_EXPIRED') {
        store.setSessionExpired(err.data);
      } else if (err.data?.code === 'USER_BLOCKED') {
        store.setAuthOffline(err.message);
      } else {
        store.setAuthOffline(`Подпись Telegram: ${err.message}`);
      }
    }
  } else {
    // A browser or the app installed on the home screen (owner's decisions 23 Nov.): signed in by e-mail before —
    // the saved session; otherwise the sign-in screen. On a developer's computer — the demo sign-in.
    // Back from Google (part 3): the address has #id_token=… — sign in with it
    if (await finishGoogleLogin()) return;
    if (api.getToken()) {
      try {
        store.setAuth(await api.getMe());
        SF.webPush.sync();
        return;
      } catch (err) {
        if (err.status === 401 || err.status === 403) api.clearToken();
        else { store.setAuthOffline(SF.withErrorCode ? SF.withErrorCode('Нет связи с сервером', err) : 'Нет связи с сервером'); return; }
      }
    }
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      try {
        store.setAuth(await api.loginDev('expert'));
        return;
      } catch (err) {
        api.clearToken();
      }
    }
    store.setNeedLogin();
  }
}

// -------------------------------------------------------------
// Sign-in outside Telegram: e-mail → a 6-digit code from the letter (owner's decisions 23 Nov.)
// -------------------------------------------------------------
const login = { step: 'email', email: '', busy: false, error: '', resendAt: 0, google: undefined };

// «Войти через Google» (part 3): the whole page goes to Google and comes back to this same address with
// #id_token=…&state=… (works the same in the browser and in the app on the home screen). nonce and state —
// one-time numbers kept on this device: the server checks nonce inside Google's answer.
const GOOGLE_KEY = 'sf_google_login';
SF.actions.loginGoogle = () => {
  if (!login.google) return;
  const rnd = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  // The link the person came by (?startapp=…) survives the trip to Google and back
  const pending = { nonce: rnd(), state: rnd(), startapp: startParamNow() || null };
  try { sessionStorage.setItem(GOOGLE_KEY, JSON.stringify(pending)); } catch (e) { /* the check below will fail honestly */ }
  const params = new URLSearchParams({
    client_id: login.google,
    redirect_uri: `${location.origin}/`,
    response_type: 'id_token',
    scope: 'openid email profile',
    nonce: pending.nonce,
    state: pending.state,
    prompt: 'select_account'
  });
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
};

async function finishGoogleLogin() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (!hash.get('id_token') && !hash.get('error')) return false;
  history.replaceState(null, '', location.pathname + location.search); // the pass never stays in the address
  let pending = null;
  try { pending = JSON.parse(sessionStorage.getItem(GOOGLE_KEY) || 'null'); sessionStorage.removeItem(GOOGLE_KEY); } catch (e) { /* none */ }
  if (hash.get('error') || !pending || hash.get('state') !== pending.state) {
    login.error = hash.get('error') === 'access_denied' ? 'Вход через Google отменён' : 'Вход через Google не получился — попробуйте ещё раз';
    return false;
  }
  try {
    const res = await window.smartFlowApi.googleLogin(hash.get('id_token'), pending.nonce);
    if (pending.startapp && /^[A-Za-z0-9_-]{1,64}$/.test(pending.startapp)) {
      history.replaceState(null, '', `${location.pathname}?startapp=${encodeURIComponent(pending.startapp)}`);
    }
    window.funnelStore.setAuth(res);
    if (!afterSignIn(res) && startParamNow()) handleStartParam();
    SF.webPush.sync();
    return true;
  } catch (err) {
    login.error = err.message || 'Вход через Google не получился';
    return false;
  }
}

function renderLogin() {
  const field = 'w-full p-3.5 rounded-2xl bg-sunken border border-line-2 text-ink text-base';
  const codeStep = login.step === 'code';
  return `
    <main class="w-full min-h-full flex items-center justify-center p-5">
      <div class="w-full max-w-sm space-y-5">
        <div class="text-center space-y-2">
          <img src="images/logo-mark.webp" alt="SmartFlow" width="64" height="64" class="w-16 h-16 mx-auto" />
          <div class="text-2xl font-extrabold text-ink">SmartFlow</div>
          <div class="text-sm text-muted">${codeStep ? `Код отправлен на ${SF.esc(login.email)}` : 'Вход по почте'}</div>
        </div>
        <form onsubmit="SF.actions.loginSubmit(event)" class="glass-card-3d p-5 space-y-3">
          ${codeStep ? `
            <input id="login-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" placeholder="6 цифр из письма"
              class="${field} text-center tracking-[0.4em] placeholder:tracking-normal font-bold" />
          ` : `
            <input id="login-email" name="email" type="email" autocomplete="email" inputmode="email" value="${SF.esc(login.email)}" placeholder="Ваша почта"
              class="${field}" />
          `}
          ${login.error ? `<div class="text-xs text-si">${SF.esc(login.error)}</div>` : ''}
          <button type="submit" ${login.busy ? 'disabled' : ''} class="w-full py-3.5 rounded-2xl btn-3d-tiffany text-sm font-bold">
            ${login.busy ? 'Минутку…' : codeStep ? 'Войти' : 'Получить код'}
          </button>
          ${codeStep ? `
            <div class="flex items-center justify-between text-xs">
              <button type="button" onclick="SF.actions.loginBack()" class="text-muted underline">Другая почта</button>
              <button type="button" onclick="SF.actions.loginResend()" class="text-brand font-semibold">Отправить ещё раз</button>
            </div>` : ''}
        </form>
        ${!codeStep && login.google ? `
          <div class="flex items-center gap-3 text-[11px] text-faint"><span class="flex-1 h-px bg-line"></span>или<span class="flex-1 h-px bg-line"></span></div>
          <button type="button" onclick="SF.actions.loginGoogle()" class="w-full py-3.5 rounded-2xl bg-card border border-line-2 text-ink text-sm font-bold flex items-center justify-center gap-2.5">
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
            Войти через Google
          </button>` : ''}
        <div class="text-center text-[11px] text-faint">Письмо не пришло? Проверьте «Спам».</div>
        <div class="text-center text-[11px] text-faint" data-no-tr>
          <a href="/privacy" target="_blank" rel="noopener" class="underline">Privacy Policy</a> ·
          <a href="/terms" target="_blank" rel="noopener" class="underline">Terms of Service</a>
        </div>
      </div>
    </main>`;
}

function drawLogin() {
  const container = document.getElementById('app-root');
  if (!container) return;
  if (login.google === undefined) {
    login.google = null;
    window.smartFlowApi.googleConfig().then(c => { login.google = c.clientId || null; if (login.google) drawLogin(); }).catch(() => {});
  }
  container.innerHTML = renderLogin();
  if (window.lucide) window.lucide.createIcons();
  if (SF.translateDom) SF.translateDom(container);
  const input = document.getElementById(login.step === 'code' ? 'login-code' : 'login-email');
  if (input) setTimeout(() => input.focus(), 50);
}

SF.actions = SF.actions || {};
SF.actions.loginSubmit = async (e) => {
  e.preventDefault();
  if (login.busy) return;
  const api = window.smartFlowApi;
  login.error = '';
  login.busy = true;
  try {
    if (login.step === 'email') {
      login.email = String(e.target.email.value || '').trim();
      await api.emailLoginStart(login.email);
      login.step = 'code';
    } else {
      const res = await api.emailLoginVerify(login.email, String(e.target.code.value || '').trim());
      login.busy = false;
      login.step = 'email';
      window.funnelStore.setAuth(res);
      SF.webPush.sync();
      // По ссылке — туда, куда она ведёт; новичок без ссылки — Маркетплейс; иначе Бадди
      if (!afterSignIn(res)) { if (startParamNow()) handleStartParam(); else SF.go('buddy'); }
      return;
    }
  } catch (err) {
    login.error = err.message || 'Не получилось';
  }
  login.busy = false;
  drawLogin();
};
SF.actions.loginBack = () => { login.step = 'email'; login.error = ''; drawLogin(); };
SF.actions.loginResend = async () => {
  try {
    await window.smartFlowApi.emailLoginStart(login.email);
    login.error = '';
    SF.showToast('Новый код отправлен');
  } catch (err) {
    login.error = err.message || 'Не получилось';
  }
  drawLogin();
};

// -------------------------------------------------------------
// The app on the home screen (PWA): the service worker, «Установить на экран»
// -------------------------------------------------------------
SF.inTelegram = () => Boolean(window.Telegram?.WebApp?.initData);
SF.isInstalled = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
SF.isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (window.funnelStore) window.funnelStore.notify();
});
window.addEventListener('appinstalled', () => { installPrompt = null; SF.showToast('SmartFlow на экране телефона 🎉'); });
if ('serviceWorker' in navigator && !SF.inTelegram()) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
SF.canInstall = () => !SF.inTelegram() && !SF.isInstalled();
SF.actions = SF.actions || {};
SF.actions.installApp = async () => {
  if (installPrompt) {
    installPrompt.prompt();
    try { await installPrompt.userChoice; } catch (e) {}
    installPrompt = null;
    return;
  }
  // iPhone / iPad (Safari) and browsers without the button: how to do it by hand
  SF.openModal(`
    <div class="flex items-start justify-between gap-3">
      <div class="text-base font-bold text-ink">Установить SmartFlow на экран</div>
      <button onclick="SF.closeModal()" class="text-muted text-lg leading-none" aria-label="Закрыть">&times;</button>
    </div>
    ${SF.isIOS() ? `
      <ol class="space-y-2 text-sm text-ink-2 list-decimal pl-5">
        <li>Откройте эту страницу в <b>Safari</b>.</li>
        <li>Нажмите <b>«Поделиться»</b> (квадрат со стрелкой вверх).</li>
        <li>Выберите <b>«На экран „Домой“»</b> → <b>«Добавить»</b>.</li>
      </ol>
      <div class="text-xs text-muted">На iPhone уведомления приходят только в установленное приложение.</div>` : `
      <ol class="space-y-2 text-sm text-ink-2 list-decimal pl-5">
        <li>Откройте меню браузера (⋮ вверху справа).</li>
        <li>Нажмите <b>«Установить приложение»</b> или <b>«Добавить на главный экран»</b>.</li>
      </ol>`}
  `);
};

// «Выйти» (browser / installed app only: inside Telegram the account is Telegram's)
SF.actions.logout = async () => {
  if (!window.confirm('Выйти из SmartFlow на этом устройстве?')) return;
  await SF.webPush.forgetDevice(); // notifications for this account stop coming to this device
  SF.setAppBadge(0);
  window.smartFlowApi.clearToken();
  window.funnelStore.resetToDefault();
  window.funnelStore.setNeedLogin();
};

// -------------------------------------------------------------
// Notifications on this device (Web Push; browser login, part 2 — owner's decisions 23 Nov.)
// Only outside Telegram (inside it the bot notifies). iPhone / iPad: only in the app installed on the home screen.
// The browser asks the person once; «Запретить» can be changed only in the browser's settings.
// -------------------------------------------------------------
SF.webPush = (() => {
  const supported = () => !SF.inTelegram() && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  // 'on' | 'off' (can ask) | 'blocked' (denied in the browser) | 'install' (iPhone: install first) | 'unsupported'
  function state() {
    if (SF.inTelegram()) return 'unsupported';
    if (SF.isIOS() && !SF.isInstalled()) return 'install';
    if (!supported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    if (Notification.permission === 'granted' && SF.webPush.subscribed) return 'on';
    return 'off';
  }
  const keyBytes = (base64) => {
    const pad = '='.repeat((4 - (base64.length % 4)) % 4);
    const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  };
  const registration = async () => {
    await navigator.serviceWorker.register('sw.js').catch(() => null);
    return navigator.serviceWorker.ready;
  };
  async function subscribeHere(publicKey) {
    const reg = await registration();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    await window.smartFlowApi.push.subscribe(sub.toJSON());
    SF.webPush.subscribed = true;
  }
  // On every start: notifications already allowed — make sure the server knows this device for this account
  async function sync() {
    try {
      if (!supported() || !window.smartFlowApi.getToken()) return;
      if (Notification.permission !== 'granted') { SF.webPush.subscribed = false; return; }
      const status = await window.smartFlowApi.push.status();
      SF.webPush.status = status;
      if (status.configured && status.publicKey) await subscribeHere(status.publicKey);
      if (window.funnelStore) window.funnelStore.notify();
    } catch (e) { /* not now: next start */ }
  }
  // The button «Включить»: the browser's question, then this device is saved
  async function enable() {
    const s = state();
    if (s === 'install') return SF.actions.installApp();
    if (s === 'blocked') return SF.webPush.blockedHelp();
    if (s === 'unsupported') return SF.showToast('Этот браузер не умеет присылать уведомления — откройте SmartFlow в Chrome или Safari');
    try {
      const status = await window.smartFlowApi.push.status();
      SF.webPush.status = status;
      if (!status.configured || !status.publicKey) return SF.showToast('Уведомления скоро заработают');
      const answer = await Notification.requestPermission();
      if (answer !== 'granted') {
        window.funnelStore.notify();
        return SF.showToast(answer === 'denied' ? 'Уведомления запрещены — их можно разрешить в настройках браузера' : 'Уведомления не включены');
      }
      await subscribeHere(status.publicKey);
      SF.webPush.dismissPrompt();
      SF.showToast('Готово! Уведомления включены 🔔');
      // A test right away: the person sees that it really works on this device
      window.smartFlowApi.push.test().catch(() => {});
    } catch (err) {
      SF.showToast(SF.withErrorCode ? SF.withErrorCode('Не получилось включить уведомления', err) : 'Не получилось включить уведомления');
    }
    window.funnelStore.notify();
  }
  async function forgetDevice() {
    try {
      if (!supported()) return;
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if (!sub) return;
      await window.smartFlowApi.push.unsubscribe(sub.endpoint).catch(() => {});
      await sub.unsubscribe().catch(() => {});
      SF.webPush.subscribed = false;
    } catch (e) { /* signing out anyway */ }
  }
  function blockedHelp() {
    SF.openModal(`
      <div class="flex items-start justify-between gap-3">
        <div class="text-base font-bold text-ink">Уведомления запрещены</div>
        <button onclick="SF.closeModal()" class="text-muted text-lg leading-none" aria-label="Закрыть">&times;</button>
      </div>
      ${SF.isIOS() ? `
        <ol class="space-y-2 text-sm text-ink-2 list-decimal pl-5">
          <li>Откройте <b>Настройки</b> iPhone → <b>Уведомления</b>.</li>
          <li>Найдите <b>SmartFlow</b> и включите <b>«Допуск уведомлений»</b>.</li>
        </ol>` : `
        <ol class="space-y-2 text-sm text-ink-2 list-decimal pl-5">
          <li>Нажмите на значок слева от адреса сайта (замок или ⓘ).</li>
          <li>Найдите <b>«Уведомления»</b> и выберите <b>«Разрешить»</b>.</li>
          <li>Обновите страницу.</li>
        </ol>`}
    `);
  }
  // The soft card at Buddy: until notifications are on; «Позже» hides it for 3 days on this device
  const PROMPT_KEY = 'sf_push_prompt_hidden_at';
  function showPrompt() {
    const s = state();
    if (s === 'on' || s === 'unsupported' || s === 'blocked') return false;
    try {
      const at = Number(localStorage.getItem(PROMPT_KEY) || 0);
      if (at && Date.now() - at < 3 * 24 * 3600 * 1000) return false;
    } catch (e) { /* storage closed: show */ }
    return true;
  }
  function dismissPrompt() {
    try { localStorage.setItem(PROMPT_KEY, String(Date.now())); } catch (e) { /* fine */ }
    if (window.funnelStore) window.funnelStore.notify();
  }
  async function setEmail(on) {
    try {
      const res = await window.smartFlowApi.push.setEmail(on);
      SF.webPush.status = { ...(SF.webPush.status || {}), emailNotify: res.emailNotify };
      SF.showToast(on ? 'Важное будет приходить на почту, если уведомления не дошли' : 'Письма о важном выключены');
    } catch (err) {
      SF.showToast('Не получилось сохранить');
    }
    window.funnelStore.notify();
  }
  async function loadStatus() {
    if (SF.inTelegram() || SF.webPush.loading) return;
    SF.webPush.loading = true;
    SF.webPush.loaded = true;
    try {
      SF.webPush.status = await window.smartFlowApi.push.status();
    } catch (e) { SF.webPush.status = SF.webPush.status || null; }
    SF.webPush.loading = false;
    window.funnelStore.notify();
  }
  return { subscribed: false, status: null, loading: false, loaded: false, supported, state, sync, enable, forgetDevice, blockedHelp, showPrompt, dismissPrompt, setEmail, loadStatus };
})();

window.reconnectTelegramAuth = () => {
  initTelegramAuth();
  SF.showToast('Обновляю вход через Telegram...');
};

// -------------------------------------------------------------
// Scripts that are not needed for the first screen
// -------------------------------------------------------------
const CONFETTI_SRC = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js';

SF.confetti = function () {
  if (window.confetti) window.confetti({ particleCount: 70, spread: 60 });
};

function loadNonCriticalScripts() {
  const run = () => {
    const el = document.createElement('script');
    el.src = CONFETTI_SRC;
    el.async = true;
    document.head.appendChild(el);
  };
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 1500 });
  } else {
    setTimeout(run, 300);
  }
}

// The bot may write to a person only with their permission. Telegram shows a one-tap
// "Allow messages" prompt; asked when notifications start to matter (Office, "Связаться с человеком"),
// and after the person's message to an SI-seller, Buddy or a person — otherwise the answer, a reminder
// or a follow-up would never reach their Telegram.
// { auto: true }: asked by the app itself (after sending a message) — at most once in 3 days on this
// device, so a person who said "no" is not asked after every message. A tap on «Включить» always asks.
const WRITE_ASK_KEY = 'sf_write_ask_at';
const WRITE_ASK_EVERY_MS = 3 * 24 * 3600 * 1000;
SF.askWriteAccess = function (onResult, { auto = false } = {}) {
  const tg = window.Telegram?.WebApp;
  try {
    if (!tg || !tg.initData) return;
    if (tg.initDataUnsafe?.user?.allows_write_to_pm) {
      if (onResult) onResult(true);
      return;
    }
    if (auto) {
      let last = 0;
      try { last = Number(localStorage.getItem(WRITE_ASK_KEY)) || 0; } catch (e) {}
      if (Date.now() - last < WRITE_ASK_EVERY_MS) return;
      try { localStorage.setItem(WRITE_ASK_KEY, String(Date.now())); } catch (e) {}
    }
    if (typeof tg.requestWriteAccess === 'function') {
      tg.requestWriteAccess((allowed) => {
        if (allowed && tg.initDataUnsafe?.user) tg.initDataUnsafe.user.allows_write_to_pm = true;
        if (onResult) onResult(Boolean(allowed));
      });
    }
  } catch (e) {}
};

// true / false when known (inside Telegram), null outside Telegram
SF.botCanWrite = function () {
  const user = window.Telegram?.WebApp?.initDataUnsafe?.user;
  return user ? Boolean(user.allows_write_to_pm) : null;
};

// -------------------------------------------------------------
// Support: details attached to a complaint, error codes for app crashes
// -------------------------------------------------------------
// Phone and system, Telegram version, current screen, last error codes. No message texts.
SF.supportContext = function () {
  const tg = window.Telegram?.WebApp;
  const state = window.funnelStore.data;
  const tab = state.ui.tab;
  const route = window.funnelStore.currentRoute(tab);
  const appScript = document.querySelector('script[src*="js/app.js"]');
  let timezone = null;
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
  return {
    platform: tg?.platform || 'browser',
    tgVersion: tg?.version || null,
    userAgent: navigator.userAgent,
    screen: `${window.innerWidth}x${window.innerHeight}`,
    colorScheme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
    appVersion: appScript ? (new URL(appScript.src, location.href).searchParams.get('v') || 'dev') : null,
    route: [tab, route.screen, route.slug || route.id || route.section].filter(Boolean).join(' / '),
    botCanWrite: SF.botCanWrite(),
    online: navigator.onLine,
    language: navigator.language,
    timezone,
    authStatus: state.auth?.status || null,
    recentErrors: window.smartFlowApi.recentErrors()
  };
};

// An error inside the app itself: a code the person can dictate, saved on the phone and on the server
SF.reportAppError = function (err, where) {
  const api = window.smartFlowApi;
  const code = api.newErrorCode();
  const message = `${where}: ${(err && (err.stack || err.message)) || err}`.slice(0, 1000);
  api.rememberError({ code, status: -1, path: where, message: String((err && err.message) || err).slice(0, 200) });
  api.reportError(code, message, SF.supportContext().route);
  return code;
};

let lastCrashToastAt = 0;
function onAppCrash(err, where) {
  const code = SF.reportAppError(err, where);
  if (Date.now() - lastCrashToastAt > 10000) {
    lastCrashToastAt = Date.now();
    SF.showToast(`Что-то пошло не так. Код ошибки ${code} — назовите его в поддержке`);
  }
}

window.addEventListener('error', (e) => {
  // Only our own scripts: Telegram and other sites' scripts report "Script error." without details
  if (!e.filename || !/\/js\//.test(e.filename) || /telegram\.org/.test(e.filename)) return;
  onAppCrash(e.error || e.message, `js ${e.filename.split('/').pop()}:${e.lineno}`);
});
window.addEventListener('unhandledrejection', (e) => {
  // Failed server requests already have their code (js/api-client.js)
  if (e.reason && e.reason.status !== undefined) return;
  onAppCrash(e.reason, 'promise');
});

// -------------------------------------------------------------
// Navigation helpers used by screens (onclick="SF.go('chats')")
// -------------------------------------------------------------
SF.go = (tab) => {
  const def = TABS.find(t => t.id === tab);
  if (!def) return;
  if (!def.enabled) {
    SF.showToast(`${def.label} появится в следующих версиях`);
    return;
  }
  window.funnelStore.setTab(tab);
};

SF.push = (screen, params = {}, tab) => window.funnelStore.pushRoute({ screen, ...params }, tab);
SF.patch = (params) => window.funnelStore.patchRoute(params);
SF.back = () => window.funnelStore.popRoute();

// Opens a screen in another tab with that tab's first screen underneath (for Back)
SF.openIn = (tab, screen, params = {}) => {
  const store = window.funnelStore;
  store.data.ui.routes[tab] = store.data.ui.routes[tab].slice(0, 1);
  store.pushRoute({ screen, ...params }, tab);
};

// Links shared outside the app: t.me/smartflow_ai_support_bot/app?startapp=<param> (SF.appLink;
// the test copy has its own bot, the server tells its link at sign-in)
//   (no param)      → Buddy (first sign-up without a link — the Marketplace, Buddy writes a minute later)
//   C_<projectId>   → consultant card in the Marketplace
//   P_<userId>      → a person's profile
//   I_<projectId>   → "Мне написали" in the Office (bot notification button)
//   A_<feedbackId>  → a complaint in the support panel (bot message to the team)
//   S_support       → the "Поддержка" chat (bot message with the team's answer)
//   ADMIN           → the support panel (link for the support team)
//   <slug>          → chat with that SI-consultant (the consultant's own link)
//   <slug>__<code>  → the same chat by a link with a traffic source (Офис → «Ссылки с меткой источника»)
//   R_<code>        → an invitation to SmartFlow (Профиль → «Пригласить»): Buddy
//   F_<funnelId>    → a ready-made funnel in the Office (the team's decision for its author)
//   FREVIEW         → funnels waiting for the team's review (support panel)
//   FSALES          → «Мои воронки»: purchases of my funnels waiting for my confirmation
//   G_<groupId>     → a group conversation in «Чаты» (bot notifications about it)
//   J_<code>        → an invitation link to a group: «Вступить»
//   K_<communityId> → a community in «Комьюнити» (its link; notifications about requests and payments)
//   KP_<postId>     → a post of a community with its comments (notifications about comments, announcements)
// Prefixes are uppercase, so they never clash with slugs (always lowercase).
function handleStartParam() {
  const tg = window.Telegram?.WebApp;
  SF.openStartParam(tg?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get('startapp'));
}

// The same places open from a notification in Buddy (it keeps the bot button's start param)
SF.openStartParam = (param) => {
  if (!param || !/^[A-Za-z0-9_-]{1,64}$/.test(param)) return;
  if (param.startsWith('C_')) {
    SF.openIn('marketplace', 'consultant', { id: param.slice(2) });
  } else if (param.startsWith('P_')) {
    SF.openIn('marketplace', 'person', { id: param.slice(2) });
  } else if (param.startsWith('I_')) {
    // «Мне написали» lives inside the SI-продавец now («Бизнес-режим 2.0»)
    SF.openIn('profile', 'office-consultant', { id: param.slice(2), tab: 'income', ctab: 'inbox' });
  } else if (param.startsWith('A_')) {
    SF.openIn('profile', 'admin-feedback', { id: param.slice(2) });
  } else if (param.startsWith('KP_')) {
    SF.openIn('community', 'community-post', { postId: param.slice(3) });
  } else if (param.startsWith('K_')) {
    SF.openIn('community', 'community', { id: param.slice(2), view: 'feed' });
  } else if (param.startsWith('G_')) {
    SF.actions.openGroup(param.slice(2));
  } else if (param.startsWith('J_')) {
    SF.openIn('chats', 'group-join', { code: param.slice(2) });
  } else if (param.startsWith('U_')) {
    SF.openIn('chats', 'person', { id: param.slice(2) });
  } else if (param === 'CAL') {
    // The calendar of the business: inside an SI-продавец of the open business, «Клиенты» → «Календарь»
    const seller = window.funnelStore.consultantsOfCurrent()[0] || window.funnelStore.data.office.consultants[0];
    if (seller) SF.openIn('profile', 'office-consultant', { id: seller.id, tab: 'income', ctab: 'calendar' });
    else SF.openIn('profile', 'office');
  } else if (param === 'ADMIN') {
    SF.openIn('profile', 'admin');
  } else if (param === 'FSALES') {
    SF.openIn('profile', 'office-funnels', { view: 'mine' });
  } else if (param === 'FREVIEW') {
    SF.openIn('profile', 'admin-funnels');
  } else if (param.startsWith('F_')) {
    SF.openIn('marketplace', 'office-funnel', { id: param.slice(2) });
  } else if (param.startsWith('GO_')) {
    // A button under Buddy's message: a section of the app
    const tab = param.slice(3);
    if (tab === 'office') SF.openIn('profile', 'office');
    else if (['marketplace', 'chats', 'profile'].includes(tab)) SF.go(tab);
  } else if (param.startsWith('S_')) {
    SF.openIn('chats', 'chat', { slug: 'assistant' });
  } else if (param.startsWith('R_')) {
    // An invitation to SmartFlow: the server counted it at sign-in; the person starts at Buddy
  } else if (param.includes('__')) {
    // A link with a traffic source: <slug>__<code> → that SI-seller's chat (the server counted the source)
    SF.openIn('chats', 'chat', { slug: param.split('__')[0] });
  } else {
    SF.openIn('chats', 'chat', { slug: param });
  }
};

// -------------------------------------------------------------
// Rendering
// -------------------------------------------------------------
let lastRouteKey = null;

function renderApp(state) {
  const container = document.getElementById('app-root');
  if (!container) return;
  // Outside Telegram and not signed in: only the sign-in screen
  if (state.auth?.status === 'login') {
    if (!container.querySelector('#login-email, #login-code')) drawLogin();
    return;
  }

  // The new look (flag design-v2, only BETA_USERS for now): <html data-design="v2">
  if (SF.ds) SF.ds.apply();

  const tab = state.ui.tab;
  const stack = state.ui.routes[tab];
  const route = stack[stack.length - 1];
  const screen = SF.screens[tab];
  const routeKey = `${tab}:${stack.length}:${route.screen}:${route.id || route.slug || ''}`;

  // Keep the scroll position when the same screen re-renders (e.g. after ticking a box)
  const body = document.getElementById('screen-body');
  const keepScroll = body && routeKey === lastRouteKey ? body.scrollTop : 0;

  // Keep what is being typed in fields marked data-keep (a new chat message arrives meanwhile)
  const kept = routeKey === lastRouteKey
    ? [...document.querySelectorAll('[data-keep]')].map(el => ({ key: el.dataset.keep, value: el.value, focused: el === document.activeElement }))
    : [];

  // A broken screen must not leave a blank app: show a code and a way out instead
  let title = '';
  let content = '';
  try {
    // Titles are plain text and may hold names people chose: always escaped here
    title = screen.title ? screen.title(route, state) : '';
    content = screen.render(route, state);
  } catch (err) {
    console.error('[SmartFlow] screen failed:', err);
    content = renderScreenError(SF.reportAppError(err, `render ${tab}/${route.screen}`));
  }
  const canGoBack = stack.length > 1;
  // Conversations fill the screen down to the input (on tall phones and iPad the input stayed mid-screen)
  const isChatScreen = state.ui.tab === 'chats' && ['chat', 'person', 'group'].includes(route.screen);

  container.innerHTML = `
    ${state.auth?.status === 'expired' ? renderSessionExpired() : ''}

    <main class="w-full flex-1 min-h-0 flex flex-col items-center">
      <div class="app-frame">
        ${state.app?.env === 'staging' ? '<div class="test-strip">ТЕСТ · тестовая копия SmartFlow</div>' : ''}
        <header class="tg-header flex items-center gap-2">
          ${canGoBack ? `
            <button onclick="SF.back()" class="p-1.5 -ml-1.5 rounded-xl text-muted hover:text-ink" aria-label="Назад">
              <i data-lucide="chevron-left" class="w-5 h-5"></i>
            </button>
          ` : `<img src="images/logo-mark.webp" alt="SmartFlow" width="28" height="28" class="w-7 h-7" />`}
          <div class="flex-1 min-w-0">
            <div class="text-sm font-bold text-ink truncate">${SF.esc(title)}</div>
          </div>
          <button onclick="SF.go('profile')" class="flex-shrink-0" aria-label="Профиль">
            ${SF.avatar(state.me.photoUrl, { size: 30, kind: 'human', userId: state.me.id })}
          </button>
        </header>

        <div class="flex-1 overflow-y-auto px-4 py-4 space-y-3.5 ${isChatScreen ? 'flex flex-col' : ''}" id="screen-body">
          ${content}
        </div>

        ${renderBottomNav(state)}
      </div>
    </main>

    <div id="modal-container"></div>
  `;

  const newBody = document.getElementById('screen-body');
  if (newBody && keepScroll) newBody.scrollTop = keepScroll;
  kept.forEach(({ key, value, focused }) => {
    const el = document.querySelector(`[data-keep="${key}"]`);
    if (!el) return;
    el.value = value;
    if (focused) el.focus();
  });
  lastRouteKey = routeKey;

  syncTelegramBackButton(canGoBack);
  if (!(tab === 'chats' && ['chat', 'person', 'group'].includes(route.screen)) && !(tab === 'marketplace' && route.screen === 'office-client')) {
    SF.data.stopPolling();
  }
  try {
    if (screen.afterRender) screen.afterRender(route, state);
    // The red dot on Buddy stays fresh on every screen (a request at most once a minute)
    if (SF.data.notifications) SF.data.notifications(60000);
    // Messages from people and groups: the number on «Чаты» stays fresh too
    if (SF.data.peopleChats) SF.data.peopleChats(60000);
    if (SF.data.groups) SF.data.groups(60000);
  } catch (err) {
    console.error('[SmartFlow] afterRender failed:', err);
    SF.reportAppError(err, `afterRender ${tab}/${route.screen}`);
  }
  // Who has the «SMARTFLOW PARTNER» badge (shown next to people's photos and names everywhere)
  if (SF.data && SF.data.partners) SF.data.partners();
  if (window.lucide) window.lucide.createIcons();
  // English for clients: the Office and the support panel stay Russian (owner's decision)
  SF.clientScreen = !(tab === 'marketplace' && String(route.screen).startsWith('office')) && !(tab === 'profile' && String(route.screen).startsWith('admin'));
  if (SF.clientScreen && SF.translateDom) SF.translateDom(container);
}

// The number on the app icon (iPhone / iPad 16.4+ in the installed app, some browsers); not inside Telegram.
// Changed only when the number changes.
let shownBadge = null;
SF.setAppBadge = (n) => {
  const value = Math.max(0, Math.min(99, Number(n) || 0));
  if (value === shownBadge || SF.inTelegram() || !('setAppBadge' in navigator)) return;
  shownBadge = value;
  (value ? navigator.setAppBadge(value) : navigator.clearAppBadge()).catch(() => {});
};

function renderBottomNav(state) {
  const badges = {
    chats: (state.remote.chats || []).filter(c => SF.data.isUnread(state, c)).length +
      (state.remote.peopleChats || []).filter(c => c.unread || c.needsMyAnswer).length +
      (SF.groups ? SF.groups.unreadCount(state) : 0),
    // Communities with new posts or requests / payments waiting for me
    community: SF.community ? SF.community.unreadCount(state) : 0
  };
  // Red dot on Buddy: there are unread notifications
  const buddyUnread = Boolean(state.remote.notifications && state.remote.notifications.unread);
  // The red number on the icon of the installed app: the same marks as on the tabs (owner's decision 24 Nov.)
  SF.setAppBadge(((state.remote.notifications && Number(state.remote.notifications.unread)) || 0) + badges.chats + badges.community);
  return `
    <nav class="tg-nav-bar grid grid-cols-5 items-end">
      ${TABS.map(t => {
        const active = state.ui.tab === t.id;
        if (t.center) {
          return `
            <button onclick="SF.go('${t.id}')" class="flex flex-col items-center gap-0.5 -mt-6" aria-label="${t.label}${buddyUnread ? ': есть новые уведомления' : ''}">
              <span class="buddy-nav-btn relative ${active ? 'active' : ''}">
                <img src="${SF.MASCOTS.buddy}" alt="" class="w-11 h-11" />
                ${buddyUnread ? '<span class="absolute top-0.5 right-0.5 w-3 h-3 rounded-full bg-rose-500 border-2 border-card"></span>' : ''}
              </span>
              <span class="text-[11px] font-semibold ${active ? 'text-brand' : 'text-muted'}">${t.label}</span>
            </button>`;
        }
        return `
          <button onclick="SF.go('${t.id}')" class="tg-nav-item relative ${active ? 'active' : ''} ${t.enabled ? '' : 'opacity-50'}">
            <i data-lucide="${t.icon}" class="w-5 h-5"></i>
            <span class="truncate max-w-full">${t.label}</span>
            ${!t.enabled ? `<span class="absolute -top-1.5 left-1/2 -translate-x-1/2">${SF.soonBadge()}</span>` : ''}
            ${badges[t.id] ? (SF.ds && SF.ds.on()
              ? `<span class="absolute top-0.5 right-3">${SF.ds.count(badges[t.id])}</span>`
              : `<span class="absolute top-0.5 right-3 min-w-4 h-4 px-1 rounded-full bg-[#81D8D0] text-[#08302c] text-[9px] font-bold flex items-center justify-center">${badges[t.id]}</span>`) : ''}
          </button>`;
      }).join('')}
    </nav>
  `;
}

function renderScreenError(code) {
  return `
    <div class="glass-card-3d p-5 text-center space-y-3">
      <img src="${SF.MASCOTS.assistant}" alt="" class="w-20 h-20 mx-auto" />
      <div class="text-sm font-bold text-ink">Этот экран не открылся</div>
      <div class="text-xs text-muted leading-relaxed">Код ошибки <b class="text-ink">${code}</b>. Назовите его в поддержке — так мы быстрее найдём причину.</div>
      <div class="grid grid-cols-2 gap-2">
        <button onclick="SF.actions.openSupport()" class="py-2.5 rounded-xl btn-3d-tiffany text-xs">Написать в поддержку</button>
        <button onclick="SF.actions.resetDemo()" class="py-2.5 rounded-xl btn-3d-dark text-xs">Очистить данные на телефоне</button>
      </div>
    </div>`;
}

SF.actions.openSupport = () => SF.openIn('chats', 'chat', { slug: 'assistant' });

function renderSessionExpired() {
  return `
    <div class="fixed inset-0 z-50 bg-ink/40 backdrop-blur-md flex items-center justify-center p-4">
      <div class="w-full max-w-md bg-card border border-line rounded-3xl p-6 shadow-2xl text-center space-y-4">
        <img src="${SF.MASCOTS.assistant}" alt="" class="w-20 h-20 mx-auto" />
        <div>
          <h3 class="text-lg font-bold text-ink">Сессия Telegram завершена</h3>
          <p class="text-xs text-muted mt-1">Вход через Telegram действует 24 часа. Все ваши данные сохранены на сервере SmartFlow.</p>
        </div>
        <button onclick="window.reconnectTelegramAuth()" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm font-bold flex items-center justify-center gap-2">
          <i data-lucide="refresh-cw" class="w-4 h-4"></i>
          <span>Обновить вход через Telegram</span>
        </button>
      </div>
    </div>
  `;
}

// Telegram's own Back button (top-left in the Telegram header) mirrors our in-app back arrow
let backButtonBound = false;
function syncTelegramBackButton(visible) {
  const bb = window.Telegram?.WebApp?.BackButton;
  if (!bb || !window.Telegram.WebApp.initData) return;
  try {
    if (!backButtonBound) {
      bb.onClick(() => SF.back());
      backButtonBound = true;
    }
    if (visible) bb.show(); else bb.hide();
  } catch (e) {}
}

// -------------------------------------------------------------
// Start
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // Telegram.WebApp.ready()/expand() are called inline in index.html, right after the splash.
  window.funnelStore.subscribe(renderApp);
  handleStartParam();
  renderApp(window.funnelStore.data);
  initTelegramAuth();
  loadNonCriticalScripts();
});
