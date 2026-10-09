// app.js - SmartFlow Main Controller & UI Renderer

let activeVoicePlaybackId = null;

async function initTelegramAuth() {
  const store = window.funnelStore;
  const api = window.smartFlowApi;
  if (!api || !store) return;

  api.onSessionExpired((err) => {
    store.setSessionExpired(err);
  });

  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData;

  if (initData) {
    try {
      const res = await api.loginWithTelegram(initData, store.data.activeRole);
      store.setAuth(res);
      showToast(`Telegram вход: ${res.user.displayName} ✅`);
    } catch (err) {
      if (err.data?.code === 'TELEGRAM_INITDATA_EXPIRED') {
        store.setSessionExpired(err.data);
      } else {
        store.setAuthOffline(`Подпись Telegram: ${err.message}`);
      }
    }
  } else {
    // Browser preview mode outside native Telegram client
    try {
      const devRes = await api.loginDev(store.data.activeRole);
      store.setAuth(devRes);
    } catch (err) {
      store.setAuthOffline('Автономный демо-режим');
    }
  }
}

window.reconnectTelegramAuth = () => {
  initTelegramAuth();
  showToast('Обновление сессии Telegram...');
};

// Load a script once, after first render. Returns a promise resolved when it has executed.
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

// Run fn with window.aiEngine available (it is normally preloaded right after first render).
function withAiEngine(fn) {
  if (window.aiEngine) return fn(window.aiEngine);
  loadScriptOnce(AI_ENGINE_SRC).then(() => fn(window.aiEngine));
}

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

document.addEventListener('DOMContentLoaded', () => {
  // Telegram.WebApp.ready()/expand() are called inline in index.html, right after the splash.

  // Subscribe to store updates
  window.funnelStore.subscribe((state) => {
    renderApp(state);
  });

  // Initial render
  renderApp(window.funnelStore.data);
  setupGlobalEventListeners();

  // Connect to Core Backend & Telegram Auth
  initTelegramAuth();

  loadNonCriticalScripts();
});

