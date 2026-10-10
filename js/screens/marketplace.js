// screens/marketplace.js - Marketplace of SI-consultants (real cards from the server).
// A consultant appears here when its owner turns on "Показывать в Маркетплейсе" in the Office.
// The Office (business profile) opens inside this tab; its screens are in screens/office.js.

(function (window) {
  const SF = window.SF;

  const CATEGORIES = [
    { id: 'all', label: 'Все' },
    { id: 'sales', label: 'Продажи' },
    { id: 'warmup', label: 'Прогрев и заявки' }
  ];

  const startLink = (param) => `https://t.me/smartflow_ai_support_bot/app?startapp=${param}`;
  const store = () => window.funnelStore;

  function findCard(state, id) {
    return (state.remote.marketplace || []).find(c => c.id === id) ||
      Object.values(state.remote.cards).find(c => c.id === id);
  }

  function trialLabel(c) {
    return c.trialDays ? `Пробный период ${c.trialDays} дн.` : '';
  }

  // ---------------- List ----------------
  // Visible way to create your own SI-consultant (Office terms first, if not accepted yet)
  function createButton() {
    return `
      <button onclick="SF.actions.startCreateConsultant()" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm flex items-center justify-center gap-1.5">
        <i data-lucide="plus" class="w-4 h-4"></i> Создать своего SI-продавца
      </button>`;
  }

  function officeEntry(state) {
    if (store().isBusinessActive()) {
      const waiting = SF.data.waitingInquiries(state).length;
      return `
        <button onclick="SF.push('office')" class="w-full glass-card-3d p-3.5 flex items-center gap-3 text-left border-[#81D8D0]">
          <span class="w-10 h-10 rounded-2xl bg-[#81D8D0]/20 flex items-center justify-center text-brand"><i data-lucide="briefcase" class="w-5 h-5"></i></span>
          <span class="flex-1">
            <span class="block text-sm font-bold text-ink">Мой Офис</span>
            <span class="block text-[11px] text-muted">SI-продавцов: ${state.office.consultants.length}${waiting ? ` · ждут ответа: ${waiting}` : ''}</span>
          </span>
          <i data-lucide="chevron-right" class="w-4 h-4 text-faint"></i>
        </button>`;
    }
    return `
      <button onclick="SF.push('office')" class="w-full hero-tiffany-banner p-4 text-left flex items-center gap-3">
        <img src="${SF.MASCOTS.consultant}" alt="" class="w-14 h-14 flex-shrink-0" />
        <span class="flex-1">
          <span class="block text-sm font-extrabold">Офис для бизнеса</span>
          <span class="block text-xs font-medium leading-snug">Свой SI-продавец продаёт ваши услуги 24/7. Откройте бизнес-профиль — это бесплатно.</span>
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
          <div class="text-right text-[11px] text-faint">${c.stats.dialogs} диалог.</div>
        </div>
        <div class="text-xs font-semibold text-ink leading-snug">${SF.esc(c.offer)}</div>
        <div class="flex items-center justify-between text-[11px] gap-2">
          <span class="text-brand font-bold truncate">${SF.esc(c.priceLabel)}</span>
          <span class="text-muted whitespace-nowrap">${trialLabel(c)}</span>
        </div>
      </button>`;
  }

  function renderList(state) {
    const filter = state.ui.marketplaceFilter || 'all';
    const all = state.remote.marketplace;
    const items = (all || []).filter(c => filter === 'all' || c.category === filter);
    return `
      ${officeEntry(state)}
      ${createButton()}

      <div class="flex gap-1.5 overflow-x-auto pb-1">
        ${CATEGORIES.map(cat => `
          <button onclick="SF.actions.setMarketFilter('${cat.id}')" class="px-3 py-1.5 rounded-xl text-xs whitespace-nowrap border font-semibold ${filter === cat.id ? 'bg-[#81D8D0]/20 border-[#81D8D0] text-brand' : 'bg-card border-line text-muted'}">${cat.label}</button>
        `).join('')}
      </div>

      <div class="space-y-2.5">
        ${all === null ? '<div class="text-xs text-muted px-1">Загружаю…</div>' : ''}
        ${items.map(card).join('')}
        ${all && !items.length ? SF.emptyState('consultant', 'Витрина только открывается',
          'Здесь появятся SI-продавцы экспертов. Своего SI-продавца можно показать здесь из Офиса — включите «Показывать в Маркетплейсе».') : ''}
      </div>
    `;
  }

  // ---------------- Consultant card (order from the structure document) ----------------
  function renderConsultant(route, state) {
    const c = findCard(state, route.id);
    if (!c && SF.data.isMissing(state, route.id)) {
      return SF.emptyState('assistant', 'Карточка не найдена', 'Возможно, автор снял SI-продавца с витрины.');
    }
    if (!c) return '<div class="text-xs text-muted">Загружаю…</div>';
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
        ${c.description ? `<p class="text-xs text-ink-2 leading-relaxed whitespace-pre-line">${SF.esc(c.description)}</p>` : ''}
        <div class="flex flex-wrap gap-1.5 text-[10px] font-semibold">
          <span class="px-2 py-0.5 rounded-full bg-raised text-ink-2 border border-line">${c.category === 'warmup' ? 'Прогрев и заявки' : 'Продажи'}</span>
          ${c.trialDays ? `<span class="px-2 py-0.5 rounded-full bg-raised text-ink-2 border border-line">${trialLabel(c)}</span>` : ''}
        </div>
      </div>

      <!-- 3. Results (real numbers only) -->
      <div class="p-3 rounded-xl bg-card border border-line flex items-center justify-between text-xs">
        <span class="text-muted">Диалогов с клиентами</span>
        <span class="font-extrabold text-ink">${c.stats.dialogs}</span>
      </div>

      <!-- 4. Reviews -->
      <div class="glass-card-3d p-3.5 space-y-1">
        ${SF.sectionTitle('message-square-heart', 'Отзывы')}
        <div class="text-xs text-muted">Пока нет отзывов. Отзывы появятся от реальных клиентов, имена будут скрыты.</div>
      </div>

      <!-- 5. Buttons -->
      <div class="grid grid-cols-2 gap-2">
        <button onclick="SF.actions.openChat('${SF.js(c.slug)}')" class="py-3 rounded-2xl btn-3d-red text-sm flex items-center justify-center gap-1.5">
          <i data-lucide="message-circle" class="w-4 h-4"></i> Спросить
        </button>
        <button onclick="SF.actions.openBuy('${SF.js(c.id)}')" class="py-3 rounded-2xl btn-3d-tiffany text-sm flex items-center justify-center gap-1.5 ${c.paymentUrl ? '' : 'opacity-60'}">
          <i data-lucide="shopping-bag" class="w-4 h-4"></i> Купить
        </button>
      </div>
      <button onclick="SF.copyText('${startLink('C_' + SF.js(c.id))}', 'Ссылка на карточку скопирована')" class="w-full py-2 rounded-xl btn-3d-dark text-xs flex items-center justify-center gap-1.5">
        <i data-lucide="share-2" class="w-3.5 h-3.5"></i> Поделиться карточкой
      </button>

      <!-- 6. Author -->
      <button onclick="SF.push('person', { id: '${SF.js(c.author.id)}' })" class="w-full glass-card-3d p-3 flex items-center gap-3 text-left">
        ${SF.avatar(c.author.photoUrl, { size: 36, kind: 'human' })}
        <div class="flex-1 min-w-0">
          <div class="text-[10px] text-muted uppercase tracking-wider">Автор</div>
          <div class="text-xs font-bold text-ink truncate">${SF.esc(c.author.name)}</div>
        </div>
        <div class="w-24">
          <div class="text-[10px] text-muted text-right">Доверие ${c.author.trust}%</div>
          ${SF.progressBar(c.author.trust)}
        </div>
      </button>
    `;
  }

  // ---------------- Someone's public profile (opened by link P_<userId> or from a card) ----------------
  function renderPerson(route, state) {
    const p = state.remote.profiles[route.id];
    if (!p && SF.data.isMissing(state, route.id)) return SF.emptyState('assistant', 'Профиль не найден', 'Проверьте ссылку.');
    if (!p) return '<div class="text-xs text-muted">Загружаю…</div>';
    const pr = p.profile || {};
    const block = (title, text) => text ? `
      <div class="glass-card-3d p-3.5 space-y-1">
        <div class="text-[11px] font-bold uppercase tracking-wider text-brand">${title}</div>
        <div class="text-xs text-ink-2 leading-relaxed whitespace-pre-line">${SF.esc(text)}</div>
      </div>` : '';
    return `
      <div class="glass-card-3d p-4 text-center space-y-2">
        <div class="flex justify-center">${SF.avatar(p.photoUrl, { size: 88, kind: 'human' })}</div>
        <div class="text-lg font-extrabold text-ink">${SF.esc(p.displayName)}</div>
        ${pr.headline ? `<div class="text-xs text-brand font-semibold">${SF.esc(pr.headline)}</div>` : ''}
        <div class="max-w-[220px] mx-auto pt-1">
          <div class="text-[11px] text-muted mb-1">Доверие ${p.trust}%</div>
          ${SF.progressBar(p.trust)}
        </div>
        ${pr.offerButton ? `<button onclick="${pr.offerButton.consultantId ? `SF.actions.openChat('${SF.js(pr.offerButton.consultantId)}')` : `SF.openLink('${SF.js(pr.offerButton.url)}')`}" class="mt-2 w-full py-2.5 rounded-2xl btn-3d-tiffany text-sm">${SF.esc(pr.offerButton.label)}</button>` : ''}
      </div>
      ${block('О себе', pr.bio)}
      ${block('Регалии и сертификаты', pr.regalia)}
      ${block('Результаты и кейсы', pr.results)}
      ${(pr.links || []).length ? `
        <div class="flex flex-wrap gap-2">
          ${pr.links.map(l => `<button onclick="SF.openLink('${SF.js(l.url)}')" class="px-3 py-1.5 rounded-xl btn-3d-dark text-xs flex items-center gap-1.5"><i data-lucide="external-link" class="w-3.5 h-3.5"></i>${SF.esc(l.label || l.url.replace(/^https?:\/\//, ''))}</button>`).join('')}
        </div>` : ''}
      ${p.consultants.length ? `
        <div class="space-y-2">
          ${SF.sectionTitle('bot', 'SI-продавцы')}
          ${p.consultants.map(card).join('')}
        </div>` : ''}
    `;
  }

  // ---------------- Actions ----------------
  SF.actions.setMarketFilter = (filter) => {
    store().data.ui.marketplaceFilter = filter;
    store().notify();
  };

  SF.actions.openBuy = (id) => {
    const c = findCard(store().data, id);
    if (!c) return;
    SF.openModal(`
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-bold text-ink">${SF.esc(c.name)}</h3>
        <button onclick="SF.closeModal()" class="text-muted text-lg leading-none" aria-label="Закрыть">&times;</button>
      </div>
      <div class="text-sm font-semibold text-ink">${SF.esc(c.offer)}</div>
      ${c.priceLabel ? `<div class="text-2xl font-extrabold text-ink">${SF.esc(c.priceLabel)}</div>` : ''}
      ${c.trialDays ? `<div class="text-[11px] text-muted">${trialLabel(c)}</div>` : ''}
      ${c.paymentUrl ? `
        <div class="text-[11px] text-muted bg-sunken border border-line rounded-xl p-2.5 leading-snug">
          Оплата идёт напрямую автору по его ссылке. SmartFlow не принимает платежи и не берёт комиссию.
        </div>
        <button onclick="SF.openLink('${SF.js(c.paymentUrl)}')" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm">Перейти к оплате</button>
        <button onclick="SF.copyText('${SF.js(c.paymentUrl)}', 'Ссылка на оплату скопирована')" class="w-full py-2 rounded-xl btn-3d-dark text-xs">Скопировать ссылку на оплату</button>
      ` : `
        <div class="text-xs text-muted">Автор пока не добавил ссылку на оплату. Задайте вопрос SI-продавцу или свяжитесь с автором.</div>
        <button onclick="SF.closeModal(); SF.actions.openChat('${SF.js(c.slug)}')" class="w-full py-3 rounded-2xl btn-3d-red text-sm">Спросить</button>
      `}
    `);
  };

  // ---------------- Screen ----------------
  const OWN_TITLES = { list: 'Маркетплейс', consultant: 'SI-продавец', person: 'Профиль' };

  SF.screens.marketplace = {
    title(route, state) {
      if (OWN_TITLES[route.screen]) return OWN_TITLES[route.screen];
      return SF.office.title(route, state);
    },
    render(route, state) {
      if (route.screen === 'list') return renderList(state);
      if (route.screen === 'consultant') return renderConsultant(route, state);
      if (route.screen === 'person') return renderPerson(route, state);
      return SF.office.render(route, state);
    },
    afterRender(route, state) {
      if (route.screen === 'list') {
        SF.data.marketplace();
        if (store().isBusinessActive()) SF.data.allInquiries();
      } else if (route.screen === 'consultant') {
        if (!findCard(state, route.id)) SF.data.cardById(route.id);
      } else if (route.screen === 'person') {
        SF.data.profile(route.id);
      } else if (SF.office.afterRender) {
        SF.office.afterRender(route, state);
      }
    }
  };
})(window);
