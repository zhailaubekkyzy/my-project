// screens/funnels.js - «Готовые воронки» in the Office (flag `funnels`), part 1: the catalogue for
// experts, a funnel's page and publishing one's own funnel (owner's decisions 20–21 Nov.).
// Clients never see this: it lives inside the Office only.
//   office-funnels        — the catalogue («Каталог») and the author's own funnels («Мои воронки»)
//   office-funnel         — one funnel: description, steps, result, price, author
//   office-funnel-publish — publish (or change) a funnel from one's own SI-seller
// Before buying an expert sees the description, the steps and the result — never the marketer's
// instructions and scenario texts (the server does not send them). Buying comes in part 2:
// for now the expert writes to the author inside SmartFlow.

(function (window) {
  const SF = window.SF;
  const showToast = SF.showToast;
  const store = () => window.funnelStore;
  const api = () => window.smartFlowApi;
  const esc = (v) => SF.esc(v);

  const PRICE_TYPES = [
    { id: 'once', label: 'Разовая оплата', hint: 'Эксперт платит один раз', placeholder: 'Например: 15 000 ₸' },
    { id: 'monthly', label: 'Подписка в месяц', hint: 'Эксперт платит каждый месяц, пока пользуется', placeholder: 'Например: 5 000 ₸ в месяц' },
    { id: 'percent', label: 'Процент с продаж', hint: 'Доля от продаж эксперта на вашей воронке', placeholder: 'Например: 10% с продаж' }
  ];
  const STATUS = {
    review: { label: 'На проверке у команды', cls: 'text-brand' },
    published: { label: 'Опубликована', cls: 'text-emerald-500' },
    rejected: { label: 'Не прошла проверку', cls: 'text-si' },
    hidden: { label: 'Снята командой', cls: 'text-si' }
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
        <span class="flex items-center justify-between gap-2 text-[11px]">
          ${mine ? `<span class="font-semibold ${status ? status.cls : 'text-muted'}">${status ? status.label : ''}</span>` : author(f, 22)}
          <span class="text-right">${priceLine(f)}</span>
        </span>
      </button>`;
  }

  // ---------------- Catalogue and «Мои воронки» ----------------
  function renderList(route) {
    const view = route.view === 'mine' ? 'mine' : 'catalog';
    const tabs = `
      <div class="grid grid-cols-2 gap-1 bg-raised p-1.5 rounded-2xl border border-line">
        ${[{ id: 'catalog', label: 'Каталог', icon: 'layout-grid' }, { id: 'mine', label: 'Мои воронки', icon: 'pen-line' }].map(({ id, label, icon }) => `
          <button onclick="SF.patch({ view: '${id}' })" class="py-2 rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1.5 ${view === id ? 'bg-[#81D8D0] text-[#08302c] shadow' : 'text-muted'}">
            <i data-lucide="${icon}" class="w-4 h-4"></i>${label}</button>`).join('')}
      </div>`;
    return tabs + (view === 'mine' ? renderMine() : renderCatalog(route));
  }

  function catalogKey(route) {
    return `catalog:${route.q || ''}|${route.niche || ''}`;
  }

  function renderCatalog(route) {
    const key = catalogKey(route);
    const data = cache[key];
    const intro = `<div class="text-[11px] text-muted px-1 leading-snug">Воронки от маркетологов: как SI-продавец ведёт клиента к покупке. Каждую проверила команда SmartFlow. До покупки видно описание, шаги и результат.</div>`;
    const search = `
      <form onsubmit="SF.funnels.search(event)" class="flex gap-2">
        <input name="q" value="${esc(route.q || '')}" autocomplete="off" placeholder="Ниша или задача: нутрициолог, запись…" class="flex-1 p-2.5 rounded-xl bg-sunken border border-line-2 text-ink text-xs" />
        <button type="submit" class="px-3 rounded-xl btn-3d-tiffany text-xs" aria-label="Найти"><i data-lucide="search" class="w-4 h-4"></i></button>
      </form>`;
    if (!data) return intro + search + waiting(key);
    const niches = data.niches || [];
    const chips = niches.length > 1 ? `
      <div class="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        ${[['', 'Все'], ...niches.map(n => [n, n])].map(([value, label]) => `
          <button onclick="SF.patch({ niche: '${SF.js(value)}' })" class="px-3 py-1.5 rounded-full text-[11px] whitespace-nowrap border ${(route.niche || '') === value ? 'bg-[#81D8D0] text-[#08302c] border-[#81D8D0]' : 'bg-card text-ink-2 border-line'}">${esc(label)}</button>`).join('')}
      </div>` : '';
    const list = data.funnels.length
      ? data.funnels.map(f => funnelCard(f)).join('')
      : SF.emptyState('consultant', route.q || route.niche ? 'Ничего не нашлось' : 'Готовых воронок пока нет',
        route.q || route.niche ? 'Попробуйте другое слово или уберите фильтр.' : 'Здесь появятся воронки маркетологов после проверки командой. А пока — «Быстрый старт» при создании SI-продавца.');
    return `${intro}${search}${chips}<div class="space-y-2.5">${list}</div>`;
  }

  function renderMine() {
    const data = cache.mine;
    const consultants = store().data.office.consultants.filter(c => !c.assisting);
    const publish = consultants.length
      ? `<button onclick="SF.push('office-funnel-publish')" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm flex items-center justify-center gap-1.5"><i data-lucide="upload" class="w-4 h-4"></i> Опубликовать воронку</button>`
      : `<div class="text-[11px] text-muted px-1">Чтобы опубликовать воронку, сначала создайте SI-продавца и соберите в нём шаги и сценарии.</div>`;
    const how = `
      <div class="glass-card-3d p-3.5 space-y-1.5 text-[11px] text-ink-2 leading-snug">
        <div class="text-xs font-bold text-ink">Как это работает</div>
        <div>1. Соберите воронку в своём SI-продавце: шаги, сценарии «если…, то…», общее описание.</div>
        <div>2. Опубликуйте: название, ниша, что внутри, результат и как вам платят.</div>
        <div>3. Команда SmartFlow проверит воронку на безопасность — обычно в течение дня.</div>
        <div>4. Эксперты увидят описание, шаги и результат. Ваши инструкции и тексты сценариев они не видят.</div>
      </div>`;
    if (!data) return publish + how + waiting('mine');
    const list = data.funnels.length ? data.funnels.map(f => funnelCard(f, { mine: true })).join('') : '';
    return `${publish}${list ? `<div class="space-y-2.5">${list}</div>` : ''}${how}`;
  }

  // ---------------- One funnel ----------------
  function renderFunnel(route) {
    const key = `one:${route.id}`;
    const f = cache[key];
    if (!f) return waiting(key);
    const mine = f.status !== undefined;
    const status = mine && STATUS[f.status];
    const ownerBlock = mine ? `
      <div class="glass-card-3d p-3.5 space-y-2 text-xs">
        <div class="font-bold ${status ? status.cls : 'text-ink'}">${status ? status.label : ''}</div>
        ${f.reviewNote ? `<div class="p-2.5 rounded-xl bg-sunken border border-line text-ink-2 leading-snug"><span class="text-muted">Команда:</span> ${esc(f.reviewNote)}</div>` : ''}
        ${f.status === 'review' ? '<div class="text-[11px] text-muted">Пока воронка на проверке, эксперты её не видят. Мы сообщим о решении у Бадди и в Telegram.</div>' : ''}
        <div class="grid grid-cols-2 gap-2">
          <button onclick="SF.push('office-funnel-publish', { id: '${SF.js(f.id)}' })" class="py-2.5 rounded-xl btn-3d-tiffany text-xs">Изменить</button>
          <button onclick="SF.funnels.withdraw('${SF.js(f.id)}')" class="py-2.5 rounded-xl btn-3d-dark text-xs">Убрать</button>
        </div>
        <div class="text-[10px] text-faint">После изменения воронка снова уходит на проверку.</div>
      </div>` : '';
    const contact = mine ? '' : `
      <div class="glass-card-3d p-3.5 space-y-2 text-xs">
        <div class="text-ink-2 leading-snug">Покупка воронки прямо в SmartFlow — скоро. Пока напишите автору здесь, в SmartFlow: он расскажет подробнее и пришлёт ссылку на оплату.</div>
        <button onclick="SF.funnels.contact('${SF.js(f.id)}')" class="w-full py-2.5 rounded-xl btn-3d-tiffany text-xs flex items-center justify-center gap-1.5"><i data-lucide="message-circle" class="w-4 h-4"></i> Написать автору</button>
      </div>`;
    return `
      ${ownerBlock}
      <div class="glass-card-3d p-4 space-y-3">
        <div class="space-y-1">
          <div class="text-[10px] uppercase tracking-wider text-muted">${esc(f.niche)}</div>
          <div class="text-base font-bold text-ink leading-snug">${esc(f.title)}</div>
        </div>
        ${author(f, 32)}
        <div class="text-xs text-ink-2 leading-relaxed whitespace-pre-line">${esc(f.description)}</div>
      </div>
      <div class="glass-card-3d p-4 space-y-3">
        ${SF.sectionTitle('footprints', `Шаги воронки · ${f.steps.length}`)}
        ${stepsList(f.steps)}
        ${f.scenarioCount ? `<div class="text-[11px] text-muted">И ещё ${f.scenarioCount} ${plural(f.scenarioCount, 'сценарий', 'сценария', 'сценариев')} «если…, то…»: что делать при возражении, молчании и других ситуациях.</div>` : ''}
      </div>
      <div class="glass-card-3d p-4 space-y-2">
        ${SF.sectionTitle('target', 'Результат')}
        <div class="text-xs text-ink-2 leading-relaxed whitespace-pre-line">${esc(f.result)}</div>
        <div class="text-[10px] text-faint">Так описывает автор; команда SmartFlow проверила, что обещания честные.</div>
      </div>
      <div class="glass-card-3d p-4 flex items-center justify-between gap-2 text-xs">
        <span class="text-muted">Стоимость</span><span class="text-right">${priceLine(f)}</span>
      </div>
      ${contact}
    `;
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
    if (!consultants.length) return SF.emptyState('consultant', 'Сначала создайте SI-продавца', 'Воронка публикуется из вашего SI-продавца: его шаги и сценарии «если…, то…».');
    const d = draft[route.id || 'new'] || (draft[route.id || 'new'] = editing ? {
      projectId: editing.sourceProjectId, title: editing.title, niche: editing.niche, description: editing.description,
      result: editing.result, priceType: editing.priceType, priceLabel: editing.priceLabel, paymentUrl: editing.paymentUrl || ''
    } : { projectId: (consultants.find(c => (c.steps || []).length >= 2) || consultants[0]).id, priceType: 'once' });
    const minSteps = (cache.mine && cache.mine.minSteps) || 2;
    const chosen = consultants.find(c => c.id === d.projectId) || consultants[0];
    const steps = (chosen && chosen.steps) || [];
    const fieldBox = (name, label, opts = {}) => `
      <label class="block space-y-1">
        <span class="font-semibold text-ink-2">${label}</span>
        ${opts.rows
          ? `<textarea name="${name}" rows="${opts.rows}" maxlength="${opts.max}" placeholder="${esc(opts.placeholder || '')}" oninput="SF.funnels.field('${SF.js(route.id || 'new')}', '${name}', this.value)" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink">${esc(d[name] || '')}</textarea>`
          : `<input name="${name}" type="${opts.type || 'text'}" maxlength="${opts.max}" value="${esc(d[name] || '')}" placeholder="${esc(opts.placeholder || '')}" oninput="SF.funnels.field('${SF.js(route.id || 'new')}', '${name}', this.value)" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink" />`}
        ${opts.hint ? `<span class="block text-[10px] text-faint">${opts.hint}</span>` : ''}
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
          ${fieldBox('niche', 'Ниша', { max: 60, placeholder: 'Например: Нутрициология' })}
          ${fieldBox('description', 'Описание: что это и как ведёт клиента', { rows: 4, max: 1500, placeholder: 'Для кого воронка, как SI ведёт клиента, что внутри' })}
          ${fieldBox('result', 'Результат для эксперта', { rows: 3, max: 600, placeholder: 'Что получит эксперт. Только честные обещания — без цифр, которых вы не можете подтвердить', hint: 'Команда проверяет, что обещания честные.' })}
        </div>
        <div class="glass-card-3d p-4 space-y-3">
          ${SF.sectionTitle('wallet', 'Как вам платят')}
          <div class="space-y-1.5">
            ${PRICE_TYPES.map(p => `
              <label class="flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer ${p.id === priceType.id ? 'bg-[#81D8D0]/15 border-[#81D8D0]' : 'bg-sunken border-line'}">
                <input type="radio" name="priceType" value="${p.id}" ${p.id === priceType.id ? 'checked' : ''} onchange="SF.funnels.field('${SF.js(route.id || 'new')}', 'priceType', this.value, true)" class="mt-0.5" />
                <span><span class="block font-semibold text-ink">${p.label}</span><span class="block text-[10px] text-muted">${p.hint}</span></span>
              </label>`).join('')}
          </div>
          ${fieldBox('priceLabel', priceType.id === 'percent' ? 'Процент' : 'Цена', { max: 60, placeholder: priceType.placeholder })}
          ${fieldBox('paymentUrl', priceType.id === 'percent' ? 'Ваша ссылка на оплату (необязательно)' : 'Ваша ссылка на оплату', { type: 'url', max: 300, placeholder: 'https://...', hint: 'Деньги идут вам напрямую. Оплату подтверждаете вы — пока SmartFlow не подключит свой приём платежей.' })}
        </div>
        <div class="text-[11px] text-muted px-1 leading-snug">Перед публикацией воронку проверит команда SmartFlow. Ваши инструкции и тексты сценариев эксперты до покупки не видят.</div>
        <button type="submit" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm">${editing ? 'Сохранить и отправить на проверку' : 'Отправить на проверку'}</button>
      </form>`;
  }

  // ---------------- Actions ----------------
  async function submit(event, id) {
    event.preventDefault();
    const d = { ...(draft[id || 'new'] || {}) };
    const form = new FormData(event.target);
    for (const k of ['projectId', 'title', 'niche', 'description', 'result', 'priceType', 'priceLabel', 'paymentUrl']) {
      if (form.has(k)) d[k] = String(form.get(k) || '').trim();
    }
    const button = event.target.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      const res = id ? await api().readyFunnels.update(id, d) : await api().readyFunnels.submit(d);
      delete draft[id || 'new'];
      refresh();
      showToast('Отправлено на проверку команде SmartFlow');
      store().popRoute();
      if (!id) SF.push('office-funnel', { id: res.funnel.id });
    } catch (err) {
      showToast(err.message || 'Не получилось отправить');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function withdraw(id) {
    if (!window.confirm('Убрать воронку? Эксперты больше не увидят её в каталоге.')) return;
    try {
      await api().readyFunnels.withdraw(id);
      refresh();
      showToast('Воронка убрана');
      store().popRoute();
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
        <span class="flex-1 text-ink-2 leading-snug">Хорошо работает? Опубликуйте эту воронку для других экспертов — за свою цену.</span>
        <button onclick="SF.funnels.publishFrom('${SF.js(c.id)}')" class="px-3 py-2 rounded-xl btn-3d-dark text-[11px] flex-shrink-0">Опубликовать</button>
      </div>`;
  }

  function publishFrom(projectId) {
    draft.new = { ...(draft.new || { priceType: 'once' }), projectId };
    SF.push('office-funnel-publish');
  }

  // An entry in the Office (list of SI-sellers)
  function officeEntry() {
    if (!SF.feature('funnels')) return '';
    return `
      <button onclick="SF.push('office-funnels')" class="w-full glass-card-3d p-3.5 text-left flex items-center gap-3">
        <span class="w-10 h-10 rounded-2xl bg-sunken border border-line flex items-center justify-center flex-shrink-0"><i data-lucide="layers" class="w-5 h-5 text-brand"></i></span>
        <span class="flex-1 min-w-0">
          <span class="block text-sm font-bold text-ink">Готовые воронки</span>
          <span class="block text-[11px] text-muted leading-snug">От маркетологов, проверены командой. Или опубликуйте свою</span>
        </span>
        <i data-lucide="chevron-right" class="w-4 h-4 text-faint"></i>
      </button>`;
  }

  const TITLES = {
    'office-funnels': 'Готовые воронки',
    'office-funnel': 'Воронка',
    'office-funnel-publish': 'Опубликовать воронку'
  };

  SF.funnels = {
    owns: (screen) => Object.prototype.hasOwnProperty.call(TITLES, screen),
    title: (route) => (route.screen === 'office-funnel-publish' && route.id ? 'Изменить воронку' : TITLES[route.screen]),
    render(route) {
      if (!SF.feature('funnels')) return SF.emptyState('consultant', 'Готовые воронки — скоро', 'Мы сообщим, когда они откроются.');
      if (route.screen === 'office-funnels') return renderList(route);
      if (route.screen === 'office-funnel') return renderFunnel(route);
      return renderPublish(route);
    },
    afterRender(route) {
      if (!SF.feature('funnels')) return;
      const a = api().readyFunnels;
      if (route.screen === 'office-funnels') {
        load('mine', () => a.mine());
        if (route.view !== 'mine') load(catalogKey(route), () => a.catalogue(route.q || '', route.niche || ''));
      } else if (route.screen === 'office-funnel' || (route.screen === 'office-funnel-publish' && route.id)) {
        load(`one:${route.id}`, async () => (await a.get(route.id)).funnel);
      }
      if (route.screen === 'office-funnel-publish') load('mine', () => a.mine());
    },
    refresh,
    submit,
    withdraw,
    contact,
    search,
    field,
    consultantBlock,
    publishFrom,
    officeEntry
  };
})(window);
