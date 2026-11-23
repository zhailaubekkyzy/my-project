// screens/marketplace.js - Marketplace of SI-consultants (real cards from the server).
// A consultant appears here when its owner turns on "Показывать в Маркетплейсе" in the Office.
// The Office (business profile) opens inside this tab; its screens are in screens/office.js.

(function (window) {
  const SF = window.SF;

  const startLink = (param) => SF.appLink(param);
  const store = () => window.funnelStore;

  function findCard(state, id) {
    return (state.remote.marketplace || []).find(c => c.id === id) ||
      Object.values(state.remote.cards).find(c => c.id === id);
  }

  function trialLabel(c) {
    return c.trialDays ? `Пробный период ${c.trialDays} дн.` : '';
  }

  // ---------------- List ----------------
  // The Office is not here any more (owner's decision 23 Nov.): Настройки → «Мои бизнесы».

  // The price as the expert set it: a sum, «Бесплатно» or «Цена по запросу»
  function priceText(c) {
    if (c.priceMode === 'free') return 'Бесплатно';
    if (c.priceMode === 'on_request') return 'Цена по запросу';
    return c.priceLabel || '';
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
          <div class="text-right text-[11px] text-faint">
            ${c.reviews && c.reviews.count ? `<div class="font-bold text-ink">★ ${String(c.reviews.average).replace('.', ',')} <span class="text-faint font-normal">(${c.reviews.count})</span></div>` : ''}
            <div>${c.stats.dialogs} диалог.</div>
          </div>
        </div>
        <div class="text-xs font-semibold text-ink leading-snug">${SF.esc(c.offer)}</div>
        <div class="flex items-center justify-between text-[11px] gap-2">
          <span class="text-brand font-bold truncate">${SF.esc(priceText(c))}</span>
          <span class="text-muted whitespace-nowrap">${trialLabel(c)}</span>
        </div>
      </button>`;
  }

  // Two parts of the Marketplace (owner's decisions 22 Nov.): experts' products for everyone, and «Шаблоны» (was
  // «Для бизнеса») — templates of AI-продавцов, also seen by everyone (buying them is in the business profile)
  function marketTabs(route) {
    if (!SF.feature('funnels')) return '';
    const tab = route.mtab === 'biz' ? 'biz' : 'experts';
    return `
      <div class="grid grid-cols-2 gap-1 bg-raised p-1.5 rounded-2xl border border-line">
        ${[['experts', 'Специалисты', 'store'], ['biz', 'Шаблоны ИИ‑продавцов', 'layers']].map(([id, label, icon]) => `
          <button onclick="SF.patch({ mtab: '${id}' })" class="py-2 px-1 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 leading-tight text-center ${tab === id ? 'bg-[#81D8D0] text-[#08302c] shadow' : 'text-muted'}">
            <i data-lucide="${icon}" class="w-4 h-4"></i>${label}</button>`).join('')}
      </div>`;
  }

  function renderList(state, route = {}) {
    if (SF.feature('funnels') && route.mtab === 'biz' && SF.funnels) {
      return `${marketTabs(route)}${SF.funnels.catalogInline(route)}`;
    }
    const all = state.remote.marketplace;
    const q = String(state.ui.marketplaceSearch || '').trim().toLowerCase();
    const matches = (c) => !q || [c.name, c.offer, c.roleTitle, c.description, c.priceLabel, c.author && c.author.name]
      .some(v => String(v || '').toLowerCase().includes(q));
    // Filters by niche, like on marketplaces: a section, then a niche inside it
    const items = (all || []).filter(c => SF.niches.matches(c, route) && matches(c));
    return `
      ${marketTabs(route)}

      <div class="relative">
        <i data-lucide="search" class="w-4 h-4 text-faint absolute left-3 top-1/2 -translate-y-1/2"></i>
        <input type="search" data-keep="market-search" value="${SF.esc(state.ui.marketplaceSearch || '')}" oninput="SF.actions.searchMarket(this.value)" placeholder="Найти SI-продавца: имя, тема, эксперт" autocomplete="off"
          class="w-full bg-card border border-line-2 rounded-xl pl-9 pr-3 py-2.5 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]" />
      </div>

      ${SF.niches.filter('experts', route)}

      <div class="space-y-2.5">
        ${all === null ? '<div class="text-xs text-muted px-1">Загружаю…</div>' : ''}
        ${items.map(card).join('')}
        ${all && !items.length && q ? '<div class="text-xs text-muted px-1">Ничего не нашли. Людей можно найти во вкладке «Чаты».</div>' : ''}
        ${all && all.length && !items.length && !q ? '<div class="text-xs text-muted px-1">В этой нише пока никого. Посмотрите другие разделы.</div>' : ''}
        ${all && !all.length && !q ? SF.emptyState('consultant', 'Витрина только открывается', 'Здесь появятся SI-продавцы экспертов.') : ''}
      </div>
    `;
  }

  // Other people see someone's trust only when it is already high: a new expert's «Доверие 0%»
  // reads to a client as "do not trust", though it only means "profile not filled yet".
  // The person sees their own trust and what raises it in Профиль.
  const TRUST_SHOWN_FROM = 50;
  const showTrust = (trust) => Number(trust) >= TRUST_SHOWN_FROM;

  // The card button the expert chose (owner's decision 20 Nov.): «Купить» opens payment next to
  // «Спросить»; any other button («Получить бесплатно», «Записаться…», «Узнать цену», own words)
  // opens the chat where the SI already knows why the person came.
  function cardButtons(c) {
    const cta = c.cta || { kind: 'buy', label: 'Купить' };
    if (cta.kind === 'buy') {
      return `
      <div class="grid grid-cols-2 gap-2">
        <button onclick="SF.actions.openChat('${SF.js(c.slug)}', { entry: 'card' })" class="py-3 rounded-2xl btn-3d-red text-sm flex items-center justify-center gap-1.5">
          <i data-lucide="message-circle" class="w-4 h-4"></i> Спросить
        </button>
        <button onclick="SF.actions.cardCta('${SF.js(c.id)}')" class="py-3 rounded-2xl btn-3d-tiffany text-sm flex items-center justify-center gap-1.5 ${c.paymentUrl ? '' : 'opacity-60'}">
          <i data-lucide="shopping-bag" class="w-4 h-4"></i> ${SF.esc(cta.label)}
        </button>
      </div>`;
    }
    return `
      <button onclick="SF.actions.cardCta('${SF.js(c.id)}')" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm flex items-center justify-center gap-1.5">
        <i data-lucide="message-circle" class="w-4 h-4"></i> ${SF.esc(cta.label)}
      </button>`;
  }

  // The person opened a card: counted once per screen visit (for the expert's numbers and ours)
  const cardOpened = {};
  function countCardOpen(c) {
    if (!c || cardOpened[c.id] || !SF.data.signedIn()) return;
    cardOpened[c.id] = true;
    window.smartFlowApi.cardEvent(c.slug, 'open').catch(() => {});
  }

  // ---------------- Consultant card (order from the structure document) ----------------
  function renderConsultant(route, state) {
    const c = findCard(state, route.id);
    if (!c && SF.data.isMissing(state, route.id)) {
      return SF.emptyState('assistant', 'Карточка не найдена', 'Возможно, автор снял SI-продавца с витрины.');
    }
    if (!c) return '<div class="text-xs text-muted">Загружаю…</div>';
    countCardOpen(c);
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
        ${priceText(c) ? `<div class="text-lg font-extrabold text-ink">${SF.esc(priceText(c))}</div>` : ''}
        <div class="flex flex-wrap gap-1.5 text-[10px] font-semibold">
          ${c.niche ? `<button onclick="SF.openIn('marketplace', 'list', { sec: '${SF.js(c.niche.section)}', nic: '${SF.js(c.niche.id)}' })" class="px-2 py-0.5 rounded-full bg-[#81D8D0]/15 text-brand border border-[#81D8D0]">${SF.esc(c.niche.name)}</button>` : ''}
          ${c.trialDays ? `<span class="px-2 py-0.5 rounded-full bg-raised text-ink-2 border border-line">${trialLabel(c)}</span>` : ''}
        </div>
      </div>

      <!-- 3. Results (real numbers only) -->
      <div class="p-3 rounded-xl bg-card border border-line flex items-center justify-between text-xs">
        <span class="text-muted">Диалогов с клиентами</span>
        <span class="font-extrabold text-ink">${c.stats.dialogs}</span>
      </div>

      <!-- 4. Reviews of real clients (short names only) -->
      ${renderReviews(c, state)}

      <!-- 5. Questions and answers (seen by everyone, like on marketplaces); the SI answers by them -->
      ${SF.niches.faqView(c.faq, { askHint: 'Нет вашего вопроса? Спросите SI-продавца в чате — если он не знает, ответит эксперт.' })}

      <!-- 6. Buttons -->
      ${cardButtons(c)}
      <button onclick="SF.copyText('${startLink('C_' + SF.js(c.id))}', 'Ссылка на карточку скопирована')" class="w-full py-2 rounded-xl btn-3d-dark text-xs flex items-center justify-center gap-1.5">
        <i data-lucide="share-2" class="w-3.5 h-3.5"></i> Поделиться карточкой
      </button>

      <!-- 7. Author -->
      <button onclick="SF.push('person', { id: '${SF.js(c.author.id)}' })" class="w-full glass-card-3d p-3 flex items-center gap-3 text-left">
        ${SF.avatar(c.author.photoUrl, { size: 36, kind: 'human', userId: c.author.id })}
        <div class="flex-1 min-w-0">
          <div class="text-[10px] text-muted uppercase tracking-wider">Автор</div>
          <div class="flex items-center gap-1 text-xs font-bold text-ink min-w-0"><span class="truncate">${SF.esc(c.author.name)}</span>${SF.partnerBadge(c.author.id, 14)}</div>
        </div>
        ${showTrust(c.author.trust) ? `
        <div class="w-24">
          <div class="text-[10px] text-muted text-right">Доверие ${c.author.trust}%</div>
          ${SF.progressBar(c.author.trust)}
        </div>` : ''}
      </button>
    `;
  }

  const dateLabel = (v) => {
    const d = new Date(String(v).replace(' ', 'T') + (/[Z+]/.test(String(v)) ? '' : 'Z'));
    return isNaN(d) ? '' : d.toLocaleDateString(SF.locale(), { day: 'numeric', month: 'long', year: 'numeric' });
  };

  function renderReviews(c, state) {
    const data = state.remote.cardReviews[c.id];
    const list = data ? data.reviews : [];
    return `
      <div class="glass-card-3d p-3.5 space-y-2.5">
        <div class="flex items-center justify-between gap-2">
          ${SF.sectionTitle('message-square-heart', 'Отзывы')}
          ${data && data.count ? `<span class="text-xs font-bold text-ink whitespace-nowrap">★ ${String(data.average).replace('.', ',')} <span class="text-faint font-normal">· ${data.count}</span></span>` : ''}
        </div>
        ${!data ? '<div class="text-xs text-muted">Загружаю…</div>' : ''}
        ${data && !data.count ? '<div class="text-xs text-muted">Пока нет отзывов. Оставить отзыв могут только клиенты, которые купили; видно только имя и первую букву фамилии.</div>' : ''}
        ${list.map(r => `
          <div class="space-y-1 pt-2 border-t border-line first:border-0 first:pt-0">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-bold text-ink">${SF.esc(r.name)}</span>
              ${SF.stars(r.rating)}
            </div>
            ${r.text ? `<p class="text-xs text-ink-2 leading-relaxed whitespace-pre-line">${SF.esc(r.text)}</p>` : ''}
            ${r.reply ? `<div class="ml-3 pl-2.5 border-l-2 border-[#81D8D0] text-[11px] text-ink-2"><span class="font-semibold text-ink">Ответ автора:</span> ${SF.esc(r.reply)}</div>` : ''}
            <div class="flex items-center justify-between text-[10px] text-faint">
              <span>${dateLabel(r.createdAt)}</span>
              ${SF.data.signedIn() ? `<button onclick="SF.actions.reportReview('${SF.js(r.id)}')" class="underline">Пожаловаться</button>` : ''}
            </div>
          </div>`).join('')}
      </div>`;
  }

  SF.actions.reportReview = async (reviewId) => {
    const reason = prompt('Что не так с этим отзывом? Команда SmartFlow проверит.');
    if (reason === null) return;
    try {
      await window.smartFlowApi.reportReview(reviewId, reason);
      SF.showToast('Спасибо! Команда проверит отзыв');
    } catch (err) {
      SF.showToast(SF.withErrorCode(err.message || 'Не отправилось', err));
    }
  };

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
        <div class="flex justify-center">${SF.avatar(p.photoUrl, { size: 88, kind: 'human', userId: p.partner ? p.id : null })}</div>
        <div class="text-lg font-extrabold text-ink">${SF.esc(p.displayName)}</div>
        ${pr.headline ? `<div class="text-xs text-brand font-semibold">${SF.esc(pr.headline)}</div>` : ''}
        ${showTrust(p.trust) ? `
        <div class="max-w-[220px] mx-auto pt-1">
          <div class="text-[11px] text-muted mb-1">Доверие ${p.trust}%</div>
          ${SF.progressBar(p.trust)}
        </div>` : ''}
        ${p.partner ? `<div class="pt-1">${SF.partnerMedal(p.partner.count, { size: 56 })}</div>` : ''}
        ${pr.offerButton ? `<button onclick="${pr.offerButton.consultantId ? `SF.actions.openChat('${SF.js(pr.offerButton.consultantId)}')` : `SF.openLink('${SF.js(pr.offerButton.url)}')`}" class="mt-2 w-full py-2.5 rounded-2xl btn-3d-tiffany text-sm">${SF.esc(pr.offerButton.label)}</button>` : ''}
        ${p.id !== store().data.me.id ? `<button onclick="SF.actions.openPerson('${SF.js(p.id)}')" class="mt-2 w-full py-2.5 rounded-2xl btn-3d-dark text-sm flex items-center justify-center gap-1.5"><i data-lucide="message-circle" class="w-4 h-4"></i>Написать</button>` : ''}
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
  SF.actions.searchMarket = (value) => {
    store().data.ui.marketplaceSearch = String(value || '');
    store().notify();
  };

  // The card button: the person becomes the expert's client (a purchase from the card is not invisible)
  SF.actions.cardCta = (id) => {
    const c = findCard(store().data, id);
    if (!c) return;
    if (SF.data.signedIn()) window.smartFlowApi.cardEvent(c.slug, 'cta').catch(() => {});
    const kind = (c.cta && c.cta.kind) || 'buy';
    if (kind === 'buy') SF.actions.openBuy(id);
    else SF.actions.openChat(c.slug, { entry: 'card' });
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
      ${priceText(c) ? `<div class="text-2xl font-extrabold text-ink">${SF.esc(priceText(c))}</div>` : ''}
      ${c.trialDays ? `<div class="text-[11px] text-muted">${trialLabel(c)}</div>` : ''}
      ${c.paymentUrl ? `
        <div class="text-[11px] text-muted bg-sunken border border-line rounded-xl p-2.5 leading-snug">
          Оплата идёт напрямую автору по его ссылке. SmartFlow не принимает платежи и не берёт комиссию.
        </div>
        <button onclick="SF.openLink('${SF.js(c.paymentUrl)}')" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm">Перейти к оплате</button>
        <div class="text-[11px] text-ink-2 leading-snug">После оплаты пришлите чек в чат с SI-продавцом — автор проверит оплату и откроет доступ.</div>
        <button onclick="SF.closeModal(); SF.actions.openChat('${SF.js(c.slug)}', { entry: 'card' })" class="w-full py-2.5 rounded-xl btn-3d-tiffany text-xs">Я оплатил(а) — отправить чек</button>
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
      if (route.screen === 'list') return renderList(state, route);
      if (route.screen === 'consultant') return renderConsultant(route, state);
      if (route.screen === 'person') return renderPerson(route, state);
      // Only look and buy here (owner's decision 23 Nov.): a template's page stays; the Office lives in Настройки
      if (route.screen === 'office-funnel') return SF.office.render(route, state);
      const { screen, ...params } = route;
      setTimeout(() => SF.openIn('profile', screen, params), 0);
      return '';
    },
    afterRender(route, state) {
      if (route.screen === 'list') {
        SF.data.niches();
        if (route.mtab === 'biz' && SF.funnels) SF.funnels.loadInline(route);
        SF.data.marketplace();
      } else if (route.screen === 'consultant') {
        if (!findCard(state, route.id)) SF.data.cardById(route.id);
        SF.data.cardReviews(route.id);
      } else if (route.screen === 'person') {
        SF.data.profile(route.id);
      } else if (route.screen === 'office-funnel' && SF.office.afterRender) {
        SF.office.afterRender(route, state);
      }
    }
  };
})(window);
