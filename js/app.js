// app.js - SmartFlow shell: bottom navigation, screen routing, Telegram login and back button.
//
// Structure (see docs/ARCHITECTURE.md):
//   Инкубатор (later) · Маркетплейс (+ Офис) · Бадди (center, home) · Чаты · Профиль
// Every tab keeps a stack of screens in store.data.ui.routes[tab]; screens are rendered by
// window.SF.screens[tab].render(route, state) from js/screens/*.js.

const SF = window.SF;

// Bottom navigation, left to right. Community is planned: switch `enabled` on when it is built.
const TABS = [
  { id: 'incubator', label: 'Инкубатор', icon: 'sprout', enabled: false },
  { id: 'marketplace', label: 'Маркетплейс', icon: 'store', enabled: true },
  { id: 'buddy', label: 'Бадди', icon: 'sparkles', enabled: true, center: true },
  { id: 'chats', label: 'Чаты', icon: 'messages-square', enabled: true },
  { id: 'profile', label: 'Профиль', icon: 'circle-user-round', enabled: true }
];

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
    // Browser preview outside Telegram (works only on a local/dev server)
    try {
      store.setAuth(await api.loginDev('expert'));
    } catch (err) {
      api.clearToken();
      store.setAuthOffline('Откройте приложение в Telegram');
    }
  }
}

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
// "Allow messages" prompt; asked when notifications start to matter (Office, "Связаться с человеком").
SF.askWriteAccess = function (onResult) {
  const tg = window.Telegram?.WebApp;
  try {
    if (!tg || !tg.initData) return;
    if (tg.initDataUnsafe?.user?.allows_write_to_pm) {
      if (onResult) onResult(true);
      return;
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

// Links shared outside the app: t.me/smartflow_ai_support_bot/app?startapp=<param>
//   (no param)      → Buddy
//   C_<projectId>   → consultant card in the Marketplace
//   P_<userId>      → a person's profile
//   I_<projectId>   → "Мне написали" in the Office (bot notification button)
//   A_<feedbackId>  → a complaint in the support panel (bot message to the team)
//   S_support       → the "Поддержка" chat (bot message with the team's answer)
//   <slug>          → chat with that SI-consultant (the consultant's own link)
// Prefixes are uppercase, so they never clash with slugs (always lowercase).
function handleStartParam() {
  const tg = window.Telegram?.WebApp;
  const param = tg?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get('startapp');
  if (!param || !/^[A-Za-z0-9_-]{1,64}$/.test(param)) return;
  if (param.startsWith('C_')) {
    SF.openIn('marketplace', 'consultant', { id: param.slice(2) });
  } else if (param.startsWith('P_')) {
    SF.openIn('marketplace', 'person', { id: param.slice(2) });
  } else if (param.startsWith('I_')) {
    SF.openIn('marketplace', 'office', { section: 'inbox' });
  } else if (param.startsWith('A_')) {
    SF.openIn('profile', 'admin-feedback', { id: param.slice(2) });
  } else if (param.startsWith('S_')) {
    SF.openIn('chats', 'chat', { slug: 'assistant' });
  } else {
    SF.openIn('chats', 'chat', { slug: param });
  }
}

// -------------------------------------------------------------
// Rendering
// -------------------------------------------------------------
let lastRouteKey = null;

function renderApp(state) {
  const container = document.getElementById('app-root');
  if (!container) return;

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
    title = screen.title ? screen.title(route, state) : '';
    content = screen.render(route, state);
  } catch (err) {
    console.error('[SmartFlow] screen failed:', err);
    content = renderScreenError(SF.reportAppError(err, `render ${tab}/${route.screen}`));
  }
  const canGoBack = stack.length > 1;

  container.innerHTML = `
    ${state.auth?.status === 'expired' ? renderSessionExpired() : ''}

    <main class="w-full flex-1 min-h-0 flex flex-col items-center">
      <div class="app-frame">
        <header class="tg-header flex items-center gap-2">
          ${canGoBack ? `
            <button onclick="SF.back()" class="p-1.5 -ml-1.5 rounded-xl text-muted hover:text-ink" aria-label="Назад">
              <i data-lucide="chevron-left" class="w-5 h-5"></i>
            </button>
          ` : `<img src="images/logo-mark.webp" alt="SmartFlow" width="28" height="28" class="w-7 h-7" />`}
          <div class="flex-1 min-w-0">
            <div class="text-sm font-bold text-ink truncate">${title}</div>
          </div>
          <button onclick="SF.go('profile')" class="flex-shrink-0" aria-label="Профиль">
            ${SF.avatar(state.me.photoUrl, { size: 30, kind: 'human' })}
          </button>
        </header>

        <div class="flex-1 overflow-y-auto px-4 py-4 space-y-3.5" id="screen-body">
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
  if (!(tab === 'chats' && route.screen === 'chat') && !(tab === 'marketplace' && route.screen === 'office-client')) {
    SF.data.stopPolling();
  }
  try {
    if (screen.afterRender) screen.afterRender(route, state);
  } catch (err) {
    console.error('[SmartFlow] afterRender failed:', err);
    SF.reportAppError(err, `afterRender ${tab}/${route.screen}`);
  }
  if (window.lucide) window.lucide.createIcons();
}

function renderBottomNav(state) {
  const badges = {
    chats: (state.remote.chats || []).filter(c => SF.data.isUnread(state, c)).length
  };
  return `
    <nav class="tg-nav-bar grid grid-cols-5 items-end">
      ${TABS.map(t => {
        const active = state.ui.tab === t.id;
        if (t.center) {
          return `
            <button onclick="SF.go('${t.id}')" class="flex flex-col items-center gap-0.5 -mt-6" aria-label="${t.label}">
              <span class="buddy-nav-btn ${active ? 'active' : ''}">
                <img src="${SF.MASCOTS.buddy}" alt="" class="w-11 h-11" />
              </span>
              <span class="text-[11px] font-semibold ${active ? 'text-brand' : 'text-muted'}">${t.label}</span>
            </button>`;
        }
        return `
          <button onclick="SF.go('${t.id}')" class="tg-nav-item relative ${active ? 'active' : ''} ${t.enabled ? '' : 'opacity-50'}">
            <i data-lucide="${t.icon}" class="w-5 h-5"></i>
            <span class="truncate max-w-full">${t.label}</span>
            ${!t.enabled ? `<span class="absolute -top-1.5 left-1/2 -translate-x-1/2">${SF.soonBadge()}</span>` : ''}
            ${badges[t.id] ? `<span class="absolute top-0.5 right-3 min-w-4 h-4 px-1 rounded-full bg-[#81D8D0] text-[#08302c] text-[9px] font-bold flex items-center justify-center">${badges[t.id]}</span>` : ''}
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