function renderApp(state) {
  const container = document.getElementById('app-root');
  if (!container) return;

  const role = state.activeRole;
  const isClientIsolated = role === 'client';

  let roleContentHtml = '';
  if (role === 'marketer') {
    roleContentHtml = renderMarketerView(state);
  } else if (role === 'expert') {
    roleContentHtml = renderExpertView(state);
  } else {
    roleContentHtml = renderClientView(state);
  }

  container.innerHTML = `
    <!-- Top Bar: Pitch Demo & Navigation Controller -->
    <header class="w-full max-w-6xl mx-auto px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-sm">
      <div class="flex items-center justify-between gap-3 w-full sm:w-auto">
        <div class="flex items-center gap-3">
          <img src="images/logo-mark.webp" alt="SmartFlow" width="40" height="40" class="w-10 h-10" />
          <div>
            <div class="font-bold text-base flex items-center gap-2">
              <span class="text-ink tracking-tight">SmartFlow</span>
              <span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#81D8D0]/10 text-brand border border-[#81D8D0]/20">Mini App</span>
            </div>
            <div class="font-handwritten text-brand text-[15px] leading-4 font-bold">
              ${state.appSlogan}
            </div>
          </div>
        </div>

        <!-- Reset demo data -->
        <button onclick="window.resetDemoData()" title="Сбросить демо-данные" class="p-2 rounded-xl btn-3d-dark text-muted hover:text-rose-400 transition">
          <i data-lucide="rotate-ccw" class="w-4 h-4"></i>
        </button>
      </div>

      <!-- Role Selector (Marketer, Expert, Client) -->
      <div class="flex items-center bg-raised p-1 rounded-2xl border border-line">
        <button onclick="window.switchRole('marketer')" class="px-3.5 py-1.5 rounded-xl font-semibold text-xs transition flex items-center gap-1.5 ${role === 'marketer' ? 'btn-3d-tiffany' : 'text-muted hover:text-ink-2'}">
          <i data-lucide="briefcase" class="w-3.5 h-3.5"></i>
          <span>Маркетолог</span>
        </button>

        <button onclick="window.switchRole('expert')" class="px-3.5 py-1.5 rounded-xl font-semibold text-xs transition flex items-center gap-1.5 ${role === 'expert' ? 'btn-3d-tiffany' : 'text-muted hover:text-ink-2'}">
          <i data-lucide="graduation-cap" class="w-3.5 h-3.5"></i>
          <span>Эксперт</span>
          ${state.expert.directHumanInquiries.filter(i => i.status === 'waiting').length ? `
            <span class="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
          ` : ''}
        </button>

        <button onclick="window.switchRole('client')" class="px-3.5 py-1.5 rounded-xl font-semibold text-xs transition flex items-center gap-1.5 ${role === 'client' ? 'btn-3d-tiffany' : 'text-muted hover:text-ink-2'}">
          <i data-lucide="message-square" class="w-3.5 h-3.5"></i>
          <span>Клиент (Лид)</span>
        </button>
      </div>

      <!-- Auth / Telegram Status Badge -->
      <div class="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-card border border-line text-xs">
        <span class="w-2 h-2 rounded-full ${state.auth?.status === 'authenticated' ? 'bg-emerald-400 animate-pulse' : (state.auth?.status === 'expired' ? 'bg-rose-500' : 'bg-[#81D8D0]')}"></span>
        <div class="flex flex-col text-left leading-tight">
          <span class="text-[11px] font-bold text-ink-2">${state.auth?.status === 'authenticated' ? (state.auth.telegramUser?.username ? '@' + state.auth.telegramUser.username : 'Telegram Mini App') : (state.auth?.status === 'expired' ? 'Сессия истекла' : 'SmartFlow Core')}</span>
          <span class="text-[9px] text-muted font-mono">${state.auth?.internalUserId ? 'ID: ' + state.auth.internalUserId.slice(0, 10) : 'Авторизация OK'}</span>
        </div>
      </div>

    </header>

    ${state.auth?.status === 'expired' ? `
      <!-- Session Expiry Overlay Modal -->
      <div class="fixed inset-0 z-50 bg-ink/40 backdrop-blur-md flex items-center justify-center p-4">
        <div class="w-full max-w-md bg-card border border-line rounded-3xl p-6 shadow-2xl text-center space-y-4">
          <img src="images/mascots/si-assistant.webp" alt="" class="w-20 h-20 mx-auto" />
          <div>
            <h3 class="text-lg font-bold text-ink">Сессия Telegram завершена</h3>
            <p class="text-xs text-muted mt-1">Срок действия авторизации Telegram (24 часа) истек. Все ваши воронки, клиенты и переписки сохранены в безопасности на сервере SmartFlow.</p>
          </div>
          <button onclick="window.reconnectTelegramAuth()" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm font-bold flex items-center justify-center gap-2">
            <i data-lucide="refresh-cw" class="w-4 h-4"></i>
            <span>Обновить вход через Telegram</span>
          </button>
        </div>
      </div>
    ` : ''}

    <!-- Main Container -->
    <main class="w-full flex-1 min-h-0 flex flex-col items-center">
      <div class="app-frame">

        <!-- Section header -->
        <div class="tg-header flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            ${role === 'client' ? `
              <img src="images/mascots/si-consultant.webp" alt="" class="w-8 h-8 rounded-full bg-[var(--si-bubble)] border border-[var(--si-bubble-line)] object-contain" />
            ` : `
              <div class="w-8 h-8 rounded-full bg-raised border border-[#81D8D0]/40 flex items-center justify-center text-sm font-semibold text-brand">
                ${role === 'marketer' ? '👔' : '🎓'}
              </div>
            `}
            <div>
              <div class="text-xs font-bold text-ink flex items-center gap-1.5">
                <span>
                  ${role === 'marketer' ? 'SmartFlow • Маркетолог' : 
                    (role === 'expert' ? 'SmartFlow • Кабинет Эксперта' : 'SI-консультант Елены Смирновой')}
                </span>
                <span class="w-2 h-2 rounded-full ${role === 'client' ? 'bg-[var(--sf-si-red)]' : 'bg-[#81D8D0]'} animate-pulse"></span>
              </div>
              <div class="text-[10px] text-muted">
                ${role === 'marketer' ? 'Воронки & Аналитика • Автосписание с карт' : 
                  (role === 'expert' ? 'Воронка: High-Ticket • PMF 96%' : 'онлайн • слушает аудио и текст 🎙️')}
              </div>
            </div>
          </div>

          <div class="flex items-center gap-1.5">
            ${isClientIsolated ? `
              <span class="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[var(--si-bubble)] text-si border border-[var(--si-bubble-line)] inline-flex items-center gap-1">
                <span class="si-dot"></span> SI на связи
              </span>
            ` : `
              <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-raised border border-[#81D8D0]/30 text-brand">
                ${role.toUpperCase()}
              </span>
            `}
          </div>
        </div>

        <!-- Scrollable Screen Content -->
        <div class="flex-1 overflow-y-auto px-4 py-4 space-y-3.5" id="tma-scrollable-body">
          ${roleContentHtml}
        </div>

        <!-- Telegram Bottom Navigation (HIDDEN FOR CLIENT / LEAD - Strict isolation!) -->
        ${!isClientIsolated ? renderBottomNav(state) : `
          <!-- Isolated Client Footer (Only Telegram input & actions) -->
          <div class="p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] bg-card border-t border-line text-center text-[10px] text-faint flex items-center justify-center gap-1.5">
            <span class="si-dot"></span>
            <span><span class="font-bold text-ink-2">SmartFlow SI</span> — Super Intelligence</span>
          </div>
        `}
      </div>
    </main>

    <!-- Global Modals container -->
    <div id="modal-container"></div>
  `;

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// -------------------------------------------------------------
// 1. MARKETER VIEW
// -------------------------------------------------------------
function renderMarketerView(state) {
  const marketer = state.marketer;
  const currentFunnel = state.funnels.find(f => f.id === state.currentFunnelId) || state.funnels[0];
  const activeSubTab = state.marketerSubTab || 'funnels';

  return `
    <!-- Target Scenario Brand Hero (From user photo) -->
    <div class="hero-tiffany-banner p-4">
      <div class="flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-wider text-black mb-1">
        <span class="red-bullet"></span>
        <span>05 — YOUR SI SALES AGENT</span>
      </div>
      <h1 class="text-base font-black leading-tight text-black uppercase tracking-tight mb-2">
        ТЫ ЗАНИМАЕШЬСЯ ЭКСПЕРТИЗОЙ.<br/>
        SI-КОНСУЛЬТАНТ — РАЗГОВОРАМИ С ЛИДАМИ.
      </h1>
      <p class="text-xs text-black/80 font-medium leading-snug">
        SI — Super Intelligence. Это целевой сценарий SmartFlow, который мы масштабируем вместе с первыми топовыми экспертами и маркетологами.
      </p>
    </div>

    <!-- Marketer Overview Card -->
    <div class="glass-card-3d p-4">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-3">
          <img src="${marketer.avatar}" class="w-12 h-12 rounded-2xl object-cover border-2 border-[#81D8D0]/50 shadow-md" />
          <div>
            <div class="font-bold text-sm text-ink">${marketer.name}</div>
            <div class="text-xs text-brand font-medium">${marketer.title}</div>
            <div class="text-[11px] text-muted">${marketer.bio}</div>
          </div>
        </div>
      </div>

      <!-- Financial Metrics -->
      <div class="grid grid-cols-3 gap-2 pt-2 border-t border-line text-center">
        <div class="p-2 rounded-xl bg-sunken border border-line">
          <div class="text-[10px] text-muted">MRR с подписок</div>
          <div class="text-xs font-extrabold text-brand">${formatMoney(marketer.mrr)}</div>
        </div>
        <div class="p-2 rounded-xl bg-sunken border border-line">
          <div class="text-[10px] text-muted">Экспертов на связи</div>
          <div class="text-xs font-bold text-ink">${marketer.activeSubscribersCount} чел.</div>
        </div>
        <div class="p-2 rounded-xl bg-sunken border border-line">
          <div class="text-[10px] text-muted">Автосписание</div>
          <div class="text-xs font-bold text-rose-400">${marketer.bankCard}</div>
        </div>
      </div>
    </div>

    <!-- Marketer Sub Navigation -->
    <div class="flex items-center gap-1.5 bg-raised p-1 rounded-xl border border-line text-xs">
      <button onclick="window.setMarketerSubTab('funnels')" class="flex-1 py-1.5 rounded-lg font-semibold transition text-center ${activeSubTab === 'funnels' ? 'bg-[#81D8D0] text-[#090e17] shadow' : 'text-muted hover:text-ink'}">
        Воронки (${state.funnels.length})
      </button>
      <button onclick="window.setMarketerSubTab('subscribers')" class="flex-1 py-1.5 rounded-lg font-semibold transition text-center ${activeSubTab === 'subscribers' ? 'bg-[#81D8D0] text-[#090e17] shadow' : 'text-muted hover:text-ink'}">
        Подписки & Ретеншн
      </button>
      <button onclick="window.setMarketerSubTab('ai_clone')" class="flex-1 py-1.5 rounded-lg font-semibold transition text-center ${activeSubTab === 'ai_clone' ? 'bg-[#81D8D0] text-[#090e17] shadow' : 'text-muted hover:text-ink'}">
        SI-клон
      </button>
    </div>

    ${activeSubTab === 'funnels' ? renderMarketerFunnelsTab(state, currentFunnel) : ''}
    ${activeSubTab === 'subscribers' ? renderMarketerSubscribersTab(state, currentFunnel) : ''}
    ${activeSubTab === 'ai_clone' ? renderMarketerAiCloneTab(state, currentFunnel) : ''}
  `;
}

function renderMarketerFunnelsTab(state, funnel) {
  return `
    <!-- Funnel selector & New funnel button -->
    <div class="flex items-center justify-between gap-2">
      <div class="flex-1 overflow-x-auto flex gap-2 pb-1">
        ${state.funnels.map(f => `
          <button onclick="window.selectFunnel('${f.id}')" class="px-3 py-1.5 rounded-xl text-xs whitespace-nowrap transition border ${f.id === funnel.id ? 'bg-[#81D8D0]/20 border-[#81D8D0] text-brand font-bold shadow-md' : 'bg-raised border-line-2 text-muted hover:text-ink-2'}">
            ${f.title.split(':')[0]}
          </button>
        `).join('')}
      </div>
      <button onclick="window.openCreateFunnelModal()" class="px-3 py-1.5 rounded-xl btn-3d-tiffany text-xs flex items-center gap-1">
        <i data-lucide="plus" class="w-3.5 h-3.5"></i>
        <span>Создать</span>
      </button>
    </div>

    <!-- Active Funnel Header & Subscription Pricing -->
    <div class="glass-card-3d p-4">
      <div class="flex items-start justify-between gap-2 mb-2">
        <div>
          <span class="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 mb-1">
            ${funnel.badge}
          </span>
          <h2 class="text-sm font-extrabold text-ink leading-snug">${funnel.title}</h2>
          <div class="text-xs text-brand font-medium mt-0.5">${funnel.niche}</div>
        </div>
        <div class="text-right">
          <div class="text-[10px] text-muted">Тариф подписки</div>
          <div class="text-sm font-extrabold text-brand">${formatMoney(funnel.monthlyPrice)} <span class="text-[10px] font-normal text-muted">/мес</span></div>
          <div class="text-[9px] text-muted">Автосписание с карты</div>
        </div>
      </div>
      <p class="text-xs text-ink-2 leading-relaxed">${funnel.description}</p>
    </div>

    <!-- Aggregated Funnel Analytics (WITHOUT Clients Personal Info) -->
    <div class="glass-card-3d p-4">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <i data-lucide="bar-chart-3" class="w-4 h-4 text-brand"></i>
          <span class="text-xs font-bold text-ink uppercase tracking-wider">Результаты воронки</span>
        </div>
        <span class="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          Без персональных данных клиентов
        </span>
      </div>

      <div class="grid grid-cols-2 gap-2 mb-3">
        <div class="p-2.5 rounded-xl bg-sunken border border-line">
          <div class="text-[10px] text-muted">Выручка экспертов</div>
          <div class="text-sm font-extrabold text-brand">${funnel.analytics.totalExpertsRevenue}</div>
          <div class="text-[9px] text-faint mt-0.5">Суммарно по 16 экспертам</div>
        </div>
        <div class="p-2.5 rounded-xl bg-sunken border border-line">
          <div class="text-[10px] text-muted">Конверсия воронки (CR)</div>
          <div class="text-sm font-extrabold text-rose-400">${funnel.analytics.avgFunnelConversion}</div>
          <div class="text-[9px] text-faint mt-0.5">Средний чек: ${funnel.analytics.avgDealCheck}</div>
        </div>
      </div>

      <!-- Funnel Stage Drop-offs list -->
      <div class="space-y-1.5">
        <div class="text-[11px] font-semibold text-ink-2">Пошаговая доходимость (Агрегировано):</div>
        ${funnel.analytics.stepDropOffs.map(s => `
          <div class="flex items-center justify-between text-xs p-2 rounded-xl bg-sunken border border-line">
            <span class="text-ink-2 font-medium">${s.step}</span>
            <div class="flex items-center gap-2">
              <span class="text-muted text-[11px]">${s.passed} лидов</span>
              <span class="font-bold text-brand">${s.cr}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Funnel Structure (Critical requirement) -->
    <div class="glass-card-3d p-4">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <i data-lucide="git-merge" class="w-4 h-4 text-brand"></i>
          <span class="text-xs font-bold text-ink uppercase tracking-wider">Структура воронки маркетолога</span>
        </div>
        <span class="text-[10px] text-rose-400 font-bold">${funnel.steps.length} этапов</span>
      </div>

      <div class="space-y-2.5">
        ${funnel.steps.map(step => `
          <div class="p-3 rounded-xl bg-sunken border border-line hover:border-[#81D8D0]/40 transition">
            <div class="flex items-center justify-between mb-1">
              <div class="flex items-center gap-2">
                <span class="w-5 h-5 rounded-full bg-[#81D8D0]/20 text-brand text-xs font-bold flex items-center justify-center">
                  ${step.number}
                </span>
                <span class="font-bold text-xs text-ink">${step.name}</span>
              </div>
              <span class="text-[10px] text-emerald-400 font-semibold">CR: ${step.conversionRate}</span>
            </div>
            <div class="text-xs text-ink-2 mb-1.5"><strong class="text-muted">Цель:</strong> ${step.goal}</div>
            <div class="text-[11px] text-brand/90 bg-raised p-2 rounded-lg border border-line">
              <strong class="text-brand">Логика SI-консультанта:</strong> ${step.aiPrompt}
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- AI Analyzer Recommendations for Marketer -->
    <div class="glass-card-3d p-4 border-[var(--si-bubble-line)]">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <span class="si-dot"></span>
          <span class="text-xs font-bold text-ink uppercase tracking-wider">Рекомендации SI-аналитика</span>
        </div>
        <span class="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
          Узкие горлышки
        </span>
      </div>

      <div class="space-y-2.5">
        ${funnel.analyzerRecommendations.map(rec => `
          <div class="p-3 rounded-xl bg-sunken border border-line">
            <div class="flex items-center gap-1.5 mb-1">
              <span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${rec.urgency === 'high' ? 'bg-rose-500/20 text-rose-400' : 'bg-amber-500/20 text-amber-300'}">
                ${rec.urgency === 'high' ? 'Критично' : 'Точка роста'}
              </span>
              <span class="text-xs font-bold text-ink">${rec.title}</span>
            </div>
            <p class="text-xs text-muted mb-1.5">${rec.observation}</p>
            <div class="text-xs text-brand bg-sunken p-2 rounded-lg border border-[#81D8D0]/30">
              💡 <strong>Совет анализатора:</strong> ${rec.solution}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderMarketerSubscribersTab(state, funnel) {
  return `
    <div class="glass-card-3d p-4">
      <div class="flex items-center justify-between mb-3">
        <div>
          <h2 class="text-xs font-bold text-ink uppercase tracking-wider">Эксперты по подписке</h2>
          <div class="text-[11px] text-muted">Списание: ${formatMoney(funnel.monthlyPrice)} / эксперт в месяц</div>
        </div>
        <span class="px-2 py-1 rounded-xl bg-[#81D8D0]/20 text-brand text-xs font-bold border border-[#81D8D0]/30">
          ${funnel.subscribers.length} активных
        </span>
      </div>

      <div class="space-y-2.5">
        ${funnel.subscribers.map(sub => `
          <div class="p-3 rounded-xl bg-sunken border border-line">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2.5">
                <img src="${sub.avatar}" class="w-9 h-9 rounded-xl object-cover border border-line-2" />
                <div>
                  <div class="text-xs font-bold text-ink flex items-center gap-1.5">
                    ${sub.name}
                    <span class="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400">Подписка активна</span>
                  </div>
                  <div class="text-[10px] text-muted">${sub.niche} • С ${sub.joinDate}</div>
                </div>
              </div>
              <div class="text-right">
                <div class="text-[9px] text-muted">Карта эксперта</div>
                <div class="text-xs font-mono font-bold text-ink-2">•••• ${sub.cardLast4}</div>
              </div>
            </div>

            <!-- Aggregated results without expert client personal data -->
            <div class="grid grid-cols-3 gap-1.5 pt-2 border-t border-line text-center">
              <div class="p-1.5 rounded-lg bg-raised">
                <div class="text-[9px] text-muted">Лидов обработано</div>
                <div class="text-xs font-bold text-ink">${sub.leadsProcessed}</div>
              </div>
              <div class="p-1.5 rounded-lg bg-raised">
                <div class="text-[9px] text-muted">Сделок закрыто</div>
                <div class="text-xs font-bold text-brand">${sub.closedDeals} (${sub.crOverall})</div>
              </div>
              <div class="p-1.5 rounded-lg bg-raised">
                <div class="text-[9px] text-muted">Выручка эксперта</div>
                <div class="text-xs font-bold text-emerald-400">${sub.revenueGenerated}</div>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Cohort Retention Matrix -->
    <div class="glass-card-3d p-4">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-xs font-bold text-ink uppercase tracking-wider">Когортный Ретеншн (Retention)</h2>
        <span class="text-[10px] text-brand font-semibold">Churn: ${funnel.cohortRetention.churnRate} • LTV: ${funnel.cohortRetention.avgLtv}</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-[11px] border-collapse">
          <thead>
            <tr class="border-b border-line text-muted">
              <th class="py-1.5 px-2">Когорта</th>
              <th class="py-1.5 px-1">Эксперты</th>
              <th class="py-1.5 px-1 text-center">M1</th>
              <th class="py-1.5 px-1 text-center">M2</th>
              <th class="py-1.5 px-1 text-center">M3</th>
              <th class="py-1.5 px-1 text-center">M4</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line">
            ${funnel.cohortRetention.cohorts.map(c => `
              <tr>
                <td class="py-1.5 px-2 font-medium text-ink-2">${c.month}</td>
                <td class="py-1.5 px-1 text-muted">${c.users}</td>
                <td class="py-1.5 px-1 text-center text-brand font-bold bg-[#81D8D0]/10 rounded">${c.m1}</td>
                <td class="py-1.5 px-1 text-center ${c.m2 !== '-' ? 'text-brand font-bold bg-[#81D8D0]/10' : 'text-faint'} rounded">${c.m2}</td>
                <td class="py-1.5 px-1 text-center ${c.m3 !== '-' ? 'text-brand font-bold bg-[#81D8D0]/10' : 'text-faint'} rounded">${c.m3}</td>
                <td class="py-1.5 px-1 text-center ${c.m4 !== '-' ? 'text-brand font-bold bg-[#81D8D0]/10' : 'text-faint'} rounded">${c.m4}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderMarketerAiCloneTab(state, funnel) {
  return `
    <div class="glass-card-3d p-4 space-y-3">
      <div class="flex items-center gap-2 mb-1">
        <i data-lucide="bot" class="w-5 h-5 text-brand"></i>
        <h2 class="text-xs font-bold text-ink uppercase tracking-wider">Клонирование маркетолога (SmartFlow SI-клон)</h2>
      </div>
      <p class="text-xs text-ink-2">
        Маркетолог загружает правила кастдева, методички отработки возражений и триггеры оффера для SI-консультантов всех своих экспертов.
      </p>

      <div class="p-3 rounded-xl bg-sunken border border-line space-y-2">
        <label class="text-[11px] font-bold text-ink-2 block">Психотип клона маркетолога:</label>
        <input type="text" value="${funnel.aiClone.personality}" class="w-full text-xs p-2 rounded-lg bg-raised border border-line-2 text-ink" />
      </div>

      <div class="p-3 rounded-xl bg-sunken border border-line space-y-2">
        <label class="text-[11px] font-bold text-ink-2 block">Материалы базы знаний воронки:</label>
        <div class="space-y-1.5">
          ${funnel.aiClone.knowledgeBase.map((kb, idx) => `
            <div class="flex items-center gap-2 text-xs p-2 rounded-lg bg-raised border border-line text-ink-2">
              <span class="w-4 h-4 rounded-full bg-[#81D8D0]/20 text-brand text-[10px] flex items-center justify-center font-bold">${idx + 1}</span>
              <span class="flex-1">${kb}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

// -------------------------------------------------------------
// 2. EXPERT VIEW (With Direct Inquiries Section + 3 Windows + PMF)
// -------------------------------------------------------------
function renderExpertView(state) {
  const expert = state.expert;
  const activeTab = state.expertTab || 'chats';
  const waitingDirectInquiries = expert.directHumanInquiries.filter(i => i.status === 'waiting').length;

  return `
    <!-- Expert Header Profile -->
    <div class="glass-card-3d p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-3">
          <img src="${expert.avatar}" class="w-12 h-12 rounded-2xl object-cover border-2 border-[#81D8D0]/50 shadow-md" />
          <div>
            <div class="font-bold text-sm text-ink">${expert.name}</div>
            <div class="text-xs text-brand font-medium">${expert.title}</div>
            <div class="text-[10px] text-muted">${expert.niche}</div>
          </div>
        </div>
        <div class="text-right">
          <span class="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Подписка активна
          </span>
          <div class="text-[9px] text-muted mt-1">${formatMoney(expert.subscriptionPrice)}/мес (карта •••• ${expert.cardLast4})</div>
        </div>
      </div>

      <!-- Quick AI Seller Link Bar -->
      <div class="mt-3 p-2.5 rounded-xl bg-sunken border border-[#81D8D0]/30 flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 overflow-hidden">
          <i data-lucide="link-2" class="w-4 h-4 text-brand flex-shrink-0"></i>
          <span class="text-xs font-mono text-brand truncate">${expert.sellerLink}</span>
        </div>
        <div class="flex items-center gap-1">
          <button onclick="window.copySellerLink('${expert.sellerLink}')" class="px-2 py-1 rounded-lg btn-3d-tiffany text-[11px] flex items-center gap-1">
            <i data-lucide="copy" class="w-3 h-3"></i>
            <span>Копировать</span>
          </button>
          <button onclick="window.openQrModal('${expert.sellerLink}')" class="p-1 rounded-lg btn-3d-dark" title="QR-код">
            <i data-lucide="qr-code" class="w-4 h-4 text-brand"></i>
          </button>
        </div>
      </div>
    </div>

    <!-- Navigation Tabs for Expert Cabinet — 3×2 grid -->
    <div class="grid grid-cols-3 gap-1.5 bg-raised p-1.5 rounded-2xl border border-line text-xs">
      <button onclick="window.setExpertTab('chats')" class="py-2.5 px-2 rounded-xl font-medium transition text-center flex flex-col items-center gap-1 ${activeTab === 'chats' ? 'bg-[#81D8D0] text-[#090e17] font-bold shadow-lg' : 'text-muted hover:text-ink'}">
        <i data-lucide="messages-square" class="w-4 h-4"></i>
        <span class="text-[10px]">Переписки</span>
      </button>

      <button onclick="window.setExpertTab('direct_inquiries')" class="py-2.5 px-2 rounded-xl font-medium transition text-center flex flex-col items-center gap-1 relative ${activeTab === 'direct_inquiries' ? 'bg-[#81D8D0] text-[#090e17] font-bold shadow-lg' : 'text-muted hover:text-ink'}">
        <i data-lucide="user-check" class="w-4 h-4"></i>
        <span class="text-[10px]">Лично 👤</span>
        ${waitingDirectInquiries ? `
          <span class="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-600 text-white font-bold text-[9px] flex items-center justify-center animate-bounce">
            ${waitingDirectInquiries}
          </span>
        ` : ''}
      </button>

      <button onclick="window.setExpertTab('analytics')" class="py-2.5 px-2 rounded-xl font-medium transition text-center flex flex-col items-center gap-1 ${activeTab === 'analytics' ? 'bg-[#81D8D0] text-[#090e17] font-bold shadow-lg' : 'text-muted hover:text-ink'}">
        <i data-lucide="trending-up" class="w-4 h-4"></i>
        <span class="text-[10px]">Аналитика</span>
      </button>

      <button onclick="window.setExpertTab('recommendations')" class="py-2.5 px-2 rounded-xl font-medium transition text-center flex flex-col items-center gap-1 ${activeTab === 'recommendations' ? 'bg-[#81D8D0] text-[#090e17] font-bold shadow-lg' : 'text-muted hover:text-ink'}">
        <i data-lucide="lightbulb" class="w-4 h-4"></i>
        <span class="text-[10px]">Советы SI</span>
      </button>

      <button onclick="window.setExpertTab('pmf')" class="py-2.5 px-2 rounded-xl font-medium transition text-center flex flex-col items-center gap-1 ${activeTab === 'pmf' ? 'bg-[#81D8D0] text-[#090e17] font-bold shadow-lg' : 'text-muted hover:text-ink'}">
        <i data-lucide="database" class="w-4 h-4"></i>
        <span class="text-[10px]">База данных</span>
      </button>

      <button onclick="window.setExpertTab('broadcasts')" class="py-2.5 px-2 rounded-xl font-medium transition text-center flex flex-col items-center gap-1 ${activeTab === 'broadcasts' ? 'bg-violet-500 text-white font-bold shadow-lg' : 'text-violet-400 hover:text-violet-300'}">
        <i data-lucide="send-horizontal" class="w-4 h-4"></i>
        <span class="text-[10px]">Рассылки</span>
      </button>
    </div>

    <!-- Active Window Content -->
    ${activeTab === 'chats' ? renderExpertChatsWindow(state) : ''}
    ${activeTab === 'direct_inquiries' ? renderExpertDirectInquiriesWindow(state) : ''}
    ${activeTab === 'analytics' ? renderExpertAnalyticsWindow(state) : ''}
    ${activeTab === 'recommendations' ? renderExpertRecommendationsWindow(state) : ''}
    ${activeTab === 'pmf' ? renderExpertPmfWindow(state) : ''}
    ${activeTab === 'broadcasts' ? renderExpertBroadcastWindow(state) : ''}
  `;
}

// NEW SECTION: "Кто написал лично" (Direct Inquiries Queue)
function renderExpertDirectInquiriesWindow(state) {
  const inquiries = state.expert.directHumanInquiries;
  const allTags = state.expert.allTags || [];

  return `
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <div>
          <span class="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
            <i data-lucide="user-plus" class="w-4 h-4 text-brand"></i>
            Кто написал лично (Связаться с экспертом)
          </span>
          <div class="text-[10px] text-muted">Лиды, которые нажали кнопку «Связаться с человеком» в чате SmartFlow</div>
        </div>
        <span class="text-[10px] px-2 py-0.5 rounded-full bg-[#81D8D0]/20 text-brand font-bold border border-[#81D8D0]/40">
          ${inquiries.length} обращений
        </span>
      </div>

      <div class="space-y-3">
        ${inquiries.map(inq => `
          <div class="glass-card-3d p-3.5 ${inq.status === 'waiting' ? 'border-[#81D8D0]' : 'border-line'}">
            <!-- Header -->
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                <img src="${inq.leadAvatar}" class="w-9 h-9 rounded-full object-cover border border-line-2" />
                <div>
                  <div class="text-xs font-bold text-ink flex items-center gap-1.5">
                    ${inq.leadName}
                    <span class="text-[10px] font-mono text-brand">${inq.leadUsername}</span>
                  </div>
                  <div class="text-[10px] text-muted">${inq.sourceStep} • ${inq.timeAgo}</div>
                </div>
              </div>
              <div class="text-right">
                <span class="text-xs font-extrabold text-brand">${inq.dealValue}</span>
                <div class="text-[9px] font-bold ${inq.status === 'waiting' ? 'text-rose-400 animate-pulse' : 'text-emerald-400'}">
                  ${inq.status === 'waiting' ? inq.urgency : 'Отвечено ✅'}
                </div>
              </div>
            </div>

            <!-- Bot State Toggle -->
            <div class="flex items-center justify-between mb-2 p-2 rounded-xl border ${(inq.botState || 'paused') === 'standby' ? 'bg-[var(--si-bubble)] border-[var(--si-bubble-line)]' : 'bg-[var(--human-bubble)] border-[var(--human-bubble-line)]'}">
              <div class="flex items-center gap-1.5 text-[11px] font-semibold ${(inq.botState || 'paused') === 'standby' ? 'text-si' : 'text-brand'}">
                ${(inq.botState || 'paused') === 'standby' ? '<span class="si-dot"></span>' : '<span>👤</span>'}
                <span>${(inq.botState || 'paused') === 'standby' ? 'SI на Standby — ждёт сигнала' : 'SI на паузе — вы ведёте диалог'}</span>
              </div>
              <button onclick="window.toggleBotState('${inq.id}')" class="px-2 py-1 rounded-lg text-[10px] font-bold btn-3d-dark">
                ${(inq.botState || 'paused') === 'standby' ? 'Приостановить SI' : 'Включить SI'}
              </button>
            </div>

            <!-- Tags -->
            <div class="mb-2">
              <div class="flex items-center flex-wrap gap-1">
                ${(inq.tags || []).map(tag => `
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/20 border border-violet-500/30 text-[10px] text-violet-300 font-semibold">
                    ${tag}
                    <button onclick="window.removeLeadTag('${inq.id}', '${tag}')" class="text-violet-400 hover:text-ink leading-none">&times;</button>
                  </span>
                `).join('')}
                <select onchange="window.addLeadTag('${inq.id}', this.value); this.value=''" class="text-[10px] px-2 py-0.5 rounded-full bg-sunken border border-dashed border-line-2 text-muted cursor-pointer">
                  <option value="">＋ Тег</option>
                  ${allTags.map(t => `<option value="${t}">${t}</option>`).join('')}
                </select>
              </div>
            </div>

            <!-- Summary / Query -->
            <p class="text-xs text-ink-2 mb-2 leading-relaxed">${inq.summary}</p>

            <!-- Audio Voice Message with Whisper AI Transcript if present -->
            ${inq.hasAudio ? `
              <div class="audio-voice-box mb-2">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <button onclick="window.toggleVoicePlay('${inq.id}')" class="w-7 h-7 rounded-full bg-[#81D8D0] text-[#090e17] flex items-center justify-center font-bold text-xs shadow">
                      <i data-lucide="play" class="w-3.5 h-3.5"></i>
                    </button>
                    <span class="text-[11px] font-semibold text-ink">Голосовое от клиента</span>
                  </div>
                  <span class="text-[10px] text-brand font-mono">${inq.audioDuration}</span>
                </div>
                
                <!-- Audio Waveform visualizer -->
                <div class="audio-waveform px-1" id="waveform-${inq.id}">
                  <span class="waveform-bar h-2"></span>
                  <span class="waveform-bar h-4"></span>
                  <span class="waveform-bar h-5"></span>
                  <span class="waveform-bar h-3"></span>
                  <span class="waveform-bar h-6"></span>
                  <span class="waveform-bar h-4"></span>
                  <span class="waveform-bar h-2"></span>
                  <span class="waveform-bar h-5"></span>
                  <span class="waveform-bar h-3"></span>
                </div>

                <!-- Whisper AI Transcription -->
                <div class="text-[11px] text-brand bg-sunken p-2 rounded-xl border border-[#81D8D0]/20 flex items-start gap-1.5">
                  <i data-lucide="sparkles" class="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5"></i>
                  <div>
                    <div class="text-[9px] uppercase font-bold text-muted">SI-расшифровка:</div>
                    <div class="italic text-ink-2">${inq.audioTranscription}</div>
                  </div>
                </div>
              </div>
            ` : `
              <div class="text-[11px] text-ink-2 bg-sunken p-2 rounded-xl border border-line mb-2">
                💬 <strong>Сообщение:</strong> ${inq.lastDirectMessage}
              </div>
            `}

            <!-- Action buttons -->
            <div class="flex items-center gap-2 pt-1 border-t border-line">
              <button onclick="window.replyDirectInquiry('${inq.id}', '${inq.leadName}')" class="flex-1 py-2 rounded-xl btn-3d-tiffany text-xs flex items-center justify-center gap-1.5 shadow">
                <i data-lucide="send" class="w-3.5 h-3.5"></i>
                <span>Ответить лично</span>
              </button>
              <button onclick="window.openLeadTelegram('${inq.leadUsername}')" class="px-3 py-2 rounded-xl btn-3d-dark text-xs flex items-center gap-1">
                <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
                <span>В Telegram</span>
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// Window 1: All Client Dialogues / Live CRM
function renderExpertChatsWindow(state) {
  const expert = state.expert;
  const selectedChat = expert.chats.find(c => c.id === state.selectedExpertChatId) || expert.chats[0];

  return `
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
          <i data-lucide="message-circle" class="w-4 h-4 text-brand"></i>
          Диалоги SI-консультанта с лидами
        </span>
        <span class="text-[11px] text-muted">${expert.chats.length} активных</span>
      </div>

      <!-- Chats Carousel -->
      <div class="flex gap-2 overflow-x-auto pb-1">
        ${expert.chats.map(chat => `
          <div onclick="window.selectExpertChat('${chat.id}')" class="flex-shrink-0 w-44 p-2.5 rounded-xl border cursor-pointer transition ${chat.id === selectedChat.id ? 'bg-card border-[#81D8D0] shadow-md' : 'bg-sunken border-line hover:border-line-2'}">
            <div class="flex items-center justify-between mb-1">
              <div class="flex items-center gap-1.5">
                <img src="${chat.leadAvatar}" class="w-6 h-6 rounded-full object-cover" />
                <span class="text-xs font-bold text-ink truncate max-w-[85px]">${chat.leadName}</span>
              </div>
              <span class="text-[9px] text-muted">${chat.lastMessageTime}</span>
            </div>
            <div class="text-[10px] font-semibold mb-1 ${chat.status === 'hot' ? 'text-rose-400' : (chat.status === 'closed' ? 'text-emerald-400' : 'text-amber-400')}">
              ${chat.statusLabel}
            </div>
            <div class="text-[10px] text-muted truncate">${chat.dealValue} • ${chat.summary}</div>
          </div>
        `).join('')}
      </div>

      <!-- Selected Chat View & Human Takeover -->
      <div class="glass-card-3d p-3 rounded-2xl flex flex-col space-y-2">
        <div class="flex items-center justify-between pb-2 border-b border-line">
          <div class="flex items-center gap-2">
            <img src="${selectedChat.leadAvatar}" class="w-8 h-8 rounded-full object-cover" />
            <div>
              <div class="text-xs font-bold text-ink flex items-center gap-1.5">
                ${selectedChat.leadName}
                <span class="text-[10px] text-brand font-mono">${selectedChat.leadUsername}</span>
              </div>
              <div class="text-[10px] text-muted">${selectedChat.summary}</div>
            </div>
          </div>
          <div class="text-right">
            <span class="text-xs font-extrabold text-brand">${selectedChat.dealValue}</span>
            <div class="text-[9px] text-muted">${selectedChat.statusLabel}</div>
          </div>
        </div>

        <!-- Chat history -->
        <div class="space-y-2 max-h-72 overflow-y-auto py-2 pr-1" id="expert-chat-scroll">
          ${selectedChat.messages.map(msg => `
            <div class="flex flex-col ${msg.sender === 'lead' ? 'items-start' : 'items-end'}">
              <div class="text-[9px] text-faint mb-0.5 px-1">
                ${msg.sender === 'lead' ? selectedChat.leadName : (msg.sender === 'expert_human' ? '👤 Елена (лично)' : '<span class="inline-flex items-center gap-1 text-si font-semibold"><span class="si-dot"></span>SI-консультант</span>')} • ${msg.time}
              </div>

              ${msg.isVoice ? `
                <div class="chat-bubble-human space-y-1">
                  <div class="flex items-center gap-2 text-xs font-semibold text-brand">
                    <i data-lucide="mic" class="w-3.5 h-3.5"></i>
                    <span>Голосовое (${msg.duration})</span>
                  </div>
                  <div class="text-[11px] text-ink-2 italic">${msg.text}</div>
                </div>
              ` : `
                <div class="${msg.sender === 'lead' ? 'chat-bubble-human' : (msg.sender === 'expert_human' ? 'chat-bubble-expert' : 'chat-bubble-si')} text-xs">
                  ${msg.text}
                </div>
              `}
            </div>
          `).join('')}
        </div>

        <!-- Human Takeover Box -->
        <div class="pt-2 border-t border-line">
          <div class="text-[11px] font-semibold text-brand flex items-center gap-1 mb-1.5">
            <i data-lucide="user-check" class="w-3.5 h-3.5"></i>
            <span>Вмешаться человеку (Отправить от имени Елены):</span>
          </div>
          <form onsubmit="window.handleExpertTakeover(event, '${selectedChat.id}')" class="flex gap-2">
            <input type="text" id="expert-takeover-input" placeholder="Напишите личное сообщение клиенту..." class="flex-1 bg-sunken border border-line-2 rounded-xl px-3 py-2 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]" />
            <button type="submit" class="px-3 py-2 rounded-xl btn-3d-tiffany text-xs font-semibold flex items-center gap-1">
              <i data-lucide="send" class="w-3.5 h-3.5"></i>
              <span>Ответить</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  `;
}

// Window 2: Analytics & Conversion
function renderExpertAnalyticsWindow(state) {
  const an = state.expert.analytics;

  return `
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
          <i data-lucide="pie-chart" class="w-4 h-4 text-brand"></i>
          Главная аналитика & Конверсии
        </span>
        <span class="text-[10px] text-muted">${an.period}</span>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div class="glass-card-3d p-3 border-[#81D8D0]/40">
          <div class="text-[10px] text-muted">Выручка через SI-консультанта</div>
          <div class="text-base font-extrabold text-brand">${an.revenue}</div>
          <div class="text-[9px] text-muted mt-0.5">Средний чек: ${an.avgCheck}</div>
        </div>

        <div class="glass-card-3d p-3 border-rose-500/40">
          <div class="text-[10px] text-muted">Конверсия в оплату / созвон</div>
          <div class="text-base font-extrabold text-rose-400">${an.overallConversion}</div>
          <div class="text-[9px] text-muted mt-0.5">Сделок: ${an.dealsClosed} шт.</div>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-2 text-center">
        <div class="p-2 rounded-xl bg-sunken border border-line">
          <div class="text-[10px] text-muted">Трафик / Гости</div>
          <div class="text-xs font-bold text-ink">${an.trafficVisitors} чел.</div>
        </div>
        <div class="p-2 rounded-xl bg-sunken border border-line">
          <div class="text-[10px] text-muted">Квалифицированы</div>
          <div class="text-xs font-bold text-brand">${an.qualifiedLeads} чел.</div>
        </div>
        <div class="p-2 rounded-xl bg-sunken border border-line">
          <div class="text-[10px] text-muted">Сэкономлено часов</div>
          <div class="text-xs font-bold text-amber-400">${an.aiSellerSavedHours} ч.</div>
        </div>
      </div>

      <!-- Funnel Progress Stages -->
      <div class="glass-card-3d p-3 space-y-2">
        <div class="text-[11px] font-bold text-ink-2">Доходимость по шагам воронки:</div>
        <div class="space-y-1.5">
          ${an.steps.map((st, i) => `
            <div>
              <div class="flex justify-between text-xs mb-1">
                <span class="text-ink-2 font-medium">${i + 1}. ${st.title}</span>
                <span class="text-brand font-bold">${st.count} (${st.percent})</span>
              </div>
              <div class="w-full bg-sunken rounded-full h-2 overflow-hidden border border-line">
                <div class="bg-gradient-to-r from-[#0d9488] to-[#81D8D0] h-2 rounded-full" style="width: ${st.percent}"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

// Window 3: AI-Marketer Recommendations
function renderExpertRecommendationsWindow(state) {
  const recs = state.expert.aiMarketerRecommendations;

  return `
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
          <span class="si-dot"></span>
          Рекомендации SI-маркетолога
        </span>
        <span class="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold">
          На основе отчетов
        </span>
      </div>

      <div class="space-y-2.5">
        ${recs.map(rec => `
          <div class="p-3.5 rounded-2xl glass-card-3d ${rec.applied ? 'border-emerald-500/30' : 'border-line'}">
            <div class="flex items-start justify-between gap-2 mb-1.5">
              <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-[#81D8D0]/20 text-brand border border-[#81D8D0]/30">
                ${rec.tag} • ${rec.impact}
              </span>
              ${rec.applied ? `
                <span class="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                  <i data-lucide="check-circle" class="w-3.5 h-3.5"></i> Внедрено
                </span>
              ` : ''}
            </div>

            <h3 class="text-xs font-bold text-ink mb-1">${rec.title}</h3>
            <p class="text-xs text-ink-2 leading-relaxed mb-3">${rec.reason}</p>

            ${!rec.applied ? `
              <button onclick="window.applyExpertRecommendation('${rec.id}')" class="w-full py-2 rounded-xl btn-3d-tiffany text-xs font-bold flex items-center justify-center gap-1.5 shadow-md">
                <i data-lucide="zap" class="w-3.5 h-3.5"></i>
                <span>Применить в аргументы SI-консультанта</span>
              </button>
            ` : `
              <div class="text-[11px] text-emerald-400 bg-emerald-950/40 p-2 rounded-xl border border-emerald-800/40 flex items-center gap-1.5">
                <i data-lucide="check" class="w-3.5 h-3.5"></i>
                <span>Инструкции SI-консультанта обновлены. Аргумент активен в чатах!</span>
              </div>
            `}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// Window PMF: Product-Market Fit Calibration
function renderExpertPmfWindow(state) {
  const pmf = state.expert.pmfInterview;
  const customButtons = state.expert.customButtons;

  return `
    <div class="space-y-3">
      <!-- PMF Score Header -->
      <div class="glass-card-3d p-4 border-[#81D8D0]/40">
        <div class="flex items-center justify-between mb-2">
          <div>
            <div class="text-[10px] text-brand uppercase tracking-wider font-extrabold">Product-Market Fit Индекс</div>
            <div class="text-lg font-extrabold text-ink flex items-center gap-2">
              <span>${pmf.pmfScore}%</span>
              <span class="text-xs font-bold text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30">PMF Достигнут</span>
            </div>
          </div>
          <div class="w-12 h-12 rounded-2xl bg-[#81D8D0]/20 border border-[#81D8D0]/40 flex items-center justify-center text-brand font-bold text-lg shadow">
            ⚡
          </div>
        </div>
        <p class="text-xs text-ink-2 leading-relaxed">
          SI-маркетолог задал вопросы эксперту, упаковал ценность, гарантии и кейсы, чтобы SI-консультант закрывал любые возражения лида.
        </p>
      </div>

      <!-- Question & Answer list -->
      <div class="glass-card-3d p-3 space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-ink uppercase tracking-wider">Распакованные материалы</span>
          <span class="text-[10px] text-muted">Обновлено: ${pmf.lastUpdated}</span>
        </div>

        <div class="space-y-2.5">
          ${pmf.questionsAndAnswers.map(qa => `
            <div class="p-3 rounded-xl bg-sunken border border-line space-y-1.5">
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-bold text-brand uppercase">${qa.category}</span>
                <button onclick="window.editPmfAnswer('${qa.id}')" class="text-[10px] text-sky-400 hover:text-sky-300 flex items-center gap-1">
                  <i data-lucide="edit-3" class="w-3 h-3"></i> Изменить
                </button>
              </div>
              <div class="text-xs font-bold text-ink">${qa.question}</div>
              <div class="text-xs text-ink-2 bg-raised p-2.5 rounded-lg border border-line leading-relaxed">
                ${qa.answer}
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Payment Link Settings -->
      <div class="glass-card-3d p-3 space-y-2 border-[#81D8D0]/30">
        <div class="flex items-center gap-2 mb-1">
          <i data-lucide="credit-card" class="w-4 h-4 text-brand"></i>
          <span class="text-xs font-bold text-ink uppercase tracking-wider">Оплата от клиентов</span>
        </div>
        <div class="space-y-1.5">
          <label class="text-[10px] text-muted block">Ваша ссылка на оплату (Prodamus, ЮKassa, Tribute и др.):</label>
          <div class="flex gap-2">
            <input type="text" id="expert-payment-link-input" value="${state.expert.expertPaymentLink || ''}" placeholder="https://pay.prodamus.ru/elena_coaching" class="flex-1 text-xs p-2 rounded-lg bg-sunken border border-line-2 text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]" />
            <button onclick="window.saveExpertPaymentLink()" class="px-2.5 py-1.5 rounded-lg btn-3d-tiffany text-[10px] font-bold whitespace-nowrap">Сохранить</button>
          </div>
          <div class="text-[10px] text-muted bg-sunken p-2 rounded-lg border border-line space-y-0.5">
            <div class="flex items-center gap-1 text-emerald-400 font-semibold"><span>✅</span> Лид оплачивает напрямую вам</div>
            <div class="flex items-center gap-1 text-muted"><span>👁️</span> Маркетолог видит только факт оплаты — без суммы и данных клиента</div>
            <div class="flex items-center gap-1 text-violet-400"><span>💳</span> Ваша подписка SmartFlow списывается через @tribute</div>
          </div>
        </div>
      </div>

      <!-- Custom Buttons Configuration -->
      <div class="glass-card-3d p-3 space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-ink uppercase tracking-wider">Кнопки действий для клиентов</span>
          <span class="text-[10px] text-muted">Отображаются у лида</span>
        </div>
        <div class="space-y-1.5">
          ${customButtons.map(btn => `
            <div class="flex items-center justify-between p-2 rounded-xl bg-sunken border border-line text-xs">
              <span class="text-ink-2 font-medium">${btn.label}</span>
              <span class="text-[10px] font-mono text-brand px-2 py-0.5 bg-raised rounded">${btn.action}</span>
            </div>
          `).join('')}
        </div>
      </div>

    </div>
  `;
}

// AI Broadcast Window
function renderExpertBroadcastWindow(state) {
  const bc = state.expert.aiBroadcast || {};
  const history = bc.history || [];

  return `
    <div class="space-y-3">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
          <i data-lucide="send-horizontal" class="w-4 h-4 text-violet-400"></i>
          SI-рассылки по базе лидов
        </span>
        <span class="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30 font-semibold">
          SI-копирайтер
        </span>
      </div>

      <!-- Broadcast Composer -->
      <div class="glass-card-3d p-3.5 space-y-3">
        <div class="text-[11px] text-ink-2 leading-relaxed">
          <span class="text-violet-400 font-bold">Скажите своими словами</span> кого и куда пригласить — SI подберёт сегмент, напишет сообщение и уточнит детали если нужно.
        </div>

        <!-- Prompt Input -->
        <div class="space-y-2">
          <textarea id="broadcast-prompt-input" rows="3" placeholder='Например: "Пригласи на мастер-класс в 16:00 в кофейне Раф всех тех кто не купил мини-курс «дыхание маткой»"' class="w-full text-xs p-2.5 rounded-xl bg-sunken border border-line-2 text-ink placeholder-faint focus:outline-none focus:border-violet-500 resize-none leading-relaxed">${bc.prompt || ''}</textarea>
          <button onclick="window.generateAiBroadcast()" class="w-full py-2.5 rounded-xl btn-3d-tiffany text-xs font-bold flex items-center justify-center gap-2 shadow-lg">
            <i data-lucide="sparkles" class="w-4 h-4"></i>
            <span>Анализировать и составить рассылку</span>
          </button>
        </div>

        <!-- Clarification Step -->
        ${bc.clarificationStep ? `
          <div class="p-3 rounded-xl bg-violet-900/20 border border-violet-500/30 space-y-2">
            <div class="flex items-start gap-2">
              <img src="images/mascots/si-consultant.webp" alt="" class="mascot-avatar" />
              <div class="text-xs text-violet-200 leading-relaxed">${bc.clarificationQuestion}</div>
            </div>
            <div class="flex gap-2">
              <input type="text" id="broadcast-clarify-input" placeholder="Напр: В эту субботу, вход бесплатный по брони..." class="flex-1 text-xs p-2 rounded-lg bg-sunken border border-violet-600/40 text-ink placeholder-faint focus:outline-none focus:border-violet-400" />
              <button onclick="window.confirmBroadcastDetails()" class="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-bold whitespace-nowrap">Подтвердить</button>
            </div>
          </div>
        ` : ''}

        <!-- Ready Post Preview -->
        ${bc.readyPost ? `
          <div class="space-y-2">
            <div class="text-[11px] font-bold text-ink flex items-center gap-1.5">
              <i data-lucide="check-circle" class="w-3.5 h-3.5 text-emerald-400"></i>
              Рассылка готова к отправке:
            </div>
            <div class="p-3 rounded-xl bg-sunken border border-emerald-500/30 space-y-2">
              <div class="text-[10px] font-bold text-emerald-400 flex items-center gap-1.5">
                <span>🎯 Сегмент: <span class="text-violet-300">${bc.readyPost.segment}</span></span>
                <span class="text-faint">•</span>
                <span>${bc.readyPost.count} лидов</span>
              </div>
              <div class="text-xs text-ink-2 leading-relaxed bg-sunken p-2.5 rounded-lg border border-line">${bc.readyPost.text}</div>
              <div class="p-2 rounded-lg bg-[#81D8D0]/10 border border-[#81D8D0]/20 text-center">
                <span class="text-[10px] font-bold text-brand">${bc.readyPost.buttonLabel}</span>
              </div>
            </div>
            <button onclick="window.sendBroadcastNow()" class="w-full py-2.5 rounded-xl btn-3d-tiffany text-xs font-bold flex items-center justify-center gap-2 shadow-lg">
              <i data-lucide="send" class="w-4 h-4"></i>
              <span>✉️ Отправить ${bc.readyPost.count} лидам</span>
            </button>
          </div>
        ` : ''}
      </div>

      <!-- Broadcast History -->
      <div class="glass-card-3d p-3 space-y-2">
        <span class="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
          <i data-lucide="history" class="w-4 h-4 text-muted"></i>
          История рассылок
        </span>
        ${history.length === 0 ? `
          <div class="text-center py-4 text-faint text-xs">Рассылок пока нет. Отправьте первую выше! 🚀</div>
        ` : `
          <div class="space-y-2">
            ${history.map(item => `
              <div class="p-2.5 rounded-xl bg-sunken border border-line space-y-1.5">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-bold text-ink">${item.title}</span>
                  <span class="text-[9px] text-faint">${item.date}</span>
                </div>
                <div class="flex items-center gap-3 text-[10px]">
                  <span class="text-violet-300">${item.targetTag}</span>
                  <span class="text-muted">${item.sentCount} отправлено</span>
                  <span class="text-emerald-400">Open rate: ${item.openRate}</span>
                </div>
                <div class="text-[10px] font-bold text-emerald-400">${item.status}</div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    </div>
  `;
}

// -------------------------------------------------------------
// 3. CLIENT / LEAD VIEW (Strictly Isolated Chat Experience)
// -------------------------------------------------------------
function renderClientView(state) {
  const session = state.clientSession;

  return `
    <div class="flex flex-col h-full space-y-3">
      <!-- AI Seller Profile Bar (Tiffany & Red Style) -->
      <div class="glass-card-3d p-3 border-[var(--si-bubble-line)] flex items-center justify-between gap-2">
        <div class="flex items-center gap-2.5">
          <div class="relative">
            <img src="${session.expertAvatar}" class="w-10 h-10 rounded-full object-cover border-2 border-[#81D8D0]" />
            <span class="absolute bottom-0 right-0 w-3 h-3 bg-[var(--sf-si-red)] rounded-full border-2 border-card"></span>
          </div>
          <div>
            <div class="text-xs font-bold text-ink flex items-center gap-1">
              <span>SI-консультант · ${session.expertName}</span>
            </div>
            <div class="text-[10px] text-si">Онлайн • слушает аудио и текст 🎙️</div>
          </div>
        </div>

        <!-- Human contact button (Direct user requirement) -->
        <button onclick="window.triggerHumanContact()" class="px-2.5 py-1.5 rounded-xl btn-3d-tiffany text-[11px] flex items-center gap-1">
          <i data-lucide="user" class="w-3.5 h-3.5"></i>
          <span>Связаться с человеком</span>
        </button>
      </div>

      <!-- Quick Action Buttons configured by Expert & Marketer -->
      <div class="flex gap-1.5 overflow-x-auto pb-1 text-xs">
        <button onclick="window.sendPredefinedMessage('Хочу записаться на диагностическую сессию к Елене')" class="px-2.5 py-1.5 rounded-xl btn-3d-tiffany text-xs whitespace-nowrap">
          📅 Записаться на разбор
        </button>
        <button onclick="window.sendPredefinedMessage('Покажите кейсы и отзывы ваших клиентов')" class="px-2.5 py-1.5 rounded-xl btn-3d-dark text-xs whitespace-nowrap">
          🏆 Кейсы и результаты
        </button>
        <button onclick="window.sendPredefinedMessage('Сколько стоит работа с Еленой и какие форматы?')" class="px-2.5 py-1.5 rounded-xl btn-3d-dark text-xs whitespace-nowrap">
          💰 Стоимость и рассрочка
        </button>
      </div>

      <!-- Live Interactive Chat Window with Audio Support -->
      <div class="glass-card-3d p-3 flex-1 flex flex-col space-y-2.5 min-h-[360px] max-h-[480px] overflow-y-auto" id="client-chat-scroll">
        ${session.messages.map(msg => `
          <div class="flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'} space-y-1">
            ${msg.isVoice ? `
              <!-- Render Voice Message with Waveform & Whisper Transcript -->
              <div class="audio-voice-box max-w-[85%]">
                <div class="flex items-center justify-between gap-3">
                  <div class="flex items-center gap-2">
                    <button onclick="window.toggleVoicePlay('${msg.id}')" class="w-8 h-8 rounded-full bg-[#81D8D0] text-[#090e17] flex items-center justify-center font-bold text-xs shadow-md">
                      <i data-lucide="play" class="w-4 h-4"></i>
                    </button>
                    <div>
                      <div class="text-xs font-bold text-ink flex items-center gap-1">
                        <span>Голосовое</span>
                        <span class="text-[9px] text-brand font-mono">${msg.duration}</span>
                      </div>
                      <div class="text-[9px] text-muted">SI-расшифровка голоса</div>
                    </div>
                  </div>
                </div>

                <!-- Animated Waveform -->
                <div class="audio-waveform" id="waveform-${msg.id}">
                  <span class="waveform-bar h-2"></span>
                  <span class="waveform-bar h-4"></span>
                  <span class="waveform-bar h-6"></span>
                  <span class="waveform-bar h-3"></span>
                  <span class="waveform-bar h-5"></span>
                  <span class="waveform-bar h-7"></span>
                  <span class="waveform-bar h-4"></span>
                  <span class="waveform-bar h-2"></span>
                  <span class="waveform-bar h-5"></span>
                  <span class="waveform-bar h-3"></span>
                </div>

                <!-- Transcribed Text -->
                <div class="text-[11px] text-ink-2 bg-sunken p-2 rounded-xl border border-line">
                  <span class="text-brand font-semibold">Расшифровка:</span> ${msg.text}
                </div>
              </div>
            ` : `
              ${msg.sender === 'user' ? `
                <div class="chat-bubble-human">
                  ${formatChatMarkdown(msg.text)}
                </div>
              ` : `
                <div class="flex items-end gap-1.5 w-full">
                  <img src="images/mascots/si-consultant.webp" alt="SI" class="mascot-avatar" />
                  <div class="chat-bubble-si">
                    ${formatChatMarkdown(msg.text)}
                  </div>
                </div>
              `}
            `}

            <!-- Quick Replies Chips -->
            ${msg.quickReplies && msg.quickReplies.length ? `
              <div class="flex flex-wrap gap-1.5 pt-1">
                ${msg.quickReplies.map(qr => `
                  <button onclick="window.handleQuickReplyTap('${escapeHtml(qr)}')" class="text-[11px] px-2.5 py-1 rounded-xl bg-card text-brand hover:bg-sunken border border-[#81D8D0]/50 transition shadow-sm font-semibold">
                    ${qr}
                  </button>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `).join('')}

        <!-- Audio listening & typing indicator -->
        <div id="ai-typing-indicator" class="hidden flex items-end gap-1.5">
          <img src="images/mascots/si-consultant.webp" alt="SI" class="mascot-avatar" />
          <div class="typing-dots">
            <span class="text-[10px] text-si font-medium mr-1.5" id="ai-action-status">SI формирует ответ...</span>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
          </div>
        </div>
      </div>

      <!-- Clean Status Bar -->
      <div class="flex items-center justify-between text-[11px] text-muted px-1">
        <span class="flex items-center gap-1.5 text-[10px] text-muted">
          <i data-lucide="mic" class="w-3 h-3 text-brand"></i>
          <span>SI слушает голосовые сообщения</span>
        </span>
        <button onclick="window.clearClientChat()" class="text-[10px] text-faint hover:text-rose-400 transition">Очистить чат</button>
      </div>

      <!-- Chat input message box with Voice Recorder Button -->
      <form onsubmit="window.handleClientSendMessage(event)" class="flex items-center gap-2">
        <button type="button" onclick="window.recordVoiceInteractive()" title="Записать голосовое сообщение" class="p-2.5 rounded-xl btn-3d-dark flex items-center justify-center shadow">
          <i data-lucide="mic" class="w-4 h-4"></i>
        </button>
        <input type="text" id="client-chat-input" placeholder="Напишите текст или отправьте войс..." class="flex-1 bg-sunken border border-line-2 rounded-xl px-3 py-2.5 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]" />
        <button type="submit" class="p-2.5 rounded-xl btn-3d-tiffany flex items-center justify-center shadow">
          <i data-lucide="send" class="w-4 h-4"></i>
        </button>
      </form>
    </div>
  `;
}

// -------------------------------------------------------------
// 4. Y COMBINATOR & GOOGLE TIER DATA ROOM
// -------------------------------------------------------------
function renderInvestorDataRoom(state) {
  const inv = state.investorData;
  const f = inv.financials;

  return `
    <div class="space-y-3.5">
      <!-- Deck Headline Banner -->
      <div class="glass-card-3d p-4 border-rose-500/40 ">
        <div class="flex items-center justify-between mb-2">
          <span class="yc-badge">${inv.round}</span>
          <span class="text-[10px] text-muted font-mono">${inv.targetInvestors}</span>
        </div>
        <h1 class="text-sm font-black text-ink leading-snug mb-1">
          ${inv.deckHeadline}
        </h1>
        <p class="text-xs text-ink-2">
          SmartFlow решает главную боль $52B рынка инфобизнеса: эксперты теряют 82% лидов из-за медленных ответов и неграмотной квалификации. SmartFlow ставит автономного SI-консультанта в Telegram.
        </p>
      </div>

      <!-- Key SaaS & Financial Metrics Grid -->
      <div class="glass-card-3d p-4">
        <h2 class="text-xs font-bold text-ink uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <i data-lucide="activity" class="w-4 h-4 text-brand"></i>
          Top-Decile SaaS Metrics (Метрики топ-1% YC)
        </h2>

        <div class="grid grid-cols-2 gap-2 mb-2">
          <div class="p-2.5 rounded-xl bg-sunken border border-line">
            <div class="text-[10px] text-muted">Net Revenue Retention (NRR)</div>
            <div class="text-base font-black text-emerald-400">${f.netRevenueRetention}</div>
            <div class="text-[9px] text-faint">Отрицательный отток выручки</div>
          </div>
          <div class="p-2.5 rounded-xl bg-sunken border border-line">
            <div class="text-[10px] text-muted">MRR (Monthly Recurring)</div>
            <div class="text-base font-black text-brand">${f.mrr}</div>
            <div class="text-[9px] text-faint">${f.mrrRub} (${f.momGrowth} MoM)</div>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-2 text-center">
          <div class="p-2 rounded-xl bg-sunken border border-line">
            <div class="text-[9px] text-muted">LTV / CAC</div>
            <div class="text-xs font-black text-rose-400">${f.ltvCacRatio}</div>
            <div class="text-[8px] text-faint">${f.ltv} / ${f.cac}</div>
          </div>
          <div class="p-2 rounded-xl bg-sunken border border-line">
            <div class="text-[9px] text-muted">Payback Period</div>
            <div class="text-xs font-black text-ink">${f.paybackPeriod}</div>
            <div class="text-[8px] text-faint">&lt; 1 месяца</div>
          </div>
          <div class="p-2 rounded-xl bg-sunken border border-line">
            <div class="text-[9px] text-muted">Gross Margin</div>
            <div class="text-xs font-black text-brand">${f.grossMargin}</div>
            <div class="text-[8px] text-faint">Чистая софтверная маржа</div>
          </div>
        </div>
      </div>

      <!-- Viral Growth Flywheel (K-Factor = 1.68) -->
      <div class="glass-card-3d p-4 border-[#81D8D0]/30">
        <h2 class="text-xs font-bold text-ink uppercase tracking-wider mb-1 flex items-center gap-1.5">
          <i data-lucide="zap" class="w-4 h-4 text-amber-400"></i>
          Product-Led Growth Flywheel (Виральный маховик)
        </h2>
        <div class="text-xs text-ink-2 mb-2">
          Коэффициент виральности <strong class="text-amber-400">K = ${inv.growthFlywheel.kFactor}</strong>. Каждый подключенный эксперт в среднем проводит через своего SI-консультанта 480 лидов в месяц. 3.4% из этих лидов сами являются экспертами или маркетологами и создают свой аккаунт SmartFlow!
        </div>
        <div class="p-2.5 rounded-xl bg-sunken border border-line text-[11px] text-brand font-semibold">
          🚀 <strong>Zero Paid Marketing:</strong> ${inv.growthFlywheel.zeroPaidMarketing}.
        </div>
      </div>

      <!-- Market Size (TAM / SAM / SOM) -->
      <div class="glass-card-3d p-4">
        <h2 class="text-xs font-bold text-ink uppercase tracking-wider mb-2">Объем рынка (TAM / SAM / SOM)</h2>
        <div class="space-y-1.5 text-xs">
          <div class="p-2 rounded-xl bg-sunken border border-line flex justify-between items-center">
            <div>
              <div class="font-bold text-ink">TAM: ${inv.marketSize.tam}</div>
              <div class="text-[10px] text-muted">${inv.marketSize.tamDesc}</div>
            </div>
            <span class="text-xs font-bold text-brand">Global</span>
          </div>

          <div class="p-2 rounded-xl bg-sunken border border-line flex justify-between items-center">
            <div>
              <div class="font-bold text-ink">SAM: ${inv.marketSize.sam}</div>
              <div class="text-[10px] text-muted">${inv.marketSize.samDesc}</div>
            </div>
            <span class="text-xs font-bold text-rose-400">Social-First</span>
          </div>

          <div class="p-2 rounded-xl bg-sunken border border-line flex justify-between items-center">
            <div>
              <div class="font-bold text-ink">SOM: ${inv.marketSize.som}</div>
              <div class="text-[10px] text-muted">${inv.marketSize.somDesc}</div>
            </div>
            <span class="text-xs font-bold text-amber-400">Initial Beachhead</span>
          </div>
        </div>
      </div>

      <!-- AI Performance Benchmarks Table -->
      <div class="glass-card-3d p-4">
        <h2 class="text-xs font-bold text-ink uppercase tracking-wider mb-2">SmartFlow vs Human Sales Reps</h2>
        <div class="space-y-2">
          ${inv.benchmarks.map(b => `
            <div class="p-2.5 rounded-xl bg-sunken border border-line text-xs">
              <div class="flex justify-between font-bold text-ink mb-1">
                <span>${b.metric}</span>
                <span class="text-brand font-extrabold">${b.delta}</span>
              </div>
              <div class="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-line">
                <div class="text-muted">Человек: <strong class="text-ink-2">${b.human}</strong></div>
                <div class="text-muted">SmartFlow: <strong class="text-emerald-400">${b.smartFlow}</strong></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

// -------------------------------------------------------------
// BOTTOM NAVIGATION
// -------------------------------------------------------------
function renderBottomNav(state) {
  const role = state.activeRole;
  const waitingDirectInquiries = state.expert.directHumanInquiries.filter(i => i.status === 'waiting').length;

  return `
    <div class="tg-nav-bar flex items-center justify-around">
      <button onclick="window.switchRole('marketer')" class="tg-nav-item ${role === 'marketer' ? 'active' : ''}">
        <i data-lucide="layout-grid" class="w-4 h-4"></i>
        <span>Маркетолог</span>
      </button>

      <button onclick="window.switchRole('expert')" class="tg-nav-item relative ${role === 'expert' ? 'active' : ''}">
        <i data-lucide="user-check" class="w-4 h-4"></i>
        <span>Эксперт</span>
        ${waitingDirectInquiries ? `
          <span class="absolute top-1 right-2 w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
        ` : ''}
      </button>

      <button onclick="window.switchRole('client')" class="tg-nav-item ${role === 'client' ? 'active' : ''}">
        <i data-lucide="bot" class="w-4 h-4"></i>
        <span>Клиент (Лид)</span>
      </button>
    </div>
  `;
}

// -------------------------------------------------------------
// EVENT HANDLERS & INTERACTIONS
// -------------------------------------------------------------
function setupGlobalEventListeners() {
  window.switchRole = (role) => {
    window.funnelStore.setRole(role);
    if (!window.Telegram?.WebApp?.initData && window.smartFlowApi && role !== 'client') {
      window.smartFlowApi.loginDev(role).then(res => {
        window.funnelStore.setAuth(res);
      }).catch(() => {});
    }
  };

  window.setMarketerSubTab = (tab) => {
    window.funnelStore.data.marketerSubTab = tab;
    window.funnelStore.notify();
  };

  window.setExpertTab = (tab) => {
    window.funnelStore.data.expertTab = tab;
    window.funnelStore.notify();
  };

  window.selectFunnel = (id) => {
    window.funnelStore.selectFunnel(id);
  };

  window.selectExpertChat = (chatId) => {
    window.funnelStore.data.selectedExpertChatId = chatId;
    window.funnelStore.notify();
  };

  window.copySellerLink = (link) => {
    navigator.clipboard.writeText(link).then(() => {
      showToast('Ссылка скопирована в буфер обмена!');
    }).catch(() => {
      showToast('Ссылка: ' + link);
    });
  };

  window.openQrModal = (link) => {
    const modal = document.getElementById('modal-container');
    modal.innerHTML = `
      <div class="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4" onclick="window.closeModal()">
        <div class="glass-card-3d max-w-xs w-full p-6 text-center space-y-4 border-[#81D8D0]/40" onclick="event.stopPropagation()">
          <h3 class="text-sm font-bold text-ink">QR-код SI-консультанта</h3>
          <div class="bg-white p-4 rounded-2xl mx-auto w-48 h-48 flex items-center justify-center shadow-lg">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(link)}" alt="QR Code" class="w-full h-full" />
          </div>
          <p class="text-xs text-ink-2">Распространяйте в Telegram-канале, Instagram Stories и рекламе</p>
          <button onclick="window.closeModal()" class="w-full py-2 rounded-xl btn-3d-dark text-xs font-semibold">Закрыть</button>
        </div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  };

  window.closeModal = () => {
    const modal = document.getElementById('modal-container');
    if (modal) modal.innerHTML = '';
  };

  // Human contact action from client
  window.triggerHumanContact = () => {
    // Register inquiry in store for the expert
    window.funnelStore.registerDirectInquiry({
      leadName: 'Посетитель сайта',
      leadUsername: '@client_direct',
      summary: 'Клиент нажал кнопку «Связаться с человеком» в SmartFlow.',
      lastDirectMessage: 'Хочу пообщаться лично с Еленой по условиям программы.'
    });

    if (window.smartFlowApi) {
      window.smartFlowApi.requestHumanContact('elena-mentor', {
        reason: 'Клиент нажал кнопку «Связаться с человеком» в SmartFlow.',
        leadName: 'Посетитель Telegram',
        leadUsername: '@client_direct'
      }).catch(() => {});
    }

    showToast('Елена получила уведомление в раздел «Кто написал лично» 👤');
    setTimeout(() => {
      alert('Запрос зафиксирован! В реальном боте открывается диалог @elena_coach, а в кабинете эксперта заявка поступила в приоритетную очередь «Лично 👤».');
    }, 200);
  };

  // Direct Inquiry handlers from expert
  window.replyDirectInquiry = (inquiryId, leadName) => {
    const reply = prompt(`Введите ответ для ${leadName}:`, 'Здравствуйте! С удовольствием отвечу на ваши вопросы лично. Когда вам удобно созвониться на 15 минут?');
    if (reply) {
      window.funnelStore.resolveDirectInquiry(inquiryId, reply);
      showToast(`Ответ отправлен ${leadName} от имени эксперта!`);
    }
  };

  window.openLeadTelegram = (username) => {
    showToast(`Открываем Telegram профиль ${username}...`);
    window.open(`https://t.me/${username.replace('@', '')}`, '_blank');
  };

  // Voice message simulation & Speech-to-Text
  window.simulateUserVoice = (transcription, duration) => {
    // 1. Show audio being sent
    window.funnelStore.sendClientVoiceMessage(transcription, duration);
    scrollToBottom('client-chat-scroll');

    // 2. Animate listening & Whisper transcription
    const indicator = document.getElementById('ai-typing-indicator');
    const statusText = document.getElementById('ai-action-status');
    if (indicator && statusText) {
      statusText.innerText = '🎧 SI расшифровывает аудио...';
      indicator.classList.remove('hidden');
    }

    setTimeout(() => {
      if (statusText) statusText.innerText = 'SI-консультант формирует ответ...';
      setTimeout(() => {
        if (indicator) indicator.classList.add('hidden');
        withAiEngine((aiEngine) => {
          const reply = aiEngine.generateSellerResponse(transcription, window.funnelStore.data.clientSession.messages);
          window.funnelStore.addAiSellerReply(reply.text, reply.quickReplies);
          scrollToBottom('client-chat-scroll');
        });
      }, 900);
    }, 1100);
  };

  let isRecordingAudio = false;
  let recordingTimer = null;
  let recordingSeconds = 0;

  window.recordVoiceInteractive = () => {
    const micBtn = document.getElementById('record-mic-btn');
    const input = document.getElementById('client-chat-input');
    
    if (!isRecordingAudio) {
      isRecordingAudio = true;
      recordingSeconds = 0;
      if (micBtn) {
        micBtn.classList.remove('btn-3d-dark');
        micBtn.classList.add('bg-rose-600', 'animate-pulse');
        micBtn.innerHTML = '<i data-lucide="square" class="w-4 h-4 text-white"></i>';
      }
      if (input) {
        input.disabled = true;
        input.placeholder = '🔴 Идет запись голосового... [0:00] • Нажмите для отправки';
      }
      if (window.lucide) window.lucide.createIcons();

      recordingTimer = setInterval(() => {
        recordingSeconds++;
        if (input) {
          input.placeholder = `🔴 Идет запись голосового... [0:${recordingSeconds < 10 ? '0' : ''}${recordingSeconds}] • Нажмите для отправки`;
        }
      }, 1000);

    } else {
      isRecordingAudio = false;
      clearInterval(recordingTimer);
      const durationStr = `0:${recordingSeconds < 10 ? '0' : ''}${Math.max(2, recordingSeconds)}`;
      
      if (micBtn) {
        micBtn.classList.remove('bg-rose-600', 'animate-pulse');
        micBtn.classList.add('btn-3d-dark');
        micBtn.innerHTML = '<i data-lucide="mic" class="w-4 h-4"></i>';
      }
      if (input) {
        input.disabled = false;
        input.placeholder = 'Напишите текст или отправьте войс...';
      }
      if (window.lucide) window.lucide.createIcons();

      const samplePhrases = [
        'Здравствуйте! У меня проект в IT, команда 15 человек. Хочу понять, как выстроить систему делегирования и освободить время.',
        'Добрый день! Скажите, а какие гарантии дает Елена и как проходит стратегическая сессия?',
        'Здравствуйте! Подскажите, есть ли возможность созвониться лично с Еленой на этой неделе?'
      ];
      const spokenText = samplePhrases[Math.floor(Math.random() * samplePhrases.length)];
      
      window.simulateUserVoice(spokenText, durationStr);
    }
  };

  window.toggleVoicePlay = (id) => {
    const waveform = document.getElementById('waveform-' + id);
    if (!waveform) return;

    if (activeVoicePlaybackId === id) {
      waveform.classList.remove('waveform-playing');
      activeVoicePlaybackId = null;
    } else {
      document.querySelectorAll('.waveform-playing').forEach(el => el.classList.remove('waveform-playing'));
      waveform.classList.add('waveform-playing');
      activeVoicePlaybackId = id;
      setTimeout(() => {
        waveform.classList.remove('waveform-playing');
        activeVoicePlaybackId = null;
      }, 4000);
    }
  };

  window.handleQuickReplyTap = (text) => {
    if (text.includes('аудио') || text.includes('🎙️')) {
      window.recordVoiceInteractive();
    } else {
      window.sendPredefinedMessage(text);
    }
  };

  window.sendPredefinedMessage = (text) => {
    executeClientChatExchange(text);
  };

  window.handleClientSendMessage = (e) => {
    e.preventDefault();
    const input = document.getElementById('client-chat-input');
    if (!input || !input.value.trim()) return;
    const text = input.value.trim();
    input.value = '';
    executeClientChatExchange(text);
  };

  window.clearClientChat = () => {
    window.funnelStore.clearClientChat();
    showToast('Чат очищен');
  };

  window.handleExpertTakeover = (e, chatId) => {
    e.preventDefault();
    const input = document.getElementById('expert-takeover-input');
    if (!input || !input.value.trim()) return;
    const val = input.value.trim();
    window.funnelStore.sendExpertMessageToLead(chatId, val);
    input.value = '';
    showToast('Сообщение отправлено лиду лично от эксперта 👤');
    scrollToBottom('expert-chat-scroll');
  };

  window.applyExpertRecommendation = (recId) => {
    window.funnelStore.applyExpertRecommendation(recId);
    showToast('Рекомендация внедрена в базу знаний SI-консультанта 🚀');
    if (window.confetti) {
      window.confetti({ particleCount: 70, spread: 60 });
    }
  };

  window.openCreateFunnelModal = () => {
    const modal = document.getElementById('modal-container');
    modal.innerHTML = `
      <div class="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4" onclick="window.closeModal()">
        <div class="glass-card-3d max-w-md w-full p-5 space-y-3 border-[#81D8D0]/40 max-h-[90vh] overflow-y-auto" onclick="event.stopPropagation()">
          <div class="flex items-center justify-between border-b border-line pb-2">
            <h3 class="text-sm font-bold text-ink flex items-center gap-1.5">
              <i data-lucide="plus-circle" class="w-4 h-4 text-brand"></i>
              Создать новую воронку SmartFlow
            </h3>
            <button onclick="window.closeModal()" class="text-muted hover:text-ink">&times;</button>
          </div>

          <form onsubmit="window.handleCreateFunnelSubmit(event)" class="space-y-3 text-xs">
            <div>
              <label class="block text-ink-2 font-medium mb-1">Название воронки:</label>
              <input type="text" id="fn-title" required placeholder="Напр: Воронка для нутрициологов и фитнес-тренеров" class="w-full p-2 bg-sunken border border-line-2 rounded-lg text-ink" />
            </div>

            <div>
              <label class="block text-ink-2 font-medium mb-1">Ниша экспертов:</label>
              <input type="text" id="fn-niche" required placeholder="Здоровье, фитнес, нутрициология" class="w-full p-2 bg-sunken border border-line-2 rounded-lg text-ink" />
            </div>

            <div>
              <label class="block text-ink-2 font-medium mb-1">Стоимость ежемесячной подписки (₽/мес):</label>
              <input type="number" id="fn-price" required value="7900" class="w-full p-2 bg-sunken border border-line-2 rounded-lg text-ink" />
            </div>

            <div>
              <label class="block text-ink-2 font-medium mb-1">Структура воронки маркетолога:</label>
              <textarea id="fn-desc" rows="3" class="w-full p-2 bg-sunken border border-line-2 rounded-lg text-ink" placeholder="Опишите этапы воронки..."></textarea>
            </div>

            <div class="pt-2 flex gap-2">
              <button type="button" onclick="window.closeModal()" class="flex-1 py-2 btn-3d-dark text-xs">Отмена</button>
              <button type="submit" class="flex-1 py-2 btn-3d-tiffany text-xs font-bold shadow-lg">Создать и запустить</button>
            </div>
          </form>
        </div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  };

  window.handleCreateFunnelSubmit = (e) => {
    e.preventDefault();
    const title = document.getElementById('fn-title').value;
    const niche = document.getElementById('fn-niche').value;
    const monthlyPrice = document.getElementById('fn-price').value;
    const desc = document.getElementById('fn-desc').value;

    window.funnelStore.createFunnel({ title, niche, monthlyPrice, description: desc });
    window.closeModal();
    showToast('Воронка создана в SmartFlow!');
    if (window.confetti) {
      window.confetti({ particleCount: 70, spread: 60 });
    }
  };

  window.toggleBotState = (inqId) => {
    const newState = window.funnelStore.toggleInquiryBotState(inqId);
    if (newState === 'standby') {
      showToast('SI включён: режим Standby — ждёт сигнала рассылки');
    } else {
      showToast('SI на паузе — вы ведёте диалог лично');
    }
  };

  window.addLeadTag = (inqId, tag) => {
    if (!tag) return;
    window.funnelStore.addTagToInquiry(inqId, tag);
    showToast(`Тег ${tag} добавлен лиду`);
  };

  window.removeLeadTag = (inqId, tag) => {
    window.funnelStore.removeTagFromInquiry(inqId, tag);
    showToast(`Тег ${tag} удалён`);
  };

  window.generateAiBroadcast = () => {
    const textarea = document.getElementById('broadcast-prompt-input');
    const text = textarea ? textarea.value.trim() : '';
    if (!text) {
      showToast('Опишите кого и куда пригласить 👆');
      return;
    }
    window.funnelStore.generateAiBroadcast(text);
    showToast('SI анализирует вашу базу лидов... 🧠');
  };

  window.confirmBroadcastDetails = () => {
    const input = document.getElementById('broadcast-clarify-input');
    const text = input ? input.value.trim() : '';
    if (!text) {
      showToast('Уточните детали для SI 👆');
      return;
    }
    window.funnelStore.confirmBroadcastDetails(text);
    showToast('Детали приняты — рассылка сформирована ✅');
  };

  window.sendBroadcastNow = () => {
    const camp = window.funnelStore.sendBroadcastNow();
    if (camp) {
      showToast(`Рассылка отправлена ${camp.sentCount} лидам! 🚀`);
      if (window.confetti) {
        window.confetti({ particleCount: 80, spread: 70 });
      }
    }
  };

  window.saveExpertPaymentLink = () => {
    const input = document.getElementById('expert-payment-link-input');
    const val = input ? input.value.trim() : '';
    if (val) {
      window.funnelStore.data.expert.expertPaymentLink = val;
      window.funnelStore.saveData();
      showToast('Ссылка оплаты сохранена! Клиенты будут переходить по ней 💳');
    } else {
      showToast('Введите ссылку на оплату');
    }
  };

  window.editPmfAnswer = (qaId) => {
    const state = window.funnelStore.data;
    const qa = state.expert.pmfInterview.questionsAndAnswers.find(q => q.id === qaId);
    if (!qa) return;
    const newAnswer = prompt(qa.question, qa.answer);
    if (newAnswer !== null && newAnswer.trim()) {
      window.funnelStore.updatePmfAnswer(qaId, newAnswer.trim());
      showToast('Ответ обновлён в базе знаний SI-консультанта ✅');
    }
  };

  window.resetDemoData = () => {
    if (confirm('Сбросить данные SmartFlow к начальному демо-состоянию?')) {
      window.funnelStore.resetToDefault();
      showToast('Данные сброшены!');
    }
  };
}

function executeClientChatExchange(userText) {
  window.funnelStore.sendClientMessage(userText);
  scrollToBottom('client-chat-scroll');

  // Asynchronously sync with SmartFlow core backend CRM
  if (window.smartFlowApi) {
    window.smartFlowApi.sendClientChat('elena-mentor', {
      name: 'Клиент Telegram',
      message: userText
    }).catch(() => {});
  }

  const indicator = document.getElementById('ai-typing-indicator');
  const statusText = document.getElementById('ai-action-status');
  if (indicator) {
    if (statusText) statusText.innerText = 'SI-консультант формирует ответ...';
    indicator.classList.remove('hidden');
  }

  setTimeout(() => {
    if (indicator) indicator.classList.add('hidden');
    withAiEngine((aiEngine) => {
      const reply = aiEngine.generateSellerResponse(userText, window.funnelStore.data.clientSession.messages);
      window.funnelStore.addAiSellerReply(reply.text, reply.quickReplies);
      scrollToBottom('client-chat-scroll');
    });
  }, 900);
}

function scrollToBottom(elementId) {
  setTimeout(() => {
    const el = document.getElementById(elementId);
    if (el) el.scrollTop = el.scrollHeight;
  }, 50);
}

function formatMoney(amount) {
  if (typeof amount === 'string') return amount;
  return new Intl.NumberFormat('ru-RU').format(amount) + ' ₽';
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function formatChatMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>');
}

function showToast(msg) {
  const existing = document.getElementById('app-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'app-toast';
  toast.className = 'fixed bottom-16 left-1/2 -translate-x-1/2 z-50 max-w-[90vw] pl-1.5 pr-4 py-1.5 rounded-2xl bg-card border border-[#81D8D0]/60 text-ink text-xs font-semibold shadow-2xl flex items-center gap-2';
  toast.innerHTML = `<img src="images/mascots/si-buddy.webp" alt="" class="w-7 h-7 flex-shrink-0" /><span>${msg}</span>`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 2800);
}
