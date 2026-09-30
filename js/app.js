// app.js - Main Application Controller & UI Renderer

let funnelChartInstance = null;
let expertChartInstance = null;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Initialize Telegram WebApp SDK if available
  if (window.Telegram && window.Telegram.WebApp) {
    try {
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand();
      if (window.Telegram.WebApp.themeParams) {
        console.log('Telegram Theme Params:', window.Telegram.WebApp.themeParams);
      }
    } catch (e) {
      console.log('Running outside native Telegram container');
    }
  }

  // Subscribe to store updates
  window.funnelStore.subscribe((state) => {
    renderApp(state);
  });

  // Initial render
  renderApp(window.funnelStore.data);
  setupGlobalEventListeners();
});

// Render the entire app based on current state
function renderApp(state) {
  const container = document.getElementById('app-root');
  if (!container) return;

  const role = state.activeRole;
  const isDeviceMode = state.viewMode === 'desktop-tma';

  let roleContentHtml = '';
  if (role === 'marketer') {
    roleContentHtml = renderMarketerView(state);
  } else if (role === 'expert') {
    roleContentHtml = renderExpertView(state);
  } else if (role === 'client') {
    roleContentHtml = renderClientView(state);
  }

  container.innerHTML = `
    <!-- Top Control Bar (Role switcher & view mode toggle) -->
    <header class="w-full max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-sky-500/20">
          FM
        </div>
        <div>
          <div class="font-bold text-base flex items-center gap-2">
            <span>FunnelMind AI</span>
            <span class="text-xs px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">Telegram Mini App</span>
          </div>
          <div class="text-xs text-slate-400">Платформа AI-воронок для маркетологов и экспертов</div>
        </div>
      </div>

      <!-- Role Switcher -->
      <div class="flex items-center bg-slate-800/90 p-1 rounded-2xl border border-slate-700/80 shadow-inner">
        <button onclick="window.switchRole('marketer')" class="px-3.5 py-1.5 rounded-xl font-medium text-xs transition flex items-center gap-1.5 ${role === 'marketer' ? 'bg-sky-500 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}">
          <i data-lucide="briefcase" class="w-3.5 h-3.5"></i>
          <span>Маркетолог</span>
        </button>
        <button onclick="window.switchRole('expert')" class="px-3.5 py-1.5 rounded-xl font-medium text-xs transition flex items-center gap-1.5 ${role === 'expert' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}">
          <i data-lucide="graduation-cap" class="w-3.5 h-3.5"></i>
          <span>Эксперт</span>
        </button>
        <button onclick="window.switchRole('client')" class="px-3.5 py-1.5 rounded-xl font-medium text-xs transition flex items-center gap-1.5 ${role === 'client' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}">
          <i data-lucide="message-square" class="w-3.5 h-3.5"></i>
          <span>Клиент / Лид</span>
        </button>
      </div>

      <!-- Viewport toggle & Reset -->
      <div class="flex items-center gap-2">
        <button onclick="window.toggleViewMode()" title="Переключить рамку смартфона" class="p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 transition flex items-center gap-1.5 text-xs">
          <i data-lucide="${isDeviceMode ? 'maximize-2' : 'smartphone'}" class="w-4 h-4"></i>
          <span class="hidden sm:inline">${isDeviceMode ? 'Полный экран' : 'Вид в Telegram'}</span>
        </button>
        <button onclick="window.resetDemoData()" title="Сбросить демо-данные" class="p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 hover:text-rose-400 transition" title="Сброс">
          <i data-lucide="rotate-ccw" class="w-4 h-4"></i>
        </button>
      </div>
    </header>

    <!-- Main Container -->
    <main class="w-full flex-1 flex flex-col items-center justify-start ${isDeviceMode ? 'device-mode' : 'fullscreen-mode'}">
      <div class="phone-mockup flex flex-col">
        ${isDeviceMode ? `
          <div class="phone-island">
            <div class="phone-speaker"></div>
            <div class="phone-camera"></div>
          </div>
        ` : ''}

        <!-- Telegram Mini App Header Bar -->
        <div class="tg-header flex items-center justify-between mt-${isDeviceMode ? '6' : '0'}">
          <div class="flex items-center gap-2">
            <div class="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-xs font-semibold text-slate-200">
              ${role === 'marketer' ? '👔' : (role === 'expert' ? '🎓' : '🤖')}
            </div>
            <div>
              <div class="text-xs font-bold text-white flex items-center gap-1">
                ${role === 'marketer' ? 'Кабинет Маркетолога' : (role === 'expert' ? 'Кабинет Эксперта' : 'ИИ-Продавец Елены Смирновой')}
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              </div>
              <div class="text-[10px] text-slate-400">
                ${role === 'marketer' ? '@gromov_funnels • MRR 237k ₽' : (role === 'expert' ? 'Воронка: High-Ticket • PMF 94%' : 'онлайн • отвечает за 2 сек')}
              </div>
            </div>
          </div>

          <div class="flex items-center gap-1">
            <span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
              ${role === 'marketer' ? 'Маркетолог' : (role === 'expert' ? 'Эксперт' : 'Лид')}
            </span>
          </div>
        </div>

        <!-- Scrollable Screen Content -->
        <div class="flex-1 overflow-y-auto px-4 py-4 space-y-4" id="tma-scrollable-body">
          ${roleContentHtml}
        </div>

        <!-- Telegram Bottom Navigation -->
        ${renderBottomNav(state)}
      </div>
    </main>

    <!-- Global Modals container -->
    <div id="modal-container"></div>
  `;

  // Initialize Lucide icons
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // Trigger charts if elements exist
  setTimeout(() => {
    initCharts(state);
  }, 50);
}

