// screens/funnels.js - «Шаблоны» (ready-made funnels, flag `funnels`): the catalogue «Для бизнеса» in the
// Marketplace (seen by everyone, owner's decision 22 Nov.), a template's page, publishing one's own template
// (at once, no review since step 4 of «Бизнес-режим 2.0») and the bought ones. Clients of experts never see it.
//   office-funnels        — the catalogue («Каталог») and the author's own funnels («Мои воронки»)
//   office-funnel         — one funnel: description, steps, result, price, author
//   office-funnel-publish — publish (or change) a funnel from one's own SI-seller
// Before buying an expert sees the description, the steps and the result — never the marketer's
// instructions and scenario texts (the server does not send them).
// Part 2: «Я оплатил(а)» by the author's link (or «Подключить» on a percentage) → the author confirms
// in «Мои воронки» → the expert connects the funnel to their SI-seller («Купленные»).

(function (window) {
  const SF = window.SF;
  const showToast = SF.showToast;
  const store = () => window.funnelStore;
  const api = () => window.smartFlowApi;
  const esc = (v) => SF.esc(v);

  const PRICE_TYPES = [
    { id: 'once', label: 'Разовая оплата', hint: 'Эксперт платит один раз', placeholder: 'Например: 15 000 ₸' },
    { id: 'monthly', label: 'Подписка в месяц', hint: 'Эксперт платит каждый месяц, пока пользуется', placeholder: 'Например: 5 000 ₸ в месяц' },
    { id: 'percent', label: 'Процент с продаж', hint: 'Доля от продаж эксперта на вашем шаблоне', placeholder: 'Например: 10% с продаж' }
  ];
  const STATUS = {
    review: { label: 'Опубликован', cls: 'text-emerald-500' },
    published: { label: 'Опубликован', cls: 'text-emerald-500' },
    rejected: { label: 'Снят командой', cls: 'text-si' },
    hidden: { label: 'Снят командой после жалобы', cls: 'text-si' }
  };

  // ---------------- Data (memory) ----------------
  const cache = {};
  const errors = {};
  function load(key, fn, maxAgeMs = 30000) {
    return SF.data.ensure(`funnels:${key}`, async () => {
      if (!SF.data.signedIn()) return false;
      try {
        cache[key] = await fn();
        delete errors[key];
      } catch (err) {
        errors[key] = err.message || 'Не загрузилось';
      }
      store().notify();
    }, maxAgeMs);
  }
  function refresh() {
    SF.data.invalidate('funnels:');
    Object.keys(cache).forEach(k => delete cache[k]);
    store().notify();
  }
  function waiting(key) {
    if (errors[key]) {
      return `<div class="glass-card-3d p-4 space-y-2 text-xs"><div class="text-si">Не загрузилось: ${esc(errors[key])}</div>
        <button onclick="SF.funnels.refresh()" class="px-3 py-1.5 rounded-xl btn-3d-dark text-xs">Ещё раз</button></div>`;
    }
    return '<div class="text-xs text-muted px-1">Загружаю…</div>';
  }

  // ---------------- Small parts ----------------
  function priceLine(f) {
    return `<span class="text-ink font-bold">${esc(f.priceLabel)}</span> <span class="text-muted">· ${esc(f.priceTypeLabel)}</span>`;
  }

  function author(f, size = 28) {
    return `<span class="flex items-center gap-2 min-w-0">${SF.avatar(f.author.photoUrl, { size, userId: f.author.id })}
      <span class="text-[11px] text-ink-2 truncate">${esc(f.author.name)}</span></span>`;
  }

  function stepsList(steps) {
    return `<ol class="space-y-2">${steps.map((st, i) => `
      <li class="flex gap-2.5">
        <span class="w-6 h-6 rounded-full bg-[#81D8D0] text-[#08302c] text-[11px] font-bold flex items-center justify-center flex-shrink-0">${i + 1}</span>
        <span class="min-w-0"><span class="block text-xs font-semibold text-ink">${esc(st.title)}</span>
          ${st.goal ? `<span class="block text-[11px] text-muted leading-snug">${esc(st.goal)}</span>` : ''}</span>
      </li>`).join('')}</ol>`;
  }

  // Real numbers only: experts who use it now; the share of buyers once there are 30+ clients
  function resultsLine(r) {
    if (!r || !r.experts) return '';
    const who = `Используют ${r.experts} ${plural(r.experts, 'эксперт', 'эксперта', 'экспертов')}`;
    return r.salesShare !== null && r.salesShare !== undefined ? `${who} · купили ${r.salesShare}% клиентов` : who;
  }

  function funnelCard(f, { mine = false } = {}) {
    const status = mine && STATUS[f.status];
    return `
      <button onclick="SF.push('office-funnel', { id: '${SF.js(f.id)}' })" class="w-full glass-card-3d p-3.5 text-left space-y-2">
        <span class="flex items-start justify-between gap-2">
          <span class="text-sm font-bold text-ink leading-snug">${esc(f.title)}</span>
          <span class="text-[10px] px-2 py-0.5 rounded-full bg-sunken border border-line text-ink-2 flex-shrink-0">${esc(f.niche)}</span>
        </span>
        ${f.result ? `<span class="block text-[11px] text-ink-2 leading-snug line-clamp-2">${esc(f.result)}</span>` : ''}
        <span class="block text-[11px] text-muted">${f.steps.map(st => esc(st.title)).join(' → ')}</span>
        ${!mine && resultsLine(f.results) ? `<span class="block text-[11px] text-brand">${resultsLine(f.results)}</span>` : ''}
        <span class="flex items-center justify-between gap-2 text-[11px]">
          ${mine ? `<span class="font-semibold ${status ? status.cls : 'text-muted'}">${status ? status.label : ''}</span>` : author(f, 22)}
          <span class="text-right">${priceLine(f)}</span>
        </span>
      </button>`;
  }

  // ---------------- Catalogue and «Мои воронки» ----------------
  function renderList(route) {
    const view = ['mine', 'bought'].includes(route.view) ? route.view : 'catalog';
    const waitingSales = (cache.purchases && cache.purchases.waiting) || 0;
    const tabs = `
      <div class="grid grid-cols-3 gap-1 bg-raised p-1.5 rounded-2xl border border-line">
        ${[{ id: 'catalog', label: 'Каталог', icon: 'layout-grid' }, { id: 'bought', label: 'Купленные', icon: 'shopping-bag' }, { id: 'mine', label: 'Мои шаблоны', icon: 'pen-line' }].map(({ id, label, icon }) => `
          <button onclick="SF.patch({ view: '${id}' })" class="relative py-2 rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1.5 ${view === id ? 'bg-[#81D8D0] text-[#08302c] shadow' : 'text-muted'}">
            <i data-lucide="${icon}" class="w-4 h-4"></i>${label}
            ${id === 'mine' && waitingSales ? `<span class="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">${waitingSales}</span>` : ''}</button>`).join('')}
      </div>`;
    if (view === 'mine') return tabs + renderMine();
    if (view === 'bought') return tabs + renderBought();
    return tabs + renderCatalog(route);
  }

  function catalogKey(route) {
    return `catalog:${route.q || ''}|${route.niche || ''}`;
  }

  // The catalogue: the search goes to the server; sections and niches filter right here (like on marketplaces).
  // inline — inside the Marketplace tab «Шаблоны» (its own route keys, so the experts' filter is kept apart)
  function renderCatalog(route, { inline = false } = {}) {
    const keys = inline ? { sec: 'tsec', nic: 'tnic' } : { sec: 'sec', nic: 'nic' };
    const q = inline ? (route.tq || '') : (route.q || '');
    const key = catalogKey({ q, niche: '' });
    const data = cache[key];
    const intro = '';
    const search = `
      <form onsubmit="SF.funnels.${inline ? 'searchInline' : 'search'}(event)" class="flex gap-2">
        <input name="q" value="${esc(q)}" autocomplete="off" placeholder="Задача или слово: запись, вебинар, курс…" class="flex-1 p-2.5 rounded-xl bg-sunken border border-line-2 text-ink text-xs" />
        <button type="submit" class="px-3 rounded-xl btn-3d-tiffany text-xs" aria-label="Найти"><i data-lucide="search" class="w-4 h-4"></i></button>
        <span class="self-center">${SF.info('Шаблоны ИИ-продавцов от маркетологов и экспертов: как SI ведёт клиента к покупке. До покупки видно описание, шаги и результат; можно переписаться с продавцом шаблона. Купленный шаблон станет вашим новым SI-продавцом.')}</span>
      </form>`;
    if (!data) return intro + search + waiting(key);
    const filtered = data.funnels.filter(f => SF.niches.matches(f, route, keys));
    const any = q || route[keys.sec] || route[keys.nic];
    const list = filtered.length
      ? filtered.map(f => funnelCard(f)).join('')
      : SF.emptyState('consultant', any ? 'Ничего не нашлось' : 'Шаблонов пока нет',
        any ? 'Попробуйте другое слово или другой раздел.' : 'Здесь появятся шаблоны маркетологов и экспертов.');
    return `${intro}${search}${SF.niches.filter('templates', route, keys)}<div class="space-y-2.5">${list}</div>`;
  }

  function renderMine() {
    const data = cache.mine;
    const consultants = store().data.office.consultants.filter(c => !c.assisting);
    const publish = consultants.length
      ? `<button onclick="SF.push('office-funnel-publish')" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm flex items-center justify-center gap-1.5"><i data-lucide="upload" class="w-4 h-4"></i> Опубликовать шаблон</button>`
      : ``;
    const how = `<div class="flex items-center justify-center gap-1 text-[11px] text-muted">Как это работает${SF.info('1. Соберите воронку в своём SI-продавце: шаги, сценарии «если…, то…», общее описание и пазл для покупателей.\n2. Опубликуйте: название, ниша, что внутри, результат, как вам платят и кто продаёт шаблон.\n3. Шаблон сразу появляется в Маркетплейсе → «Шаблоны ИИ-продавцов» и в вашем Мозге как продукт. Команда снимает только по жалобе.\n4. Эксперты увидят описание, шаги и результат и смогут переписаться с вашим SI-продавцом. Ваши инструкции и тексты сценариев они не видят.')}</div>`;
    if (!data) return publish + how + waiting('mine');
    const list = data.funnels.length ? data.funnels.map(f => funnelCard(f, { mine: true })).join('') : '';
    return `${renderSales()}${publish}${list ? `<div class="space-y-2.5">${list}</div>` : ''}${how}`;
  }

  // ---------------- The author: who bought my funnels ----------------
  function renderSales() {
    const sales = (cache.purchases && cache.purchases.sales) || [];
    if (!sales.length) return '';
    const waiting = sales.filter(p => p.status === 'pending' || (p.status === 'active' && p.renewalRequested));
    const active = sales.filter(p => p.status === 'active');
    const ended = sales.filter(p => p.status === 'ended');
    const who = (p) => `<span class="flex items-center gap-2 min-w-0">${SF.avatar(p.expert.photoUrl, { size: 28, userId: p.expert.id })}
      <span class="min-w-0"><span class="block text-xs font-semibold text-ink truncate">${esc(p.expert.name)}</span>
      <span class="block text-[10px] text-muted truncate">«${esc(p.funnelTitle)}» · ${esc(p.priceLabel)}</span></span></span>`;
    const numbers = (p) => p.numbers
      ? `<div class="text-[11px] text-ink-2">С подключения: новых клиентов ${p.numbers.clients}, продаж ${p.numbers.sales}</div>`
      : `<div class="text-[11px] text-muted">${p.status === 'active' ? 'Эксперт ещё не запустил AI-продавца на шаблоне' : ''}</div>`;
    const waitingHtml = waiting.map(p => {
      const renewal = p.status === 'active';
      const what = p.priceType === 'percent' ? 'Хочет подключить на ваших условиях' : (renewal ? 'Оплатил(а) следующий месяц' : 'Оплатил(а) шаблон');
      const note = renewal ? p.renewalNote : p.note;
      return `
        <div class="glass-card-3d p-3.5 space-y-2 text-xs border border-[#81D8D0]">
          ${who(p)}
          <div class="text-ink-2 font-semibold">${what}</div>
          ${note ? `<div class="p-2.5 rounded-xl bg-sunken border border-line text-ink-2 leading-snug"><span class="text-muted">Как оплатил(а):</span> ${esc(note)}</div>` : ''}
          ${p.priceType !== 'percent' ? '<div class="text-[11px] text-muted">Проверьте поступление на свой счёт, потом подтвердите.</div>' : ''}
          <input id="sale-reason-${esc(p.id)}" maxlength="300" placeholder="Причина, если не подтверждаете (эксперт увидит)" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink text-xs" />
          <div class="grid grid-cols-2 gap-2">
            <button onclick="SF.funnels.decide('${SF.js(p.id)}', 'confirm')" class="py-2.5 rounded-xl btn-3d-tiffany text-xs">${p.priceType === 'percent' ? 'Согласен(на)' : 'Оплата пришла'}</button>
            <button onclick="SF.funnels.decide('${SF.js(p.id)}', 'decline')" class="py-2.5 rounded-xl btn-3d-dark text-xs">${p.priceType === 'percent' ? 'Отказать' : 'Не пришла'}</button>
          </div>
          <button onclick="SF.openIn('chats', 'person', { id: '${SF.js(p.expert.id)}' })" class="text-[11px] text-brand font-semibold">Написать эксперту →</button>
        </div>`;
    }).join('');
    const activeHtml = active.filter(p => !(p.renewalRequested)).map(p => `
      <div class="glass-card-3d p-3.5 space-y-1.5 text-xs">
        ${who(p)}
        <div class="text-[11px] ${p.expired ? 'text-si' : 'text-emerald-500'} font-semibold">${p.expired ? 'Месяц не продлён' : p.priceType === 'monthly' && p.paidUntil ? `Оплачено до ${fmtDay(p.paidUntil)}` : 'Работает'}</div>
        ${numbers(p)}
        ${p.priceType === 'percent' ? `
          <input id="sale-reason-${esc(p.id)}" maxlength="300" placeholder="Причина, если отключаете (эксперт увидит)" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink text-xs" />
          <button onclick="SF.funnels.endPercent('${SF.js(p.id)}')" class="w-full py-2 rounded-xl btn-3d-dark text-[11px]">Отключить — процент не оплачен</button>` : ''}
      </div>`).join('');
    return `
      ${SF.sectionTitle('wallet', 'Продажи моих шаблонов')}
      ${waitingHtml}
      ${activeHtml}
      ${ended.length ? `<div class="text-[11px] text-muted px-1">Отключено: ${ended.length}</div>` : ''}`;
  }

  // ---------------- The expert: funnels I bought ----------------
  const PURCHASE_STATUS = (p) => {
    if (p.status === 'pending') return { label: p.priceType === 'percent' ? 'Ждём согласия автора' : 'Ждём, когда автор подтвердит оплату', cls: 'text-brand' };
    if (p.status === 'declined') return { label: 'Автор не подтвердил', cls: 'text-si' };
    if (p.status === 'ended') return { label: 'Отключена автором', cls: 'text-si' };
    if (p.expired) return { label: 'Месяц не продлён', cls: 'text-si' };
    if (p.connectedTo) return { label: `Работает в «${esc(p.connectedTo.name)}»`, cls: 'text-emerald-500' };
    return { label: 'Оплачен — запустите AI-продавца', cls: 'text-brand' };
  };

  function renderBought() {
    const data = cache.purchases;
    if (!data) return waiting('purchases');
    if (!data.bought.length) {
      return SF.emptyState('consultant', 'Пока нет купленных шаблонов', 'Выберите шаблон в каталоге: оплатите по ссылке автора, он подтвердит — и шаблон станет вашим новым SI-продавцом.');
    }
    return `<div class="space-y-2.5">${data.bought.map(p => {
      const st = PURCHASE_STATUS(p);
      return `
        <button onclick="SF.push('office-funnel', { id: '${SF.js(p.funnelId)}' })" class="w-full glass-card-3d p-3.5 text-left space-y-1">
          <span class="block text-sm font-bold text-ink">${esc(p.funnelTitle)}</span>
          <span class="block text-[11px] text-muted">${esc(p.marketerName)} · ${esc(p.priceLabel)}</span>
          <span class="block text-[11px] font-semibold ${st.cls}">${st.label}</span>
        </button>`;
    }).join('')}</div>`;
  }

  function fmtDay(value) {
    const str = String(value || '');
    const d = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(str) ? `${str.replace(' ', 'T')}Z` : str);
    return isNaN(d) ? '' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  }

  // ---------------- One funnel ----------------
  function renderFunnel(route) {
    const key = `one:${route.id}`;
    const f = cache[key];
    if (!f) return waiting(key);
    const mine = f.status !== undefined;
    const status = mine && STATUS[f.status];
    const inMarketplace = store().data.ui.tab === 'marketplace';
    const ownerBlock = mine && !inMarketplace ? `
      <div class="glass-card-3d p-3.5 space-y-2 text-xs">
        <div class="font-bold ${status ? status.cls : 'text-ink'}">${status ? status.label : ''}</div>
        ${f.reviewNote ? `<div class="p-2.5 rounded-xl bg-sunken border border-line text-ink-2 leading-snug"><span class="text-muted">Команда:</span> ${esc(f.reviewNote)}</div>` : ''}

        <div class="grid grid-cols-2 gap-2">
          <button onclick="SF.push('office-funnel-publish', { id: '${SF.js(f.id)}' })" class="py-2.5 rounded-xl btn-3d-tiffany text-xs">Изменить</button>
          <button onclick="SF.funnels.withdraw('${SF.js(f.id)}')" class="py-2.5 rounded-xl btn-3d-dark text-xs">Убрать</button>
        </div>
      </div>` : '';
    const contact = mine ? '' : renderBuy(f);
    return `
      ${ownerBlock}
      <div class="glass-card-3d p-4 space-y-3">
        <div class="space-y-1">
          <div class="text-[10px] uppercase tracking-wider text-muted">${esc(f.niche)}</div>
          <div class="text-base font-bold text-ink leading-snug">${esc(f.title)}</div>
        </div>
        ${author(f, 32)}
        <div class="text-xs text-ink-2 leading-relaxed whitespace-pre-line">${esc(f.description)}</div>
        ${f.videoUrl ? `<button onclick="SF.openLink('${SF.js(f.videoUrl)}')" class="w-full py-2.5 rounded-xl btn-3d-dark text-xs flex items-center justify-center gap-1.5"><i data-lucide="play-circle" class="w-4 h-4"></i> Видео-презентация</button>` : ''}
      </div>
      ${SF.niches.faqView(f.faq, { askHint: f.seller && !mine ? 'Нет вашего вопроса? Спросите продавца шаблона ниже — если он не знает, ответит автор.' : '' })}
      ${f.seller && !mine ? `
        <button onclick="SF.actions.openChat('${SF.js(f.seller.slug)}')" class="w-full glass-card-3d p-3.5 text-left flex items-center gap-3 border border-[var(--si-bubble-line)]">
          ${SF.avatar(f.seller.photoUrl, { size: 40, kind: 'si' })}
          <span class="flex-1 min-w-0">
            <span class="block text-sm font-bold text-ink truncate">${esc(f.seller.name)}</span>
          </span>
          <i data-lucide="message-circle" class="w-5 h-5 text-si flex-shrink-0"></i>
        </button>` : ''}
      <div class="glass-card-3d p-4 space-y-3">
        ${SF.sectionTitle('footprints', `Шаги · ${f.steps.length}`)}
        ${stepsList(f.steps)}
        ${f.scenarioCount ? `<div class="text-[11px] text-muted">И ещё ${f.scenarioCount} ${plural(f.scenarioCount, 'сценарий', 'сценария', 'сценариев')} «если…, то…»: что делать при возражении, молчании и других ситуациях.</div>` : ''}
      </div>
      ${f.puzzle ? `
        <div class="glass-card-3d p-4 space-y-2 text-xs">
          ${SF.sectionTitle('puzzle', `Что вы дополните · ${f.puzzle.pieces.length}`, '', `После покупки — короткие вопросы по каждому кусочку; что есть в вашем Мозге, подставится само. Шаблон начнёт продавать, ${f.puzzle.release}.`)}
          <div class="flex flex-wrap gap-1.5">${f.puzzle.pieces.map(p => `<span class="px-2 py-1 rounded-lg ${p.required ? 'bg-amber-500/10 border border-amber-500/50' : 'bg-sunken border border-line'} text-ink">${esc(p.title)}</span>`).join('')}</div>
        </div>` : ''}
      <div class="glass-card-3d p-4 space-y-2">
        ${SF.sectionTitle('target', 'Результат')}
        <div class="text-xs text-ink-2 leading-relaxed whitespace-pre-line">${esc(f.result)}</div>
        <div class="text-[10px] text-faint">Так описывает автор. Нашли нечестное обещание — <button onclick="SF.funnels.report('${SF.js(f.id)}')" class="underline">пожалуйтесь</button>.</div>
        ${resultsLine(f.results) ? `<div class="text-[11px] text-brand font-semibold">${resultsLine(f.results)} (настоящие цифры SmartFlow)</div>` : ''}
      </div>
      <div class="glass-card-3d p-4 flex items-center justify-between gap-2 text-xs">
        <span class="text-muted">Стоимость</span><span class="text-right">${priceLine(f)}</span>
      </div>
      ${contact}
    `;
  }

  // ---------------- Buying and launching (the expert) ----------------
  const launchDraft = {}; // { businessId, productId, name } — kept while choosing
  function renderBuy(f) {
    const p = f.myPurchase;
    // Everyone sees «Для бизнеса»; buying is for the business profile (owner's decision 22 Nov.)
    if (!store().isBusinessView()) {
      const active = store().isBusinessActive();
      return `
        <div class="glass-card-3d p-4 space-y-2.5 text-xs border border-[#81D8D0]">
          ${SF.sectionTitle('briefcase', 'Доступно в бизнес-режиме')}
          <div class="text-ink-2 leading-snug">Шаблон становится вашим SI-продавцом в Офисе бизнеса. ${active ? 'Переключитесь на бизнес-профиль — и подключайте.' : 'Бизнес-профиль бесплатный: включите его — и подключайте.'}</div>
          <button onclick="${active ? 'SF.actions.setPersonalMode(false)' : "SF.openIn('profile', 'office')"}" class="w-full py-2.5 rounded-xl btn-3d-tiffany text-xs">${active ? 'Перейти в бизнес-режим' : 'Включить бизнес-профиль'}</button>
        </div>`;
    }
    const writeAuthor = `<button onclick="SF.funnels.contact('${SF.js(f.id)}')" class="w-full py-2 rounded-xl btn-3d-dark text-xs flex items-center justify-center gap-1.5"><i data-lucide="message-circle" class="w-4 h-4"></i> Написать автору</button>`;
    const percent = f.priceType === 'percent';
    const payForm = (title, button) => `
      <div class="glass-card-3d p-4 space-y-2.5 text-xs">
        ${SF.sectionTitle('wallet', title)}
        ${percent ? `
          <div class="text-ink-2 leading-snug">Условия автора: <b>${esc(f.priceLabel)}</b>. Автор будет видеть, сколько клиентов и продаж у вашего SI-продавца на этом шаблоне (без имён клиентов), и договорится с вами об оплате.</div>
          <button onclick="SF.funnels.buy('${SF.js(f.id)}')" class="w-full py-2.5 rounded-xl btn-3d-tiffany text-xs">${button}</button>` : `
          <div class="text-ink-2 leading-snug">1. Оплатите автору по его ссылке — деньги идут ему напрямую.</div>
          ${f.paymentUrl ? `<button onclick="SF.openLink('${SF.js(f.paymentUrl)}')" class="w-full py-2.5 rounded-xl btn-3d-tiffany text-xs flex items-center justify-center gap-1.5"><i data-lucide="external-link" class="w-4 h-4"></i> Оплатить ${esc(f.priceLabel)}</button>` : ''}
          <div class="text-ink-2 leading-snug">2. Напишите, как и когда оплатили, и нажмите «Я оплатил(а)». Автор проверит поступление и подтвердит.</div>
          <input id="buy-note-${esc(f.id)}" maxlength="300" placeholder="Например: Kaspi, 21 ноября, с карты на имя Айгерим" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink text-xs" />
          <button onclick="SF.funnels.buy('${SF.js(f.id)}')" class="w-full py-2.5 rounded-xl btn-3d-dark text-xs">${button}</button>
          `}
        ${writeAuthor}
      </div>`;
    if (!p || p.status === 'declined' || p.status === 'ended') {
      const again = p ? `<div class="glass-card-3d p-3.5 text-xs space-y-1"><div class="font-semibold text-si">${p.status === 'ended' ? 'Автор отключил шаблон' : 'Автор не подтвердил'}</div>${p.reason ? `<div class="text-ink-2">Причина: ${esc(p.reason)}</div>` : ''}</div>` : '';
      return again + payForm(percent ? 'Подключить' : 'Купить', percent ? 'Подключить на этих условиях' : 'Я оплатил(а)');
    }
    if (p.status === 'pending') {
      return `<div class="glass-card-3d p-4 space-y-2 text-xs">
        <div class="font-bold text-brand">${percent ? 'Ждём согласия автора' : 'Ждём, когда автор подтвердит оплату'}</div>
        <div class="text-[11px] text-ink-2">Мы сообщим у Бадди и в Telegram. Обычно это занимает до дня.</div>
        ${writeAuthor}
      </div>`;
    }
    // Active: the month; the bought template becomes a NEW SI-продавец (owner's decision 22 Nov.)
    const material = p.steps.filter(st => st.needsMaterial);
    const month = p.priceType === 'monthly' ? `
      <div class="text-[11px] ${p.expired ? 'text-si' : 'text-ink-2'}">${p.expired ? 'Оплаченный месяц закончился — SI вернулся к вашей методологии.' : `Оплачено до ${fmtDay(p.paidUntil)}. Не продлите — SI сам вернётся к вашей методологии.`}</div>
      ${p.renewalRequested ? '<div class="text-[11px] text-brand">Ждём, когда автор подтвердит оплату следующего месяца.</div>' : `
        <div class="space-y-1.5 pt-1">
          <div class="text-[11px] text-ink-2">Оплатили следующий месяц? ${f.paymentUrl ? `<button onclick="SF.openLink('${SF.js(f.paymentUrl)}')" class="text-brand font-semibold">Ссылка на оплату</button>` : ''}</div>
          <input id="buy-note-${esc(f.id)}" maxlength="300" placeholder="Как и когда оплатили" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink text-xs" />
          <button onclick="SF.funnels.buy('${SF.js(f.id)}')" class="w-full py-2 rounded-xl btn-3d-dark text-[11px]">Я оплатил(а) следующий месяц</button>
        </div>`}` : '';
    const businesses = ((store().data.remote.businesses || {}).businesses) || [];
    const bid = launchDraft.businessId && businesses.some(b => b.id === launchDraft.businessId) ? launchDraft.businessId : (store().currentBusinessId() || (businesses[0] && businesses[0].id) || '');
    const products = (bid && store().data.remote.products[bid]) || [];
    const field = 'w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink';
    const connected = p.connectedTo ? `
      <div class="p-2.5 rounded-xl bg-[#81D8D0]/15 border border-[#81D8D0] space-y-1.5">
        <div class="font-semibold text-ink">Работает в SI-продавце «${esc(p.connectedTo.name)}»</div>
        <button type="button" onclick="SF.openIn('profile', 'office-consultant', { id: '${SF.js(p.connectedTo.projectId)}', tab: 'methodology' })" class="w-full py-2 rounded-xl btn-3d-tiffany text-xs">Открыть продавца и пазл</button>
        <button type="button" onclick="SF.funnels.detach('${SF.js(p.id)}')" class="w-full py-2 rounded-xl btn-3d-dark text-xs">Отключить шаблон</button>
      </div>` : '';
    const connect = p.expired || p.connectedTo ? '' : `
      <form onsubmit="SF.funnels.launch(event, '${SF.js(p.id)}')" class="space-y-2.5">
        <label class="block space-y-1">
          <span class="font-semibold text-ink-2">В каком бизнесе</span>
          <select name="businessId" onchange="SF.funnels.launchField('businessId', this.value, true)" class="${field}">
            ${businesses.map(b => `<option value="${esc(b.id)}" ${b.id === bid ? 'selected' : ''}>${esc(b.name || 'Мой бизнес')}</option>`).join('')}
          </select>
        </label>
        <label class="block space-y-1">
          <span class="font-semibold text-ink-2">Какой продукт он продаёт</span>
          <select name="productId" class="${field}">
            <option value="">Выберу потом</option>
            ${products.map(pr => `<option value="${esc(pr.id)}" ${pr.id === launchDraft.productId ? 'selected' : ''}>${esc(pr.name)}${pr.priceLabel ? ` · ${esc(pr.priceLabel)}` : ''}</option>`).join('')}
          </select>
        </label>
        <label class="block space-y-1">
          <span class="font-semibold text-ink-2">Имя SI-продавца</span>
          <input name="name" maxlength="80" value="${esc(launchDraft.name || f.title)}" class="${field}" />
        </label>
        ${material.length ? `<div class="text-[11px] text-ink-2 leading-snug">На этих шагах клиент получает материал — добавьте свой (ссылку или текст). Без него SI просто проведёт шаг словами.</div>
          ${material.map(st => `<label class="block space-y-1"><span class="font-semibold text-ink-2">${esc(st.title)}</span>
            <input name="m_${esc(st.id)}" maxlength="1000" value="${esc((p.materials || {})[st.id] || '')}" placeholder="https://… или текст" class="${field}" /></label>`).join('')}` : ''}
        <label class="flex items-start gap-2.5 p-2.5 rounded-xl bg-sunken border border-line cursor-pointer">
          <input type="checkbox" name="brainAccess" checked class="w-4 h-4 mt-0.5 accent-[#0d9488] flex-shrink-0" />
          <span class="flex items-center gap-1 font-semibold text-ink">Дать шаблону доступ к Мозгу${SF.info('Что уже есть о бизнесе, продукте и в материалах, подставится в пазл само — меньше писать. Автор шаблона ваш Мозг не видит. Можно выключить потом в пазле.')}</span>
        </label>
        <button type="submit" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm">Запустить SI-продавца</button>
      </form>`;
    const nums = p.numbers ? `<div class="text-[11px] text-ink-2">С подключения: новых клиентов ${p.numbers.clients}, продаж ${p.numbers.sales}${percent ? ' — эти же цифры видит автор' : ''}</div>` : '';
    return `
      <div class="glass-card-3d p-4 space-y-2.5 text-xs">
        ${SF.sectionTitle('check-circle', 'Шаблон ваш', '', 'Шаблон станет вашим новым SI-продавцом. Уже созданные работают как раньше.')}
        ${month}
        ${nums}
        ${connected}
        ${connect}
        ${writeAuthor}
      </div>`;
  }

  function plural(n, one, few, many) {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  // ---------------- Publish / change ----------------
  const draft = {};
  function renderPublish(route) {
    const editing = route.id ? cache[`one:${route.id}`] : null;
    if (route.id && !editing) return waiting(`one:${route.id}`);
    const consultants = store().data.office.consultants.filter(c => !c.assisting);
    if (!consultants.length) return SF.emptyState('consultant', 'Сначала создайте SI-продавца', 'Шаблон публикуется из вашего SI-продавца: его шаги и сценарии «если…, то…».');
    const d = draft[route.id || 'new'] || (draft[route.id || 'new'] = editing ? {
      projectId: editing.sourceProjectId, title: editing.title, niche: editing.niche, description: editing.description,
      result: editing.result, priceType: editing.priceType, priceLabel: editing.priceLabel, paymentUrl: editing.paymentUrl || '',
      videoUrl: editing.videoUrl || '', sellerProjectId: editing.sellerProjectId || '', nicheSection: editing.nicheSection || '', faq: editing.faq || []
    } : { projectId: (consultants.find(c => (c.steps || []).length >= 2) || consultants[0]).id, priceType: 'once' });
    // Who sells the template: by default the same SI-продавец it is made from
    const sellerId = d.sellerProjectId === undefined ? (d.projectId || '') : d.sellerProjectId;
    const minSteps = (cache.mine && cache.mine.minSteps) || 2;
    const chosen = consultants.find(c => c.id === d.projectId) || consultants[0];
    const steps = (chosen && chosen.steps) || [];
    const fieldBox = (name, label, opts = {}) => `
      <label class="block space-y-1">
        <span class="font-semibold text-ink-2 flex items-center gap-1">${label}${opts.hint ? SF.info(opts.hint) : ''}</span>
        ${opts.rows
          ? `<textarea name="${name}" rows="${opts.rows}" maxlength="${opts.max}" placeholder="${esc(opts.placeholder || '')}" oninput="SF.funnels.field('${SF.js(route.id || 'new')}', '${name}', this.value)" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink">${esc(d[name] || '')}</textarea>`
          : `<input name="${name}" type="${opts.type || 'text'}" maxlength="${opts.max}" value="${esc(d[name] || '')}" placeholder="${esc(opts.placeholder || '')}" oninput="SF.funnels.field('${SF.js(route.id || 'new')}', '${name}', this.value)" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink" />`}
      </label>`;
    const priceType = PRICE_TYPES.find(p => p.id === d.priceType) || PRICE_TYPES[0];
    return `
      <form onsubmit="SF.funnels.submit(event, '${SF.js(route.id || '')}')" class="space-y-3 text-xs">
        <div class="glass-card-3d p-4 space-y-3">
          ${SF.sectionTitle('bot', 'Из какого SI-продавца')}
          <select name="projectId" onchange="SF.funnels.field('${SF.js(route.id || 'new')}', 'projectId', this.value, true)" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink">
            ${consultants.map(c => `<option value="${esc(c.id)}" ${c.id === (chosen && chosen.id) ? 'selected' : ''}>${esc(c.name)} · шагов: ${(c.steps || []).length}</option>`).join('')}
          </select>
          ${steps.length >= minSteps
            ? `<div class="text-[11px] text-muted leading-snug">Эксперты увидят шаги: ${steps.map(st => esc(st.title)).join(' → ')}</div>`
            : `<div class="text-[11px] text-si leading-snug">В этом SI-продавце ${steps.length ? `только ${steps.length} шаг` : 'нет шагов'}. Нужно хотя бы ${minSteps}: Офис → SI-продавец → «Карточка и методология» → шаги воронки.</div>`}
        </div>
        <div class="glass-card-3d p-4 space-y-3">
          ${SF.sectionTitle('file-text', 'Что увидят эксперты')}
          ${fieldBox('title', 'Название', { max: 80, placeholder: 'Например: Запись на консультацию за 3 шага' })}
          ${SF.niches.field({ value: d.niche || '', section: d.nicheSection || '', label: 'Ниша', hint: 'По нише эксперты находят шаблон. Начните писать — появятся подсказки; нет вашей — создастся сама.',
            onName: `SF.funnels.field('${SF.js(route.id || 'new')}', 'niche', this.value)`, onSection: `SF.funnels.field('${SF.js(route.id || 'new')}', 'nicheSection', this.value)` })}
          ${fieldBox('description', 'Описание: кому подходит и кому нет, как ведёт клиента', { rows: 4, max: 1500, placeholder: 'Кому подходит шаблон и кому нет, как SI ведёт клиента, что внутри' })}
          ${fieldBox('result', 'Результат для эксперта', { rows: 3, max: 600, placeholder: 'Что получит эксперт. Только честные обещания — без цифр, которых вы не можете подтвердить', hint: 'Нечестное обещание — повод для жалобы, и команда снимет шаблон.' })}
          <div class="space-y-1.5">
            <div class="font-semibold text-ink-2">Вопросы и ответы</div>
            ${SF.niches.faqEditor(d.faq || [])}
          </div>
          ${fieldBox('videoUrl', 'Видео-презентация (необязательно)', { type: 'url', max: 300, placeholder: 'https://… YouTube, Instagram, Google Drive' })}
        </div>
        <div class="glass-card-3d p-4 space-y-3">
          ${SF.sectionTitle('message-circle', 'Кто продаёт шаблон', '', 'Эксперты переписываются с этим SI-продавцом до покупки. Это может быть этот же продавец, другой ваш — созданный для шаблона или купленный в Маркетплейсе. Шаблон сам появится в Мозге этого бизнеса продуктом.')}
          <select name="sellerProjectId" onchange="SF.funnels.field('${SF.js(route.id || 'new')}', 'sellerProjectId', this.value)" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink">
            ${consultants.map(c => `<option value="${esc(c.id)}" ${c.id === sellerId ? 'selected' : ''}>${esc(c.name)}${c.id === d.projectId ? ' (этот же)' : ''}</option>`).join('')}
            <option value="none" ${sellerId === 'none' || (!sellerId && editing) ? 'selected' : ''}>Без переписки</option>
          </select>
        </div>
        <div class="glass-card-3d p-4 space-y-3">
          ${SF.sectionTitle('wallet', 'Как вам платят')}
          <div class="space-y-1.5">
            ${PRICE_TYPES.map(p => `
              <label class="flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer ${p.id === priceType.id ? 'bg-[#81D8D0]/15 border-[#81D8D0]' : 'bg-sunken border-line'}">
                <input type="radio" name="priceType" value="${p.id}" ${p.id === priceType.id ? 'checked' : ''} onchange="SF.funnels.field('${SF.js(route.id || 'new')}', 'priceType', this.value, true)" class="mt-0.5" />
                <span class="font-semibold text-ink">${p.label}</span>
              </label>`).join('')}
          </div>
          ${fieldBox('priceLabel', priceType.id === 'percent' ? 'Процент' : 'Цена', { max: 60, placeholder: priceType.placeholder })}
          ${fieldBox('paymentUrl', priceType.id === 'percent' ? 'Ваша ссылка на оплату (необязательно)' : 'Ваша ссылка на оплату', { type: 'url', max: 300, placeholder: 'https://...', hint: 'Деньги идут вам напрямую. Оплату подтверждаете вы — пока SmartFlow не подключит свой приём платежей.' })}
        </div>
        <button type="submit" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm">${editing ? 'Сохранить' : 'Опубликовать'}</button>
      </form>`;
  }

  // ---------------- Actions ----------------
  async function submit(event, id) {
    event.preventDefault();
    const d = { ...(draft[id || 'new'] || {}) };
    const form = new FormData(event.target);
    for (const k of ['projectId', 'title', 'description', 'result', 'priceType', 'priceLabel', 'paymentUrl', 'videoUrl', 'sellerProjectId', 'nicheSection']) {
      if (form.has(k)) d[k] = String(form.get(k) || '').trim();
    }
    if (form.has('nicheName')) d.niche = String(form.get('nicheName') || '').trim();
    d.faq = SF.niches.readFaq(event.target);
    const button = event.target.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      const res = id ? await api().readyFunnels.update(id, d) : await api().readyFunnels.submit(d);
      delete draft[id || 'new'];
      refresh();
      SF.data.invalidate('niches');
      showToast(id ? 'Сохранено' : 'Шаблон опубликован — он уже в Маркетплейсе → «Шаблоны ИИ-продавцов» 🎉');
      if (!id) SF.confetti();
      store().popRoute();
      if (!id) SF.push('office-funnel', { id: res.funnel.id });
    } catch (err) {
      showToast(err.message || 'Не получилось отправить');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function withdraw(id) {
    if (!window.confirm('Убрать шаблон? Эксперты больше не увидят его в каталоге.')) return;
    try {
      await api().readyFunnels.withdraw(id);
      refresh();
      showToast('Шаблон убран');
      store().popRoute();
    } catch (err) {
      showToast(err.message || 'Не получилось');
    }
  }

  async function buy(funnelId) {
    const input = document.getElementById(`buy-note-${funnelId}`);
    try {
      await api().readyFunnels.buy(funnelId, input ? input.value.trim() : '');
      refresh();
      showToast('Отправили автору — он подтвердит');
    } catch (err) {
      showToast(err.message || 'Не получилось');
    }
  }

  async function decide(pid, decision) {
    const reason = ((document.getElementById(`sale-reason-${pid}`) || {}).value || '').trim();
    if (decision === 'decline' && !reason) {
      showToast('Напишите причину — эксперт её увидит');
      return;
    }
    try {
      await api().readyFunnels.decide(pid, decision, reason);
      refresh();
      showToast(decision === 'confirm' ? 'Подтверждено — эксперт может запустить SI-продавца' : 'Эксперт получит причину');
    } catch (err) {
      showToast(err.message || 'Не получилось');
    }
  }

  async function endPercent(pid) {
    const reason = ((document.getElementById(`sale-reason-${pid}`) || {}).value || '').trim();
    if (!reason) {
      showToast('Напишите причину — эксперт её увидит');
      return;
    }
    if (!window.confirm('Отключить воронку у эксперта? Его SI-продавец вернётся к своей методологии.')) return;
    try {
      await api().readyFunnels.endPercent(pid, reason);
      refresh();
      showToast('Воронка отключена');
    } catch (err) {
      showToast(err.message || 'Не получилось');
    }
  }

  async function apply(event, pid) {
    event.preventDefault();
    const form = new FormData(event.target);
    const materials = {};
    for (const [k, v] of form.entries()) if (k.startsWith('m_')) materials[k.slice(2)] = String(v).trim();
    const button = event.target.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      const projectId = String(form.get('projectId') || '');
      const res = await api().readyFunnels.apply(pid, projectId, materials, form.get('brainAccess') === 'on');
      refresh();
      SF.data.invalidate('office');
      SF.data.invalidate('puzzle:');
      SF.data.officeLists && SF.data.officeLists(true);
      if (res && res.puzzle && !res.released) {
        // The funnel waits for its puzzle: straight to it
        showToast('Подключено. Соберите пазл воронки — и она начнёт продавать 🧩');
        SF.openIn('profile', 'office-consultant', { id: projectId, tab: 'methodology' });
      } else showToast('Готово: SI-продавец ведёт клиентов по воронке');
    } catch (err) {
      showToast(err.message || 'Не получилось подключить');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function launchField(key, value, redraw = false) {
    launchDraft[key] = value;
    if (key === 'businessId' && value) SF.data.products(value);
    if (redraw) store().notify();
  }

  async function launch(event, pid) {
    event.preventDefault();
    const form = new FormData(event.target);
    const materials = {};
    for (const [k, v] of form.entries()) if (k.startsWith('m_')) materials[k.slice(2)] = String(v).trim();
    const button = event.target.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      const businessId = String(form.get('businessId') || '');
      const res = await api().readyFunnels.launch(pid, {
        businessId, productId: String(form.get('productId') || ''),
        name: String(form.get('name') || '').trim(), materials, brainAccess: form.get('brainAccess') === 'on'
      });
      Object.keys(launchDraft).forEach(k => delete launchDraft[k]);
      refresh();
      SF.data.invalidate('office');
      SF.data.invalidate('puzzle:');
      SF.data.myConsultants && SF.data.myConsultants();
      SF.data.officeLists && SF.data.officeLists(true);
      SF.confetti();
      if (businessId) store().setCurrentBusiness(businessId);
      showToast(res.puzzle && !res.released ? 'SI-продавец создан 🎉 Соберите пазл шаблона — и он начнёт продавать' : 'SI-продавец запущен 🎉');
      SF.openIn('profile', 'office-consultant', { id: res.projectId, tab: 'methodology' });
    } catch (err) {
      showToast(err.message || 'Не получилось запустить');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function report(id) {
    const reason = window.prompt('Что не так с шаблоном? Команда проверит и при необходимости снимет его.');
    if (!reason || !reason.trim()) return;
    try {
      await api().readyFunnels.report(id, reason.trim());
      showToast('Жалоба отправлена команде. Спасибо!');
    } catch (err) {
      showToast(err.message || 'Не получилось');
    }
  }

  async function detach(pid) {
    if (!window.confirm('Отключить шаблон? SI-продавец вернётся к вашей методологии.')) return;
    try {
      await api().readyFunnels.detach(pid);
      refresh();
      SF.data.invalidate('office');
      SF.data.officeLists && SF.data.officeLists(true);
      showToast('Отключено — SI работает по вашей методологии');
    } catch (err) {
      showToast(err.message || 'Не получилось');
    }
  }

  function contact(id) {
    const f = cache[`one:${id}`];
    if (!f) return;
    SF.openIn('chats', 'person', { id: f.author.id });
  }

  function search(event) {
    event.preventDefault();
    SF.patch({ q: String(new FormData(event.target).get('q') || '').trim() });
  }

  // Typing keeps the draft without re-drawing; switching the SI-seller or the payment re-draws
  function field(key, name, value, redraw = false) {
    (draft[key] || (draft[key] = {}))[name] = value;
    if (redraw) store().notify();
  }

  // A block under the methodology of one's own SI-seller
  function consultantBlock(c) {
    if (!SF.feature('funnels') || c.assisting) return '';
    return `
      <div class="glass-card-3d p-3.5 flex items-center gap-3 text-xs">
        <i data-lucide="share-2" class="w-5 h-5 text-brand flex-shrink-0"></i>
        <span class="flex-1 text-ink-2 leading-snug">Хорошо работает? Опубликуйте этого SI-продавца шаблоном для других экспертов — за свою цену.</span>
        <button onclick="SF.funnels.publishFrom('${SF.js(c.id)}')" class="px-3 py-2 rounded-xl btn-3d-dark text-[11px] flex-shrink-0">Опубликовать</button>
      </div>`;
  }

  function publishFrom(projectId) {
    draft.new = { ...(draft.new || { priceType: 'once' }), projectId };
    SF.push('office-funnel-publish');
  }

  // The Marketplace tab «Шаблоны ИИ-продавцов» (owner's decision 23 Nov.): only look and buy — creating, my
  // templates and the bought ones are in Настройки → «Мои бизнесы» → Офис
  function catalogInline(route) {
    return renderCatalog(route, { inline: true });
  }

  function loadInline(route) {
    if (!SF.feature('funnels')) return;
    load(catalogKey({ q: route.tq || '', niche: '' }), () => api().readyFunnels.catalogue(route.tq || '', ''));
  }

  function searchInline(event) {
    event.preventDefault();
    SF.patch({ tq: String(new FormData(event.target).get('q') || '').trim() });
  }

  // A row in the Office (list of SI-sellers): bought templates and my own
  function officeEntry() {
    if (!SF.feature('funnels')) return '';
    return `
      <button onclick="SF.push('office-funnels', { view: 'bought' })" class="w-full px-3.5 py-3 flex items-center gap-3 text-left text-sm">
        <i data-lucide="layers" class="w-5 h-5 text-brand"></i>
        <span class="flex-1 font-semibold text-ink">Шаблоны: купленные и мои</span>
        <i data-lucide="chevron-right" class="w-4 h-4 text-faint"></i>
      </button>`;
  }


  const TITLES = {
    'office-funnels': 'Шаблоны ИИ-продавцов',
    'office-funnel': 'Шаблон',
    'office-funnel-publish': 'Опубликовать шаблон'
  };

  SF.funnels = {
    owns: (screen) => Object.prototype.hasOwnProperty.call(TITLES, screen),
    title: (route) => (route.screen === 'office-funnel-publish' && route.id ? 'Изменить шаблон' : TITLES[route.screen]),
    // Seen without a business profile: the catalogue and one template (owner's decision 22 Nov.)
    open: (route) => route.screen === 'office-funnel' || (route.screen === 'office-funnels' && !['mine', 'bought'].includes(route.view)),
    render(route) {
      if (!SF.feature('funnels')) return SF.emptyState('consultant', 'Шаблоны — скоро', 'Мы сообщим, когда они откроются.');
      if (route.screen === 'office-funnels') return renderList(route);
      if (route.screen === 'office-funnel') return renderFunnel(route);
      return renderPublish(route);
    },
    afterRender(route) {
      if (!SF.feature('funnels')) return;
      SF.data.niches();
      const a = api().readyFunnels;
      if (route.screen === 'office-funnels') {
        load('mine', () => a.mine());
        load('purchases', () => a.purchases());
        if (route.view !== 'mine') load(catalogKey({ q: route.q || '', niche: '' }), () => a.catalogue(route.q || '', ''));
      } else if (route.screen === 'office-funnel' || (route.screen === 'office-funnel-publish' && route.id)) {
        load(`one:${route.id}`, async () => (await a.get(route.id)).funnel);
      }
      // The launch form: my businesses and the products of the chosen one
      if (route.screen === 'office-funnel' && store().isBusinessView()) {
        SF.data.businesses();
        const list = ((store().data.remote.businesses || {}).businesses) || [];
        const bid = launchDraft.businessId || store().currentBusinessId() || (list[0] && list[0].id);
        if (bid) SF.data.products(bid);
      }
      if (route.screen === 'office-funnel-publish') load('mine', () => a.mine());
    },
    refresh,
    submit,
    buy,
    decide,
    endPercent,
    apply,
    launch,
    launchField,
    report,
    catalogInline,
    searchInline,
    loadInline,
    detach,
    withdraw,
    contact,
    search,
    field,
    consultantBlock,
    publishFrom,
    officeEntry
  };
})(window);
