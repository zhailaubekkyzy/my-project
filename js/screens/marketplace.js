// screens/marketplace.js - Marketplace of SI-consultants. The Office (business profile)
// opens inside this tab; its screens are in screens/office.js.

(function (window) {
  const SF = window.SF;

  const CATEGORIES = [
    { id: 'all', label: 'Все' },
    { id: 'sales', label: 'Продажи' },
    { id: 'warmup', label: 'Прогрев и заявки' }
  ];

  const shareLink = (id) => `https://t.me/smartflow_ai_support_bot/app?startapp=c_${id}`;

  function findConsultant(state, id) {
    return state.marketplace.consultants.find(c => c.id === id);
  }

  function stars(rating) {
    return `<span class="text-amber-400 font-bold">★ ${Number(rating).toFixed(1)}</span>`;
  }

  function trialLabel(c) {
    if (!c.price) return 'Бесплатно';
    return c.trialDays ? `Пробный период ${c.trialDays} дн.` : 'Без пробного периода';
  }

  // ---------------- List ----------------
  function officeEntry(state) {
    const me = state.me;
    if (me.business.active) {
      const waiting = state.expert.directHumanInquiries.filter(i => i.status === 'waiting').length;
      return `
        <button onclick="SF.push('office')" class="w-full glass-card-3d p-3.5 flex items-center gap-3 text-left border-[#81D8D0]">
          <span class="w-10 h-10 rounded-2xl bg-[#81D8D0]/20 flex items-center justify-center text-brand"><i data-lucide="briefcase" class="w-5 h-5"></i></span>
          <span class="flex-1">
            <span class="block text-sm font-bold text-ink">Мой Офис</span>
            <span class="block text-[11px] text-muted">SI-консультантов: ${state.office.consultants.length}${waiting ? ` · ждут ответа: ${waiting}` : ''}</span>
          </span>
          <i data-lucide="chevron-right" class="w-4 h-4 text-faint"></i>
        </button>`;
    }
    return `
      <button onclick="SF.push('office')" class="w-full hero-tiffany-banner p-4 text-left flex items-center gap-3">
        <img src="${SF.MASCOTS.consultant}" alt="" class="w-14 h-14 flex-shrink-0" />
        <span class="flex-1">
          <span class="block text-sm font-extrabold">Офис для бизнеса</span>
          <span class="block text-xs font-medium leading-snug">Свой SI-консультант продаёт ваши услуги 24/7. Откройте бизнес-профиль — это бесплатно.</span>
        </span>
      </button>`;
  }

  function card(c) {
    return `
      <button onclick="SF.push('consultant', { id: '${SF.js(c.id)}' })" class="w-full glass-card-3d p-3.5 text-left space-y-2">
        <div class="flex items-center gap-3">
          ${SF.avatar(c.photoUrl, { size: 44, kind: 'si' })}
          <div class="flex-1 min-w-0">
            <div class="text-sm font-bold text-ink truncate">${SF.esc(c.name)}</div>
            <div class="text-[11px]">${SF.siLabel(c.roleTitle)}</div>
          </div>
          <div class="text-right text-[11px]">
            ${stars(c.rating)}
            <div class="text-faint">${c.stats.dialogs} диалогов</div>
          </div>
        </div>
        <div class="text-xs font-semibold text-ink leading-snug">${SF.esc(c.offer)}</div>
        <div class="flex items-center justify-between text-[11px]">
          <span class="text-brand font-bold">${SF.esc(c.priceLabel)}</span>
          <span class="text-muted">${trialLabel(c)}</span>
        </div>
      </button>`;
  }

  function renderList(state) {
    const filter = state.ui.marketplaceFilter || 'all';
    const items = state.marketplace.consultants.filter(c => filter === 'all' || c.category === filter);
    return `
      ${officeEntry(state)}

      <div class="flex gap-1.5 overflow-x-auto pb-1">
        ${CATEGORIES.map(cat => `
          <button onclick="SF.actions.setMarketFilter('${cat.id}')" class="px-3 py-1.5 rounded-xl text-xs whitespace-nowrap border font-semibold ${filter === cat.id ? 'bg-[#81D8D0]/20 border-[#81D8D0] text-brand' : 'bg-card border-line text-muted'}">${cat.label}</button>
        `).join('')}
      </div>

      <div class="text-[11px] text-muted px-1">Подбор по конверсии, отзывам, удержанию и доверию к автору.</div>

      <div class="space-y-2.5">
        ${items.map(card).join('') || SF.emptyState('consultant', 'Пока пусто', 'В этой категории ещё нет SI-консультантов.')}
      </div>
    `;
  }

  // ---------------- Consultant card (top to bottom as in the structure document) ----------------
  function renderConsultant(route, state) {
    const c = findConsultant(state, route.id);
    if (!c) return SF.emptyState('assistant', 'Не нашёл консультанта', 'Возможно, автор снял его с витрины.');
    return `
      <div class="glass-card-3d p-4 space-y-3 border-[var(--si-bubble-line)]">
        <div class="flex items-center gap-3">
          ${SF.avatar(c.photoUrl, { size: 56, kind: 'si' })}
          <div class="min-w-0">
            <div class="text-base font-extrabold text-ink">${SF.esc(c.name)}</div>
            <div class="text-xs">${SF.siLabel(c.roleTitle)}</div>
          </div>
        </div>
        <!-- 1. Offer -->
        <div class="text-sm font-bold text-ink leading-snug">${SF.esc(c.offer)}</div>
        <!-- 2. Description -->
        <p class="text-xs text-ink-2 leading-relaxed">${SF.esc(c.description)}</p>
        <div class="flex flex-wrap gap-1.5 text-[10px] font-semibold">
          <span class="px-2 py-0.5 rounded-full bg-raised text-ink-2 border border-line">${c.category === 'sales' ? 'Продажи' : 'Прогрев и заявки'}</span>
          <span class="px-2 py-0.5 rounded-full bg-raised text-ink-2 border border-line">${trialLabel(c)}</span>
        </div>
      </div>

      <!-- 3. Results -->
      <div class="grid grid-cols-3 gap-2 text-center">
        ${[['Конверсия', c.stats.conversion], ['Диалогов', c.stats.dialogs], [c.category === 'sales' ? 'Продаж' : 'Целей', c.stats.sales]].map(([label, value]) => `
          <div class="p-2.5 rounded-xl bg-card border border-line">
            <div class="text-[10px] text-muted">${label}</div>
            <div class="text-sm font-extrabold text-ink">${value}</div>
          </div>`).join('')}
      </div>

      <!-- 4. Reviews (account names are masked) -->
      <div class="glass-card-3d p-3.5 space-y-2">
        ${SF.sectionTitle('message-square-heart', 'Отзывы', stars(c.rating))}
        ${c.reviews.map(r => `
          <div class="p-2.5 rounded-xl bg-sunken border border-line">
            <div class="flex items-center justify-between text-[11px]">
              <span class="font-bold text-ink">${SF.esc(r.author)}</span>
              <span class="text-amber-400">${'★'.repeat(r.stars)}</span>
            </div>
            <div class="text-xs text-ink-2 mt-0.5">${SF.esc(r.text)}</div>
          </div>`).join('')}
      </div>

      <!-- 5. Buttons -->
      <div class="grid grid-cols-2 gap-2">
        <button onclick="SF.actions.askConsultant('${SF.js(c.id)}')" class="py-3 rounded-2xl btn-3d-red text-sm flex items-center justify-center gap-1.5">
          <i data-lucide="message-circle" class="w-4 h-4"></i> Спросить
        </button>
        <button onclick="SF.actions.openBuy('${SF.js(c.id)}')" class="py-3 rounded-2xl btn-3d-tiffany text-sm flex items-center justify-center gap-1.5">
          <i data-lucide="shopping-bag" class="w-4 h-4"></i> ${c.price ? 'Купить' : 'Начать'}
        </button>
      </div>
      <button onclick="SF.copyText('${shareLink(c.id)}', 'Ссылка на карточку скопирована')" class="w-full py-2 rounded-xl btn-3d-dark text-xs flex items-center justify-center gap-1.5">
        <i data-lucide="share-2" class="w-3.5 h-3.5"></i> Поделиться карточкой
      </button>

      <!-- 6. Author -->
      <div class="glass-card-3d p-3 flex items-center gap-3">
        ${SF.avatar(null, { size: 36, kind: 'human' })}
        <div class="flex-1 min-w-0">
          <div class="text-[10px] text-muted uppercase tracking-wider">Автор</div>
          <div class="text-xs font-bold text-ink">${SF.esc(c.author.name)}</div>
        </div>
        <div class="w-24">
          <div class="text-[10px] text-muted text-right">Доверие ${c.author.trust}%</div>
          ${SF.progressBar(c.author.trust)}
        </div>
      </div>
    `;
  }

  // ---------------- Actions ----------------
  SF.actions.setMarketFilter = (filter) => {
    window.funnelStore.data.ui.marketplaceFilter = filter;
    window.funnelStore.notify();
  };

  SF.actions.askConsultant = (id) => {
    const c = findConsultant(window.funnelStore.data, id);
    if (!c) return;
    const chatId = window.funnelStore.openConsultantChat(c);
    SF.actions.openChat(chatId);
  };

  SF.actions.openBuy = (id) => {
    const state = window.funnelStore.data;
    const c = findConsultant(state, id);
    if (!c) return;
    let mainButton;
    if (c.isTemplate) {
      mainButton = `<button onclick="SF.actions.connectTemplate('${SF.js(c.id)}')" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm">Подключить к моему Офису</button>`;
    } else if (c.price && c.paymentUrl) {
      mainButton = `<button onclick="SF.openLink('${SF.js(c.paymentUrl)}')" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm">Перейти к оплате · ${SF.formatMoney(c.price)}</button>`;
    } else {
      mainButton = `<button onclick="SF.closeModal(); SF.actions.askConsultant('${SF.js(c.id)}')" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm">Начать бесплатно</button>`;
    }
    SF.openModal(`
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-bold text-ink">${SF.esc(c.name)}</h3>
        <button onclick="SF.closeModal()" class="text-muted text-lg leading-none" aria-label="Закрыть">&times;</button>
      </div>
      <div class="text-2xl font-extrabold text-ink">${SF.esc(c.priceLabel)}</div>
      <div class="text-[11px] text-muted">${trialLabel(c)}</div>
      <div class="space-y-1">
        <div class="text-[11px] font-bold text-ink uppercase tracking-wider">Что вы получите</div>
        ${c.benefits.map(b => `<div class="text-xs text-ink-2 flex gap-1.5"><span class="text-brand">✓</span>${SF.esc(b)}</div>`).join('')}
      </div>
      <div class="space-y-1">
        <div class="text-[11px] font-bold text-ink uppercase tracking-wider">Как это проходит</div>
        ${c.process.map((p, i) => `<div class="text-xs text-ink-2">${i + 1}. ${SF.esc(p)}</div>`).join('')}
      </div>
      ${c.price ? `
        <div class="text-[11px] text-muted bg-sunken border border-line rounded-xl p-2.5 leading-snug">
          Оплата идёт напрямую автору по его ссылке. SmartFlow пока не принимает платежи и не берёт комиссию.
        </div>` : ''}
      ${mainButton}
      <button onclick="SF.copyText('${shareLink(c.id)}', 'Ссылка на покупку скопирована')" class="w-full py-2 rounded-xl btn-3d-dark text-xs">Отправить ссылку на покупку</button>
    `);
  };

  // A ready-made SI-consultant from the Marketplace becomes one of "my" consultants in the Office
  SF.actions.connectTemplate = (id) => {
    const store = window.funnelStore;
    const c = findConsultant(store.data, id);
    SF.closeModal();
    if (!c) return;
    if (!store.data.me.business.active) {
      SF.showToast('Сначала откройте Офис — это займёт минуту');
      SF.openIn('marketplace', 'office');
      return;
    }
    const added = store.addOfficeConsultant({
      ...JSON.parse(JSON.stringify(store.data.office.consultants[0] || {})),
      id: `oc-${Date.now()}`,
      serverProjectId: null,
      name: `${c.name} · мой`,
      roleTitle: c.roleTitle,
      photoUrl: null,
      source: 'bought',
      author: c.author.name,
      goal: 'Довести клиента до оплаты моего продукта',
      link: '',
      brainAccess: []
    });
    SF.showToast('Подключено! Пройдите распаковку во вкладке «Методология»');
    SF.openIn('marketplace', 'office-consultant', { id: added.id, tab: 'methodology' });
  };

  // ---------------- Screen ----------------
  const OWN_TITLES = { list: 'Маркетплейс', consultant: 'Смарт-консультант' };

  SF.screens.marketplace = {
    title(route, state) {
      if (OWN_TITLES[route.screen]) return OWN_TITLES[route.screen];
      return SF.office.title(route, state);
    },
    render(route, state) {
      if (route.screen === 'list') return renderList(state);
      if (route.screen === 'consultant') return renderConsultant(route, state);
      return SF.office.render(route, state);
    }
  };
})(window);