// -------------------------------------------------------------
// MARKETER VIEW
// -------------------------------------------------------------
function renderMarketerView(state) {
  const marketer = state.marketer;
  const currentFunnel = state.funnels.find(f => f.id === state.currentFunnelId) || state.funnels[0];
  const activeSubTab = state.marketerSubTab || 'funnels';

  return `
    <!-- Marketer Header Overview -->
    <div class="glass-card p-4 bg-gradient-to-br from-slate-900/90 to-sky-950/40 border-sky-500/20">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-3">
          <img src="${marketer.avatar}" class="w-12 h-12 rounded-2xl object-cover border-2 border-sky-500/40" />
          <div>
            <div class="font-bold text-sm text-white">${marketer.name}</div>
            <div class="text-xs text-sky-400">${marketer.title}</div>
            <div class="text-[11px] text-slate-400">${marketer.bio}</div>
          </div>
        </div>
      </div>

      <!-- Financial Metrics & Subscription Revenue -->
      <div class="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/80 text-center">
        <div class="p-2 rounded-xl bg-slate-800/50">
          <div class="text-[10px] text-slate-400">MRR с подписок</div>
          <div class="text-xs font-bold text-emerald-400">${formatMoney(marketer.mrr)}</div>
        </div>
        <div class="p-2 rounded-xl bg-slate-800/50">
          <div class="text-[10px] text-slate-400">Экспертов на связи</div>
          <div class="text-xs font-bold text-white">${marketer.activeSubscribersCount} чел.</div>
        </div>
        <div class="p-2 rounded-xl bg-slate-800/50">
          <div class="text-[10px] text-slate-400">Автосписание</div>
          <div class="text-xs font-bold text-sky-400">${marketer.bankCard}</div>
        </div>
      </div>
    </div>

    <!-- Marketer Sub Navigation -->
    <div class="flex items-center gap-1.5 bg-slate-850 p-1 rounded-xl border border-slate-800 text-xs">
      <button onclick="window.setMarketerSubTab('funnels')" class="flex-1 py-1.5 rounded-lg font-medium transition text-center ${activeSubTab === 'funnels' ? 'bg-sky-500 text-white shadow' : 'text-slate-400 hover:text-white'}">
        Воронки (${state.funnels.length})
      </button>
      <button onclick="window.setMarketerSubTab('subscribers')" class="flex-1 py-1.5 rounded-lg font-medium transition text-center ${activeSubTab === 'subscribers' ? 'bg-sky-500 text-white shadow' : 'text-slate-400 hover:text-white'}">
        Подписки & Ретеншн
      </button>
      <button onclick="window.setMarketerSubTab('ai_clone')" class="flex-1 py-1.5 rounded-lg font-medium transition text-center ${activeSubTab === 'ai_clone' ? 'bg-sky-500 text-white shadow' : 'text-slate-400 hover:text-white'}">
        AI-Клон
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
          <button onclick="window.selectFunnel('${f.id}')" class="px-3 py-1.5 rounded-xl text-xs whitespace-nowrap transition border ${f.id === funnel.id ? 'bg-sky-500/20 border-sky-400 text-sky-300 font-bold' : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-slate-200'}">
            ${f.title.split(':')[0]}
          </button>
        `).join('')}
      </div>
      <button onclick="window.openCreateFunnelModal()" class="px-2.5 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold flex items-center gap-1 shadow">
        <i data-lucide="plus" class="w-3.5 h-3.5"></i>
        <span>Создать</span>
      </button>
    </div>

    <!-- Active Funnel Header & Subscription Pricing -->
    <div class="glass-card p-4 relative overflow-hidden">
      <div class="flex items-start justify-between gap-2 mb-2">
        <div>
          <span class="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 mb-1">
            ${funnel.badge}
          </span>
          <h2 class="text-sm font-bold text-white leading-snug">${funnel.title}</h2>
          <div class="text-xs text-sky-400 mt-0.5">${funnel.niche}</div>
        </div>
        <div class="text-right">
          <div class="text-[10px] text-slate-400">Тариф подписки</div>
          <div class="text-sm font-bold text-emerald-400">${formatMoney(funnel.monthlyPrice)} <span class="text-[10px] font-normal text-slate-400">/мес</span></div>
          <div class="text-[10px] text-slate-400">Списание с карты</div>
        </div>
      </div>
      <p class="text-xs text-slate-300 leading-relaxed mb-3">${funnel.description}</p>
    </div>

    <!-- Aggregated Funnel Analytics (WITHOUT Clients Personal Info) -->
    <div class="glass-card p-4">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <i data-lucide="bar-chart-3" class="w-4 h-4 text-sky-400"></i>
          <span class="text-xs font-bold text-white uppercase tracking-wider">Результаты воронки</span>
        </div>
        <span class="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          Без персональных данных клиентов
        </span>
      </div>

      <div class="grid grid-cols-2 gap-2 mb-3">
        <div class="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
          <div class="text-[10px] text-slate-400">Выручка экспертов</div>
          <div class="text-sm font-extrabold text-emerald-400">${funnel.analytics.totalExpertsRevenue}</div>
          <div class="text-[10px] text-slate-500 mt-0.5">Суммарно по всем экспертам</div>
        </div>
        <div class="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
          <div class="text-[10px] text-slate-400">Средняя конверсия (CR)</div>
          <div class="text-sm font-extrabold text-sky-400">${funnel.analytics.avgFunnelConversion}</div>
          <div class="text-[10px] text-slate-500 mt-0.5">Средний чек: ${funnel.analytics.avgDealCheck}</div>
        </div>
      </div>

      <!-- Funnel Stage Drop-offs list -->
      <div class="space-y-1.5 mb-2">
        <div class="text-[11px] font-semibold text-slate-300">Доходимость по этапам (Агрегировано):</div>
        ${funnel.analytics.stepDropOffs.map(s => `
          <div class="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-900/60 border border-slate-800">
            <span class="text-slate-300 font-medium">${s.step}</span>
            <div class="flex items-center gap-2">
              <span class="text-slate-400 text-[11px]">${s.passed} лидов</span>
              <span class="font-bold text-sky-400">${s.cr}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Funnel Structure (Critical requirement) -->
    <div class="glass-card p-4">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <i data-lucide="git-merge" class="w-4 h-4 text-amber-400"></i>
          <span class="text-xs font-bold text-white uppercase tracking-wider">Структура воронки маркетолога</span>
        </div>
        <span class="text-[10px] text-amber-300 font-semibold">${funnel.steps.length} этапов</span>
      </div>

      <div class="space-y-2.5">
        ${funnel.steps.map(step => `
          <div class="p-3 rounded-xl bg-slate-800/80 border border-slate-700/70 hover:border-sky-500/40 transition">
            <div class="flex items-center justify-between mb-1">
              <div class="flex items-center gap-2">
                <span class="w-5 h-5 rounded-full bg-sky-500/20 text-sky-400 text-xs font-bold flex items-center justify-center">
                  ${step.number}
                </span>
                <span class="font-bold text-xs text-white">${step.name}</span>
              </div>
              <span class="text-[10px] text-emerald-400 font-semibold">CR: ${step.conversionRate}</span>
            </div>
            <div class="text-xs text-slate-300 mb-1.5"><strong class="text-slate-400">Цель:</strong> ${step.goal}</div>
            <div class="text-[11px] text-sky-300/80 bg-slate-900/70 p-2 rounded-lg border border-slate-800">
              <strong class="text-sky-400">Логика AI-продавца:</strong> ${step.aiPrompt}
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- AI Analyzer Recommendations for Marketer -->
    <div class="glass-card p-4 border-indigo-500/30 bg-gradient-to-b from-slate-900/90 to-indigo-950/20">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <i data-lucide="sparkles" class="w-4 h-4 text-indigo-400"></i>
          <span class="text-xs font-bold text-white uppercase tracking-wider">Рекомендации AI-Анализатора</span>
        </div>
        <span class="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
          Узкие горлышки
        </span>
      </div>

      <div class="space-y-2.5">
        ${funnel.analyzerRecommendations.map(rec => `
          <div class="p-3 rounded-xl bg-slate-800/80 border border-slate-700/80">
            <div class="flex items-center gap-1.5 mb-1">
              <span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${rec.urgency === 'high' ? 'bg-rose-500/20 text-rose-400' : 'bg-amber-500/20 text-amber-300'}">
                ${rec.urgency === 'high' ? 'Критично' : 'Точка роста'}
              </span>
              <span class="text-xs font-bold text-white">${rec.title}</span>
            </div>
            <p class="text-xs text-slate-400 mb-1.5">${rec.observation}</p>
            <div class="text-xs text-emerald-300 bg-emerald-950/30 p-2 rounded-lg border border-emerald-800/40">
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
    <div class="glass-card p-4">
      <div class="flex items-center justify-between mb-3">
        <div>
          <h2 class="text-xs font-bold text-white uppercase tracking-wider">Эксперты по подписке</h2>
          <div class="text-[11px] text-slate-400">Ежемесячное списание: ${formatMoney(funnel.monthlyPrice)} / эксперт</div>
        </div>
        <span class="px-2 py-1 rounded-xl bg-emerald-500/20 text-emerald-300 text-xs font-bold">
          ${funnel.subscribers.length} активных
        </span>
      </div>

      <!-- Subscribers list (WITHOUT client personal data!) -->
      <div class="space-y-2.5">
        ${funnel.subscribers.map(sub => `
          <div class="p-3 rounded-xl bg-slate-800/80 border border-slate-700/80">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2.5">
                <img src="${sub.avatar}" class="w-9 h-9 rounded-xl object-cover border border-slate-700" />
                <div>
                  <div class="text-xs font-bold text-white flex items-center gap-1.5">
                    ${sub.name}
                    <span class="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400">Активна</span>
                  </div>
                  <div class="text-[10px] text-slate-400">${sub.niche} • С ${sub.joinDate}</div>
                </div>
              </div>
              <div class="text-right">
                <div class="text-[10px] text-slate-400">Списание: карта</div>
                <div class="text-xs font-mono font-bold text-slate-300">•••• ${sub.cardLast4}</div>
              </div>
            </div>

            <!-- Aggregated results of this expert (Without expert's client personal data) -->
            <div class="grid grid-cols-3 gap-1.5 pt-2 border-t border-slate-700/60 text-center">
              <div class="p-1.5 rounded-lg bg-slate-900/60">
                <div class="text-[9px] text-slate-400">Лидов обработано</div>
                <div class="text-xs font-bold text-white">${sub.leadsProcessed}</div>
              </div>
              <div class="p-1.5 rounded-lg bg-slate-900/60">
                <div class="text-[9px] text-slate-400">Сделок закрыто</div>
                <div class="text-xs font-bold text-sky-400">${sub.closedDeals} (${sub.crOverall})</div>
              </div>
              <div class="p-1.5 rounded-lg bg-slate-900/60">
                <div class="text-[9px] text-slate-400">Выручка эксперта</div>
                <div class="text-xs font-bold text-emerald-400">${sub.revenueGenerated}</div>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Cohort Retention Matrix -->
    <div class="glass-card p-4">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-xs font-bold text-white uppercase tracking-wider">Когортный Ретеншн (Retention)</h2>
        <span class="text-[10px] text-sky-400 font-semibold">Churn: ${funnel.cohortRetention.churnRate} • LTV: ${funnel.cohortRetention.avgLtv}</span>
      </div>
      <p class="text-[11px] text-slate-400 mb-3">Показывает, сколько месяцев эксперты остаются на ежемесячной подписке бота.</p>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-[11px] border-collapse">
          <thead>
            <tr class="border-b border-slate-800 text-slate-400">
              <th class="py-1.5 px-2">Когорта</th>
              <th class="py-1.5 px-1">Эксперты</th>
              <th class="py-1.5 px-1 text-center">M1</th>
              <th class="py-1.5 px-1 text-center">M2</th>
              <th class="py-1.5 px-1 text-center">M3</th>
              <th class="py-1.5 px-1 text-center">M4</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800/60">
            ${funnel.cohortRetention.cohorts.map(c => `
              <tr>
                <td class="py-1.5 px-2 font-medium text-slate-300">${c.month}</td>
                <td class="py-1.5 px-1 text-slate-400">${c.users}</td>
                <td class="py-1.5 px-1 text-center text-emerald-400 font-bold bg-emerald-500/10 rounded">${c.m1}</td>
                <td class="py-1.5 px-1 text-center ${c.m2 !== '-' ? 'text-emerald-400 font-bold bg-emerald-500/10' : 'text-slate-600'} rounded">${c.m2}</td>
                <td class="py-1.5 px-1 text-center ${c.m3 !== '-' ? 'text-emerald-400 font-bold bg-emerald-500/10' : 'text-slate-600'} rounded">${c.m3}</td>
                <td class="py-1.5 px-1 text-center ${c.m4 !== '-' ? 'text-emerald-400 font-bold bg-emerald-500/10' : 'text-slate-600'} rounded">${c.m4}</td>
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
    <div class="glass-card p-4 space-y-3">
      <div class="flex items-center gap-2 mb-1">
        <i data-lucide="bot" class="w-5 h-5 text-sky-400"></i>
        <h2 class="text-xs font-bold text-white uppercase tracking-wider">Клонирование маркетолога (AI Clone)</h2>
      </div>
      <p class="text-xs text-slate-300">
        Маркетолог клонирует свои компетенции: загружает правила кастдева, триггеры продаж и формулировки офферов для экспертов.
      </p>

      <div class="p-3 rounded-xl bg-slate-800/80 border border-slate-700/80 space-y-2">
        <label class="text-[11px] font-bold text-slate-300 block">Психотип & Характер клона маркетолога:</label>
        <input type="text" value="${funnel.aiClone.personality}" class="w-full text-xs p-2 rounded-lg bg-slate-900 border border-slate-700 text-white" />
      </div>

      <div class="p-3 rounded-xl bg-slate-800/80 border border-slate-700/80 space-y-2">
        <label class="text-[11px] font-bold text-slate-300 block">База знаний & Материалы воронки:</label>
        <div class="space-y-1.5">
          ${funnel.aiClone.knowledgeBase.map((kb, idx) => `
            <div class="flex items-center gap-2 text-xs p-2 rounded-lg bg-slate-900/80 border border-slate-800 text-slate-300">
              <span class="w-4 h-4 rounded-full bg-sky-500/20 text-sky-400 text-[10px] flex items-center justify-center font-bold">${idx + 1}</span>
              <span class="flex-1">${kb}</span>
            </div>
          `).join('')}
        </div>
        <button onclick="window.addKnowledgeBaseItem()" class="w-full mt-2 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-sky-400 border border-dashed border-sky-500/30 flex items-center justify-center gap-1.5 transition">
          <i data-lucide="upload-cloud" class="w-3.5 h-3.5"></i>
          <span>Загрузить новый материал / методичку</span>
        </button>
      </div>
    </div>
  `;
}

// -------------------------------------------------------------
// EXPERT VIEW (The 3 Windows required by User Request + PMF)
// -------------------------------------------------------------
function renderExpertView(state) {
  const expert = state.expert;
  const activeTab = state.expertTab || 'chats'; // 'chats' | 'analytics' | 'recommendations' | 'pmf'

  return `
    <!-- Expert Profile Header & Subscription Status -->
    <div class="glass-card p-4 bg-gradient-to-br from-slate-900/90 to-indigo-950/40 border-indigo-500/20">
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-3">
          <img src="${expert.avatar}" class="w-12 h-12 rounded-2xl object-cover border-2 border-indigo-500/40" />
          <div>
            <div class="font-bold text-sm text-white">${expert.name}</div>
            <div class="text-xs text-indigo-400">${expert.title}</div>
            <div class="text-[10px] text-slate-400">${expert.niche}</div>
          </div>
        </div>
        <div class="text-right">
          <span class="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Подписка активна
          </span>
          <div class="text-[10px] text-slate-400 mt-1">Списание: ${formatMoney(expert.subscriptionPrice)}/мес (карта •••• ${expert.cardLast4})</div>
        </div>
      </div>

      <!-- Quick AI Seller Link Bar -->
      <div class="mt-3 p-2.5 rounded-xl bg-slate-900/80 border border-indigo-500/30 flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 overflow-hidden">
          <i data-lucide="link-2" class="w-4 h-4 text-sky-400 flex-shrink-0"></i>
          <span class="text-xs font-mono text-sky-300 truncate">${expert.sellerLink}</span>
        </div>
        <div class="flex items-center gap-1">
          <button onclick="window.copySellerLink('${expert.sellerLink}')" class="px-2 py-1 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-[11px] font-semibold flex items-center gap-1 shadow">
            <i data-lucide="copy" class="w-3 h-3"></i>
            <span>Копировать</span>
          </button>
          <button onclick="window.openQrModal('${expert.sellerLink}')" class="p-1 rounded-lg bg-slate-800 text-slate-300 hover:text-white" title="QR-код">
            <i data-lucide="qr-code" class="w-4 h-4"></i>
          </button>
        </div>
      </div>
    </div>

    <!-- The 3 Core Windows Switcher (As explicitly requested in Prompt) -->
    <div class="grid grid-cols-4 gap-1 bg-slate-850 p-1 rounded-2xl border border-slate-800 text-xs">
      <button onclick="window.setExpertTab('chats')" class="py-2 px-1 rounded-xl font-medium transition text-center flex flex-col items-center gap-1 ${activeTab === 'chats' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}">
        <i data-lucide="messages-square" class="w-4 h-4"></i>
        <span class="text-[10px]">1. Переписки</span>
      </button>

      <button onclick="window.setExpertTab('analytics')" class="py-2 px-1 rounded-xl font-medium transition text-center flex flex-col items-center gap-1 ${activeTab === 'analytics' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}">
        <i data-lucide="trending-up" class="w-4 h-4"></i>
        <span class="text-[10px]">2. Аналитика</span>
      </button>

      <button onclick="window.setExpertTab('recommendations')" class="py-2 px-1 rounded-xl font-medium transition text-center flex flex-col items-center gap-1 ${activeTab === 'recommendations' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}">
        <i data-lucide="lightbulb" class="w-4 h-4"></i>
        <span class="text-[10px]">3. Советы ИИ</span>
      </button>

      <button onclick="window.setExpertTab('pmf')" class="py-2 px-1 rounded-xl font-medium transition text-center flex flex-col items-center gap-1 ${activeTab === 'pmf' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}">
        <i data-lucide="sparkle" class="w-4 h-4"></i>
        <span class="text-[10px]">PMF Опрос</span>
      </button>
    </div>

    <!-- Content for the chosen Window -->
    ${activeTab === 'chats' ? renderExpertChatsWindow(state) : ''}
    ${activeTab === 'analytics' ? renderExpertAnalyticsWindow(state) : ''}
    ${activeTab === 'recommendations' ? renderExpertRecommendationsWindow(state) : ''}
    ${activeTab === 'pmf' ? renderExpertPmfWindow(state) : ''}
  `;
}

// Window 1: All Client Dialogues / Live CRM
function renderExpertChatsWindow(state) {
  const expert = state.expert;
  const selectedChat = expert.chats.find(c => c.id === state.selectedExpertChatId) || expert.chats[0];

  return `
    <div class="space-y-3">
      <!-- Chat filter header -->
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
          <i data-lucide="message-circle" class="w-4 h-4 text-indigo-400"></i>
          Диалоги ИИ-продавца с лидами
        </span>
        <span class="text-[11px] text-slate-400">${expert.chats.length} активных</span>
      </div>

      <!-- Chats List Horizontal Carousel -->
      <div class="flex gap-2 overflow-x-auto pb-1">
        ${expert.chats.map(chat => `
          <div onclick="window.selectExpertChat('${chat.id}')" class="flex-shrink-0 w-44 p-2.5 rounded-xl border cursor-pointer transition ${chat.id === selectedChat.id ? 'bg-indigo-950/60 border-indigo-400 shadow-md' : 'bg-slate-800/80 border-slate-700/80 hover:border-slate-600'}">
            <div class="flex items-center justify-between mb-1">
              <div class="flex items-center gap-1.5">
                <img src="${chat.leadAvatar}" class="w-6 h-6 rounded-full object-cover" />
                <span class="text-xs font-bold text-white truncate max-w-[85px]">${chat.leadName}</span>
              </div>
              <span class="text-[9px] text-slate-400">${chat.lastMessageTime}</span>
            </div>
            <div class="text-[10px] font-semibold mb-1 ${chat.status === 'hot' ? 'text-rose-400' : (chat.status === 'closed' ? 'text-emerald-400' : 'text-amber-400')}">
              ${chat.statusLabel}
            </div>
            <div class="text-[10px] text-slate-400 truncate">${chat.dealValue} • ${chat.summary}</div>
          </div>
        `).join('')}
      </div>

      <!-- Active Selected Chat View & Human Takeover -->
      <div class="glass-card p-3 rounded-2xl flex flex-col space-y-2 border-indigo-500/30">
        <!-- Lead header -->
        <div class="flex items-center justify-between pb-2 border-b border-slate-800">
          <div class="flex items-center gap-2">
            <img src="${selectedChat.leadAvatar}" class="w-8 h-8 rounded-full object-cover" />
            <div>
              <div class="text-xs font-bold text-white flex items-center gap-1.5">
                ${selectedChat.leadName}
                <span class="text-[10px] text-sky-400 font-mono">${selectedChat.leadUsername}</span>
              </div>
              <div class="text-[10px] text-slate-400">${selectedChat.summary}</div>
            </div>
          </div>
          <div class="text-right">
            <span class="text-xs font-bold text-emerald-400">${selectedChat.dealValue}</span>
            <div class="text-[9px] text-slate-400">${selectedChat.statusLabel}</div>
          </div>
        </div>

        <!-- Chat history between Lead & AI/Expert -->
        <div class="space-y-2 max-h-72 overflow-y-auto py-2 pr-1" id="expert-chat-scroll">
          ${selectedChat.messages.map(msg => `
            <div class="flex flex-col ${msg.sender === 'lead' ? 'items-start' : 'items-end'}">
              <div class="text-[9px] text-slate-500 mb-0.5 px-1">
                ${msg.sender === 'lead' ? selectedChat.leadName : (msg.sender === 'expert_human' ? '👤 Елена (Лично)' : '🤖 ИИ-Продавец')} • ${msg.time}
              </div>
              <div class="${msg.sender === 'lead' ? 'chat-bubble-ai bg-slate-800' : (msg.sender === 'expert_human' ? 'chat-bubble-expert' : 'chat-bubble-user bg-indigo-600')} text-xs">
                ${msg.text}
              </div>
            </div>
          `).join('')}
        </div>

        <!-- Human Takeover Box (Эксперт может лично вмешаться в диалог) -->
        <div class="pt-2 border-t border-slate-800">
          <div class="text-[11px] font-semibold text-emerald-400 flex items-center gap-1 mb-1.5">
            <i data-lucide="user-check" class="w-3.5 h-3.5"></i>
            <span>Вмешаться человеку (Отправить от имени Елены):</span>
          </div>
          <form onsubmit="window.handleExpertTakeover(event, '${selectedChat.id}')" class="flex gap-2">
            <input type="text" id="expert-takeover-input" placeholder="Напишите личное сообщение клиенту..." class="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500" />
            <button type="submit" class="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1">
              <i data-lucide="send" class="w-3.5 h-3.5"></i>
              <span>Ответить</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  `;
}

// Window 2: Analytics & Conversion (Key figures)
function renderExpertAnalyticsWindow(state) {
  const an = state.expert.analytics;

  return `
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
          <i data-lucide="pie-chart" class="w-4 h-4 text-indigo-400"></i>
          Главная аналитика & Конверсии
        </span>
        <span class="text-[10px] text-slate-400">${an.period}</span>
      </div>

      <!-- Top KPI Grid -->
      <div class="grid grid-cols-2 gap-2">
        <div class="glass-card p-3 border-emerald-500/30">
          <div class="text-[10px] text-slate-400">Выручка через ИИ-продавца</div>
          <div class="text-base font-extrabold text-emerald-400">${an.revenue}</div>
          <div class="text-[10px] text-slate-500 mt-0.5">Средний чек: ${an.avgCheck}</div>
        </div>

        <div class="glass-card p-3 border-sky-500/30">
          <div class="text-[10px] text-slate-400">Конверсия в оплату / созвон</div>
          <div class="text-base font-extrabold text-sky-400">${an.overallConversion}</div>
          <div class="text-[10px] text-slate-500 mt-0.5">Сделок: ${an.dealsClosed} шт.</div>
        </div>
      </div>

      <!-- Additional KPI Stats -->
      <div class="grid grid-cols-3 gap-2 text-center">
        <div class="p-2 rounded-xl bg-slate-800/60 border border-slate-700/60">
          <div class="text-[10px] text-slate-400">Трафик / Гости</div>
          <div class="text-xs font-bold text-white">${an.trafficVisitors} чел.</div>
        </div>
        <div class="p-2 rounded-xl bg-slate-800/60 border border-slate-700/60">
          <div class="text-[10px] text-slate-400">Квалифицированы</div>
          <div class="text-xs font-bold text-indigo-400">${an.qualifiedLeads} чел.</div>
        </div>
        <div class="p-2 rounded-xl bg-slate-800/60 border border-slate-700/60">
          <div class="text-[10px] text-slate-400">Сэкономлено часов</div>
          <div class="text-xs font-bold text-amber-400">${an.aiSellerSavedHours} ч.</div>
        </div>
      </div>

      <!-- Funnel Progress Stages -->
      <div class="glass-card p-3 space-y-2">
        <div class="text-[11px] font-bold text-slate-200">Доходимость по шагам воронки эксперта:</div>
        <div class="space-y-1.5">
          ${an.steps.map((st, i) => `
            <div>
              <div class="flex justify-between text-xs mb-1">
                <span class="text-slate-300 font-medium">${i + 1}. ${st.title}</span>
                <span class="text-sky-400 font-bold">${st.count} (${st.percent})</span>
              </div>
              <div class="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
                <div class="bg-gradient-to-r from-indigo-500 to-sky-400 h-2 rounded-full" style="width: ${st.percent}"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

// Window 3: AI-Marketer Recommendations for Expert
function renderExpertRecommendationsWindow(state) {
  const recs = state.expert.aiMarketerRecommendations;

  return `
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
          <i data-lucide="sparkles" class="w-4 h-4 text-amber-400"></i>
          Рекомендации от ИИ-Маркетолога
        </span>
        <span class="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold">
          На основе отчетов
        </span>
      </div>
      <p class="text-xs text-slate-300">
        ИИ-маркетолог анализирует реальные переписки, точки слива лидов и дает эксперту рекомендации по докрутке оффера и продаж.
      </p>

      <div class="space-y-2.5">
        ${recs.map(rec => `
          <div class="p-3.5 rounded-2xl bg-slate-800/80 border ${rec.applied ? 'border-emerald-500/30 bg-emerald-950/10' : 'border-slate-700/80'}">
            <div class="flex items-start justify-between gap-2 mb-1.5">
              <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                ${rec.tag} • ${rec.impact}
              </span>
              ${rec.applied ? `
                <span class="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                  <i data-lucide="check-circle" class="w-3.5 h-3.5"></i> Внедрено
                </span>
              ` : ''}
            </div>

            <h3 class="text-xs font-bold text-white mb-1">${rec.title}</h3>
            <p class="text-xs text-slate-300 leading-relaxed mb-3">${rec.reason}</p>

            ${!rec.applied ? `
              <button onclick="window.applyExpertRecommendation('${rec.id}')" class="w-full py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-500 hover:to-sky-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-md">
                <i data-lucide="zap" class="w-3.5 h-3.5"></i>
                <span>Применить в аргументы ИИ-продавца</span>
              </button>
            ` : `
              <div class="text-[11px] text-emerald-400/90 bg-emerald-950/40 p-2 rounded-xl border border-emerald-800/40 flex items-center gap-1.5">
                <i data-lucide="check" class="w-3.5 h-3.5"></i>
                <span>Инструкции ИИ-продавца обновлены. Аргумент активен в чатах!</span>
              </div>
            `}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// Window PMF: Interview with AI-Marketer & Product-Market Fit Calibration
function renderExpertPmfWindow(state) {
  const pmf = state.expert.pmfInterview;
  const customButtons = state.expert.customButtons;

  return `
    <div class="space-y-3">
      <!-- PMF Score Header -->
      <div class="glass-card p-4 bg-gradient-to-br from-indigo-950/60 to-purple-950/40 border-purple-500/30">
        <div class="flex items-center justify-between mb-2">
          <div>
            <div class="text-[10px] text-purple-300 uppercase tracking-wider font-bold">Product-Market Fit Индекс</div>
            <div class="text-lg font-extrabold text-white flex items-center gap-2">
              <span>${pmf.pmfScore}%</span>
              <span class="text-xs font-medium text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30">Готов к продажам</span>
            </div>
          </div>
          <div class="w-12 h-12 rounded-2xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300 font-bold text-lg">
            ⚡
          </div>
        </div>
        <p class="text-xs text-slate-300 leading-relaxed">
          ИИ-маркетолог задал вопросы эксперту, упаковал сильные стороны, гарантии и кейсы, чтобы ИИ-продавец закрывал любые возражения лида.
        </p>
      </div>

      <!-- Question & Answer list from AI-Marketer -->
      <div class="glass-card p-3 space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-white uppercase tracking-wider">Распакованные материалы</span>
          <span class="text-[10px] text-slate-400">Обновлено: ${pmf.lastUpdated}</span>
        </div>

        <div class="space-y-2.5">
          ${pmf.questionsAndAnswers.map(qa => `
            <div class="p-3 rounded-xl bg-slate-800/80 border border-slate-700/80 space-y-1.5">
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-bold text-indigo-400 uppercase">${qa.category}</span>
                <button onclick="window.editPmfAnswer('${qa.id}')" class="text-[10px] text-sky-400 hover:text-sky-300 flex items-center gap-1">
                  <i data-lucide="edit-3" class="w-3 h-3"></i> Изменить
                </button>
              </div>
              <div class="text-xs font-bold text-white">${qa.question}</div>
              <div class="text-xs text-slate-300 bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 leading-relaxed">
                ${qa.answer}
              </div>
            </div>
          `).join('')}
        </div>

        <button onclick="window.askAnotherPmfQuestion()" class="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-indigo-300 border border-dashed border-indigo-500/30 flex items-center justify-center gap-1.5 transition">
          <i data-lucide="message-circle-plus" class="w-4 h-4"></i>
          <span>Добавить дополнительный ответ / кейс для ИИ</span>
        </button>
      </div>

      <!-- Custom Buttons Configuration -->
      <div class="glass-card p-3 space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-white uppercase tracking-wider">Кнопки действий для клиентов</span>
          <span class="text-[10px] text-slate-400">Отображаются у лида</span>
        </div>
        <p class="text-[11px] text-slate-400">
          Кнопки, которые маркетолог или сам эксперт настроили в Telegram-боте для быстрого перехода:
        </p>

        <div class="space-y-1.5">
          ${customButtons.map(btn => `
            <div class="flex items-center justify-between p-2 rounded-xl bg-slate-800/80 border border-slate-700 text-xs">
              <span class="text-slate-200 font-medium">${btn.label}</span>
              <span class="text-[10px] font-mono text-slate-400 px-2 py-0.5 bg-slate-900 rounded">${btn.action}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

// -------------------------------------------------------------
// CLIENT / LEAD VIEW (End User Chat with AI Seller)
// -------------------------------------------------------------
function renderClientView(state) {
  const session = state.clientSession;

  return `
    <div class="flex flex-col h-full space-y-3">
      <!-- AI Seller Profile Bar -->
      <div class="glass-card p-3 bg-gradient-to-r from-slate-900 to-indigo-950/60 border-slate-700 flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <div class="relative">
            <img src="${session.expertAvatar}" class="w-10 h-10 rounded-full object-cover border-2 border-emerald-400" />
            <span class="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-slate-900"></span>
          </div>
          <div>
            <div class="text-xs font-bold text-white flex items-center gap-1">
              <span>ИИ-Продавец: ${session.expertName}</span>
            </div>
            <div class="text-[10px] text-emerald-400">Онлайн • Готов разобрать вашу задачу</div>
          </div>
        </div>

        <!-- Human contact button (Direct requirement from user) -->
        <button onclick="window.triggerHumanContact()" class="px-2.5 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[11px] font-semibold flex items-center gap-1 shadow transition">
          <i data-lucide="user" class="w-3.5 h-3.5"></i>
          <span>Связаться с человеком</span>
        </button>
      </div>

      <!-- Quick Action Buttons configured by Expert & Marketer -->
      <div class="flex gap-1.5 overflow-x-auto pb-1 text-xs">
        <button onclick="window.sendPredefinedMessage('Хочу записаться на диагностическую сессию к Елене')" class="px-2.5 py-1.5 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-200 whitespace-nowrap font-medium transition">
          📅 Записаться на разбор
        </button>
        <button onclick="window.sendPredefinedMessage('Покажите кейсы и отзывы ваших клиентов')" class="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 whitespace-nowrap font-medium transition">
          🏆 Кейсы и отзывы
        </button>
        <button onclick="window.sendPredefinedMessage('Сколько стоит работа с Еленой и какие форматы?')" class="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 whitespace-nowrap font-medium transition">
          💰 Стоимость и тарифы
        </button>
      </div>

      <!-- Live Interactive Chat Window -->
      <div class="glass-card p-3 flex-1 flex flex-col space-y-2.5 min-h-[350px] max-h-[460px] overflow-y-auto" id="client-chat-scroll">
        ${session.messages.map(msg => `
          <div class="flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'} space-y-1">
            <div class="${msg.sender === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai'}">
              ${formatChatMarkdown(msg.text)}
            </div>

            <!-- Quick Replies Chips -->
            ${msg.quickReplies && msg.quickReplies.length ? `
              <div class="flex flex-wrap gap-1.5 pt-1">
                ${msg.quickReplies.map(qr => `
                  <button onclick="window.sendPredefinedMessage('${escapeHtml(qr)}')" class="text-[11px] px-2.5 py-1 rounded-xl bg-sky-950/70 text-sky-300 hover:bg-sky-900 border border-sky-500/30 transition shadow-sm font-medium">
                    ${qr}
                  </button>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `).join('')}

        <!-- Typing indicator (hidden by default, shown during AI generation) -->
        <div id="ai-typing-indicator" class="hidden">
          <div class="typing-dots">
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
          </div>
        </div>
      </div>

      <!-- Objection Simulator Chips (Test common objections in 1-click) -->
      <div class="space-y-1">
        <div class="text-[10px] text-slate-400 font-medium flex items-center justify-between">
          <span>Быстрый тест закрытия возражений:</span>
          <button onclick="window.clearClientChat()" class="text-[10px] text-slate-500 hover:text-rose-400">Очистить чат</button>
        </div>
        <div class="flex flex-wrap gap-1">
          <button onclick="window.sendPredefinedMessage('180 тысяч — это слишком дорого для меня')" class="text-[10px] px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700">
            «Слишком дорого»
          </button>
          <button onclick="window.sendPredefinedMessage('У меня совершенно нет времени на коучинг')" class="text-[10px] px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700">
            «Нет времени»
          </button>
          <button onclick="window.sendPredefinedMessage('А какие гарантии, если у меня не получится?')" class="text-[10px] px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700">
            «Какие гарантии?»
          </button>
          <button onclick="window.sendPredefinedMessage('Хочу поговорить лично с экспертом')" class="text-[10px] px-2 py-0.5 rounded-lg bg-amber-950/40 text-amber-300 hover:bg-amber-900 border border-amber-600/30">
            «Связаться с человеком»
          </button>
        </div>
      </div>

      <!-- Chat input message box -->
      <form onsubmit="window.handleClientSendMessage(event)" class="flex items-center gap-2">
        <input type="text" id="client-chat-input" placeholder="Напишите вопрос или возражение..." class="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500" />
        <button type="submit" class="p-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white transition flex items-center justify-center shadow">
          <i data-lucide="send" class="w-4 h-4"></i>
        </button>
      </form>
    </div>
  `;
}

// -------------------------------------------------------------
// BOTTOM NAVIGATION
// -------------------------------------------------------------
function renderBottomNav(state) {
  const role = state.activeRole;

  return `
    <div class="tg-nav-bar flex items-center justify-around">
      <button onclick="window.switchRole('marketer')" class="tg-nav-item ${role === 'marketer' ? 'active' : ''}">
        <i data-lucide="layout-grid" class="w-4 h-4"></i>
        <span>Маркетолог</span>
      </button>

      <button onclick="window.switchRole('expert')" class="tg-nav-item ${role === 'expert' ? 'active' : ''}">
        <i data-lucide="user-check" class="w-4 h-4"></i>
        <span>Кабинет Эксперта</span>
      </button>

      <button onclick="window.switchRole('client')" class="tg-nav-item ${role === 'client' ? 'active' : ''}">
        <i data-lucide="bot" class="w-4 h-4"></i>
        <span>Лид / Чат ИИ</span>
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
  };

  window.toggleViewMode = () => {
    const cur = window.funnelStore.data.viewMode;
    window.funnelStore.setViewMode(cur === 'desktop-tma' ? 'fullscreen' : 'desktop-tma');
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
      <div class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onclick="window.closeModal()">
        <div class="glass-card max-w-xs w-full p-6 text-center space-y-4 border-sky-500/40" onclick="event.stopPropagation()">
          <h3 class="text-sm font-bold text-white">QR-код ИИ-продавца</h3>
          <div class="bg-white p-4 rounded-2xl mx-auto w-48 h-48 flex items-center justify-center shadow-lg">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(link)}" alt="QR Code" class="w-full h-full" />
          </div>
          <p class="text-xs text-slate-300">Распространяйте в соцсетях, Instagram и презентациях</p>
          <button onclick="window.closeModal()" class="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold">Закрыть</button>
        </div>
      </div>
    `;
  };

  window.closeModal = () => {
    const modal = document.getElementById('modal-container');
    if (modal) modal.innerHTML = '';
  };

  window.openCreateFunnelModal = () => {
    const modal = document.getElementById('modal-container');
    modal.innerHTML = `
      <div class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onclick="window.closeModal()">
        <div class="glass-card max-w-md w-full p-5 space-y-3 border-sky-500/40 max-h-[90vh] overflow-y-auto" onclick="event.stopPropagation()">
          <div class="flex items-center justify-between border-b border-slate-800 pb-2">
            <h3 class="text-sm font-bold text-white flex items-center gap-1.5">
              <i data-lucide="plus-circle" class="w-4 h-4 text-sky-400"></i>
              Создать новую воронку маркетолога
            </h3>
            <button onclick="window.closeModal()" class="text-slate-400 hover:text-white">&times;</button>
          </div>

          <form onsubmit="window.handleCreateFunnelSubmit(event)" class="space-y-3 text-xs">
            <div>
              <label class="block text-slate-300 font-medium mb-1">Название воронки:</label>
              <input type="text" id="fn-title" required placeholder="Напр: Воронка для нутрициологов и фитнес-тренеров" class="w-full p-2 bg-slate-900 border border-slate-700 rounded-lg text-white" />
            </div>

            <div>
              <label class="block text-slate-300 font-medium mb-1">Ниша экспертов:</label>
              <input type="text" id="fn-niche" required placeholder="Здоровье, фитнес, нутрициология" class="w-full p-2 bg-slate-900 border border-slate-700 rounded-lg text-white" />
            </div>

            <div>
              <label class="block text-slate-300 font-medium mb-1">Стоимость ежемесячной подписки для эксперта (₽/мес):</label>
              <input type="number" id="fn-price" required value="7900" class="w-full p-2 bg-slate-900 border border-slate-700 rounded-lg text-white" />
              <div class="text-[10px] text-slate-400 mt-0.5">Будет ежемесячно списываться с привязанной карты эксперта</div>
            </div>

            <div>
              <label class="block text-slate-300 font-medium mb-1">Детальная структура воронки (Ключевое требование):</label>
              <textarea id="fn-desc" rows="3" class="w-full p-2 bg-slate-900 border border-slate-700 rounded-lg text-white" placeholder="Опишите логику 5 шагов: Лид-магнит -> Квалификация -> Кейсы -> Оффер -> Закрытие на созвон"></textarea>
            </div>

            <div class="pt-2 flex gap-2">
              <button type="button" onclick="window.closeModal()" class="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl">Отмена</button>
              <button type="submit" class="flex-1 py-2 bg-sky-500 hover:bg-sky-400 text-white font-semibold rounded-xl shadow-lg">Создать и запустить</button>
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

    window.funnelStore.createFunnel({
      title,
      niche,
      monthlyPrice,
      description: desc
    });

    window.closeModal();
    showToast('Воронка успешно создана и готова к подключению экспертов!');
    if (window.confetti) {
      window.confetti({ particleCount: 70, spread: 60, origin: { y: 0.6 } });
    }
  };

  window.handleExpertTakeover = (e, chatId) => {
    e.preventDefault();
    const input = document.getElementById('expert-takeover-input');
    if (!input || !input.value.trim()) return;

    const val = input.value.trim();
    window.funnelStore.sendExpertMessageToLead(chatId, val);
    input.value = '';
    showToast('Сообщение отправлено лиду от имени эксперта 👤');

    setTimeout(() => {
      const scroll = document.getElementById('expert-chat-scroll');
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    }, 50);
  };

  window.applyExpertRecommendation = (recId) => {
    window.funnelStore.applyExpertRecommendation(recId);
    showToast('Рекомендация внедрена в логику ИИ-продавца 🚀');
    if (window.confetti) {
      window.confetti({ particleCount: 60, spread: 70 });
    }
  };

  window.editPmfAnswer = (qaId) => {
    const q = window.funnelStore.data.expert.pmfInterview.questionsAndAnswers.find(item => item.id === qaId);
    if (!q) return;

    const modal = document.getElementById('modal-container');
    modal.innerHTML = `
      <div class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onclick="window.closeModal()">
        <div class="glass-card max-w-md w-full p-5 space-y-3 border-indigo-500/40" onclick="event.stopPropagation()">
          <h3 class="text-sm font-bold text-white">${q.question}</h3>
          <textarea id="edit-pmf-text" rows="5" class="w-full text-xs p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white">${q.answer}</textarea>
          <div class="flex gap-2">
            <button onclick="window.closeModal()" class="flex-1 py-2 rounded-xl bg-slate-800 text-xs text-slate-300">Отмена</button>
            <button onclick="window.savePmfEdit('${qaId}')" class="flex-1 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white">Сохранить</button>
          </div>
        </div>
      </div>
    `;
  };

  window.savePmfEdit = (qaId) => {
    const val = document.getElementById('edit-pmf-text').value;
    window.funnelStore.updatePmfAnswer(qaId, val);
    window.closeModal();
    showToast('Аргумент обновлен! ИИ-продавец откалиброван.');
  };

  window.askAnotherPmfQuestion = () => {
    const q = prompt('Введите новый вопрос или тему кастдева (напр: "Какой бонус получает клиент при оплате сегодня?"):');
    if (q) {
      const a = prompt('Введите ваш ответ и аргументы для ИИ:');
      if (a) {
        window.funnelStore.addPmfQuestionAnswer(q, a, 'Дополнительный оффер');
        showToast('Новый аргумент сохранен в базу знаний ИИ!');
      }
    }
  };

  // Client Chat handlers
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
    showToast('Чат очищен до приветствия');
  };

  window.triggerHumanContact = () => {
    showToast('Елена получила уведомление! Открываем личный чат 👤');
    setTimeout(() => {
      alert('Запрос передан эксперту Елене Смирновой. В реальном боте откроется ссылка на Telegram-профиль @elena_coach.');
    }, 200);
  };

  window.resetDemoData = () => {
    if (confirm('Сбросить все воронки и переписки к исходным демо-данным?')) {
      window.funnelStore.resetToDefault();
      showToast('Данные сброшены!');
    }
  };
}

function executeClientChatExchange(userText) {
  window.funnelStore.sendClientMessage(userText);

  // Scroll to bottom
  const scroll = document.getElementById('client-chat-scroll');
  if (scroll) scroll.scrollTop = scroll.scrollHeight;

  // Show typing indicator
  const indicator = document.getElementById('ai-typing-indicator');
  if (indicator) indicator.classList.remove('hidden');

  setTimeout(() => {
    if (indicator) indicator.classList.add('hidden');
    const reply = window.aiEngine.generateSellerResponse(userText, window.funnelStore.data.clientSession.messages);
    window.funnelStore.addAiSellerReply(reply.text, reply.quickReplies);

    setTimeout(() => {
      const s = document.getElementById('client-chat-scroll');
      if (s) s.scrollTop = s.scrollHeight;
    }, 50);
  }, 900);
}

// Charts initialization
function initCharts(state) {
  // Can be extended with Chart.js canvas elements if present
}

// Helpers
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
  toast.className = 'fixed bottom-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-2xl bg-slate-800/95 border border-sky-500/40 text-white text-xs font-semibold shadow-2xl backdrop-blur-md flex items-center gap-2 transition-all transform animate-bounce';
  toast.innerHTML = `<span>✨</span><span>${msg}</span>`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 2800);
}
