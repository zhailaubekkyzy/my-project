// app.js - SmartFlow shell: bottom navigation, screen routing, Telegram login and back button.
//
// Structure (see docs/ARCHITECTURE.md):
//   Комьюнити (later) · Маркетплейс (+ Офис) · Бадди (center, home) · Чаты · Профиль
// Every tab keeps a stack of screens in store.data.ui.routes[tab]; screens are rendered by
// window.SF.screens[tab].render(route, state) from js/screens/*.js.

const SF = window.SF;

// Bottom navigation, left to right. Community is planned: switch `enabled` on when it is built.
const TABS = [
  { id: 'community', label: 'Комьюнити', icon: 'users-round', enabled: false },
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
      store.setAuthOffline('Автономный демо-режим');
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
const deferredScripts = {};
function loadScriptOnce(src) {
  if (!deferredScripts[src]) {
    deferredScripts[src] = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.async = true;
      el.onload = resolve;
      el.onerror = reject;
      document.head.appendChild(el);
    });
  }
  return deferredScripts[src];
}

const AI_ENGINE_SRC = 'js/ai-engine.js';
const CONFETTI_SRC = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js';

// Run fn with window.aiEngine available (the demo SI replies, until OpenAI is connected)
SF.withAiEngine = function (fn) {
  if (window.aiEngine) return fn(window.aiEngine);
  loadScriptOnce(AI_ENGINE_SRC).then(() => fn(window.aiEngine));
};

SF.confetti = function () {
  if (window.confetti) window.confetti({ particleCount: 70, spread: 60 });
};

function loadNonCriticalScripts() {
  const run = () => {
    loadScriptOnce(AI_ENGINE_SRC).catch(() => {});
    loadScriptOnce(CONFETTI_SRC).catch(() => {});
  };
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 1500 });
  } else {
    setTimeout(run, 300);
  }
}

// -------------------------------------------------------------
// Navigation helpers used by screens (onclick="SF.go('chats')")
// -------------------------------------------------------------
SF.go = (tab) => {
  const def = TABS.find(t => t.id === tab);
  if (!def) return;
  if (!def.enabled) {
    SF.showToast(`${def.label} появится в следующих версиях — я напомню`);
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

// Links shared outside the app: t.me/smartflow_ai_support_bot/app?startapp=c_<consultantId>
function handleStartParam() {
  const tg = window.Telegram?.WebApp;
  const param = tg?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get('startapp');
  if (!param) return;
  const store = window.funnelStore;
  if (param.startsWith('c_')) {
    const id = param.slice(2);
    if (store.data.marketplace.consultants.some(c => c.id === id)) {
      SF.openIn('marketplace', 'consultant', { id });
    }
  }
  // Other links (a consultant's own slug, a profile) open the Buddy screen for now.
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
  const routeKey = `${tab}:${stack.length}:${route.screen}:${route.id || ''}`;

  // Keep the scroll position when the same screen re-renders (e.g. after ticking a box)
  const body = document.getElementById('screen-body');
  const keepScroll = body && routeKey === lastRouteKey ? body.scrollTop : 0;

  const title = screen.title ? screen.title(route, state) : '';
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
          ${screen.render(route, state)}
        </div>

        ${renderBottomNav(state)}
      </div>
    </main>

    <div id="modal-container"></div>
  `;

  const newBody = document.getElementById('screen-body');
  if (newBody && keepScroll) newBody.scrollTop = keepScroll;
  lastRouteKey = routeKey;

  syncTelegramBackButton(canGoBack);
  if (screen.afterRender) screen.afterRender(route, state);
  if (window.lucide) window.lucide.createIcons();
}

function renderBottomNav(state) {
  const badges = {
    chats: state.chats.list.reduce((n, c) => n + (c.unread || 0), 0)
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
