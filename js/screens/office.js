// screens/office.js - Office (business profile) inside the Marketplace tab. Real data only.
// Sections: Мои SI-продавцы · Воронка · Календарь · Мой SI-мозг (материалы, по которым отвечает SI) · Мне написали · Помощник.
// Each SI-consultant has four tabs: Карточка и методология · Аналитика · Клиенты · Рассылки.
// The assistant of a business sees its SI-sellers with clients, the funnel and "Мне написали" only: no money,
// payment links, SI-brain or settings (the server checks this too).

(function (window) {
  const SF = window.SF;
  const showToast = SF.showToast;

  // «Бизнес-режим 2.0» (owner's decisions 22 Nov.): the Office of one business — Мозг · Мои SI-продавцы · Помощник.
  // The funnel, «Мне написали», the calendar and analytics live inside each SI-продавец (each has its own goal).
  const SECTIONS = [
    { id: 'brain', label: 'Мозг', icon: 'brain' },
    { id: 'consultants', label: 'Мои SI-продавцы', icon: 'bot' },
    { id: 'team', label: 'Помощник', icon: 'user-plus' }
  ];
  const ASSISTANT_SECTIONS = ['consultants'];

  // Funnel: 5 statuses (names chosen by the owner), colors: waiting — bright, bought — green, refused — gray
  const FUNNEL = [
    { id: 'waiting_human', label: 'Ждут человека', cls: 'bg-[#81D8D0] text-[#08302c] border-[#81D8D0]' },
    { id: 'objections', label: 'Есть возражения', cls: 'bg-amber-500/10 text-amber-500 border-amber-500/30' },
    { id: 'not_finished', label: 'Не дошли до конца воронки', cls: 'bg-sunken text-ink-2 border-line' },
    { id: 'bought', label: 'Купили', cls: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' },
    { id: 'refused', label: 'Отказ', cls: 'bg-sunken text-faint border-line' }
  ];
  const FUNNEL_DAYS = [{ id: '7', label: '7 дней' }, { id: '30', label: '30 дней' }, { id: 'all', label: 'Всё время' }];
  const funnelOf = (status) => FUNNEL.find(f => f.id === status) || FUNNEL[2];

  // "Если…, то…" scenarios in the methodology (the server keeps only these values)
  const SCENARIO_WHEN = {
    objection: 'Клиент возразил',
    offer_answered: 'Клиент ответил на оффер',
    buy_clicked: 'Клиент нажал «Купить»',
    receipt_sent: 'Клиент прислал чек',
    refused: 'Клиент отказался',
    silent: 'Клиент замолчал (догоняющее сообщение)',
    custom: 'Своё условие (напишу словами)',
    step_reached: 'Клиент перешёл на шаг'
  };
  // Steps of the funnel: the client's path the expert builds (the server keeps up to 8)
  const MAX_STEPS = 8;
  // The funnel is a tree: after what the client went silent
  const SILENT_AFTER = {
    any: 'в любой момент разговора',
    offer: 'после оффера',
    objection: 'после возражения',
    buy_clicked: 'после «Купить», но без чека'
  };
  function minutesLabel(m) {
    m = Number(m) || 0;
    if (m >= 1440 && m % 1440 === 0) return `${m / 1440} дн.`;
    if (m >= 60 && m % 60 === 0) return `${m / 60} ч`;
    return `${m} мин`;
  }
  const MAX_SCENARIOS = 20;
  const SCENARIO_THEN = {
    si_says: 'SI отвечает так',
    send_text: 'Отправить клиенту мой текст или ссылку',
    handover: 'Передать человеку (SI на паузу)',
    notify: 'Сообщить мне в SmartFlow'
  };

  // Inside an SI-продавец (owner's order): its funnel and numbers · its clients (Мне написали, all, calendar) ·
  // broadcasts · the card and methodology
  const CONSULTANT_TABS = [
    { id: 'analytics', label: 'Аналитика', icon: 'trending-up' },
    { id: 'income', label: 'Клиенты', icon: 'users' },
    { id: 'broadcasts', label: 'Рассылки', icon: 'send-horizontal' },
    { id: 'methodology', label: 'Методология', icon: 'git-branch' }
  ];
  const CLIENT_TABS = [['inbox', 'Мне написали'], ['all', 'Все клиенты'], ['calendar', 'Календарь']];

  const ROLE_SUGGESTIONS = ['SI-продавец', 'SI-консультант', 'SI-помощник', 'SI-ассистент', 'SI-менеджер'];

  const store = () => window.funnelStore;
  const api = () => window.smartFlowApi;

  function roleWithSi(value) {
    const title = String(value || '').trim();
    if (!title) return 'SI-консультант';
    if (/^SI(\b|-)/i.test(title)) return 'SI' + title.slice(2);
    return `SI-${title.charAt(0).toLowerCase()}${title.slice(1)}`;
  }

  const isWebUrl = (url) => /^https?:\/\/[^\s<>"']+$/i.test(url);

  function timeLabel(value) {
    if (!value) return '';
    const d = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') || String(value).includes('+') ? '' : 'Z'));
    if (isNaN(d)) return '';
    return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function field(name, label, value, { placeholder = '', rows = 0, max = 200, type = 'text', hint = '' } = {}) {
    return `
      <label class="block space-y-1">
        <span class="font-semibold text-ink-2">${label}</span>
        ${rows
          ? `<textarea name="${name}" rows="${rows}" maxlength="${max}" placeholder="${placeholder}" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink">${SF.esc(value)}</textarea>`
          : `<input name="${name}" type="${type}" maxlength="${max}" value="${SF.esc(value)}" placeholder="${placeholder}" ${type === 'url' ? 'inputmode="url"' : ''} class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink" />`}
        ${hint ? `<span class="block text-[10px] text-faint">${hint}</span>` : ''}
      </label>`;
  }

  const myUserId = () => store().data.auth.internalUserId;
  // The Office as the assistant only (no own business profile yet)
  const assistantOnly = () => !store().isBusinessActive() && store().isAssistant();

  function needServer() {
    if (SF.data.signedIn()) return false;
    showToast('Нет связи с сервером. Откройте приложение в Telegram');
    return true;
  }

  // ---------------- Terms before the Office opens ----------------
  function renderTerms() {
    const terms = [
      ['terms', 'Правила платформы SmartFlow', 'SI-продавцы отвечают только по моим данным и не обещают того, чего нет в методологии.'],
      ['data', 'Данные моих клиентов', 'Переписки хранятся в SmartFlow; рассылки — только после моего подтверждения.'],
      ['payments', 'Оплата напрямую — пока', 'Сейчас клиенты платят мне напрямую по моей ссылке. Когда SmartFlow подключит приём платежей, все оплаты моих клиентов будут идти только через SmartFlow, а оплаты в обход платформы SmartFlow будет блокировать.']
    ];
    return `
      <div class="glass-card-3d p-4 space-y-3">
        <div class="flex items-center gap-3">
          <img src="${SF.MASCOTS.consultant}" alt="" class="w-14 h-14" />
          <div>
            <div class="text-base font-extrabold text-ink">Бизнес-профиль</div>
            <div class="text-xs text-muted">Офис: ваши SI-продавцы и личные обращения клиентов.</div>
          </div>
        </div>
        <form onsubmit="SF.actions.activateBusiness(event)" class="space-y-2">
          ${terms.map(([id, title, text]) => `
            <label class="flex gap-2.5 p-3 rounded-xl bg-sunken border border-line cursor-pointer">
              <input type="checkbox" name="${id}" required class="mt-0.5 w-4 h-4 accent-[#0d9488]" />
              <span>
                <span class="block text-xs font-bold text-ink">${title}</span>
                <span class="block text-[11px] text-muted leading-snug">${text}</span>
              </span>
            </label>`).join('')}
          <button type="submit" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm">Согласен(на), открыть Офис</button>
        </form>
      </div>
    `;
  }

  // ---------------- Office home ----------------
  function renderOffice(route, state) {
    if (!store().isBusinessActive() && (!store().isAssistant() || route.next === 'create')) return renderTerms();
    const sections = assistantOnly() ? SECTIONS.filter(s => ASSISTANT_SECTIONS.includes(s.id)) : SECTIONS;
    const section = sections.some(s => s.id === route.section) ? route.section : 'consultants';
    const waitingOf = (ids) => SF.data.waitingInquiries(state).filter(i => ids.has(i.consultant.id)).length;
    const waiting = waitingOf(new Set(store().consultantsOfCurrent().map(c => c.id)));
    let body = '';
    if (section === 'consultants') body = renderConsultantList(state);
    if (section === 'brain') body = renderBrainSection(state);
    if (section === 'team') body = renderTeam(state);
    const business = store().currentBusiness();
    const many = ((state.remote.businesses && state.remote.businesses.businesses) || []).length > 1;
    return `
      ${business && !assistantOnly() ? `
        <button onclick="SF.go('profile')" class="w-full p-3 rounded-2xl bg-card border border-line flex items-center gap-2.5 text-left">
          <span class="w-9 h-9 rounded-xl bg-[#81D8D0]/20 text-brand flex items-center justify-center flex-shrink-0"><i data-lucide="briefcase" class="w-4 h-4"></i></span>
          <span class="flex-1 min-w-0">
            <span class="block text-sm font-bold text-ink truncate">${SF.esc(business.name || 'Мой бизнес')}</span>
            <span class="block text-[10px] text-muted">${many ? 'Сменить бизнес — в Профиле' : 'Бизнесы — в Профиле, до 3'}</span>
          </span>
          <i data-lucide="chevron-right" class="w-4 h-4 text-faint"></i>
        </button>` : ''}
      ${sections.length > 1 ? `
        <div class="grid grid-cols-3 gap-1 bg-raised p-1.5 rounded-2xl border border-line">
          ${sections.map(s => `
            <button onclick="SF.patch({ section: '${s.id}' })" class="relative py-2 rounded-xl text-[10px] font-semibold flex flex-col items-center gap-1 ${section === s.id ? 'bg-[#81D8D0] text-[#08302c] shadow' : 'text-muted'}">
              <i data-lucide="${s.icon}" class="w-4 h-4"></i>${s.label}
              ${s.id === 'consultants' && waiting ? `<span class="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">${waiting}</span>` : ''}
            </button>`).join('')}
        </div>` : ''}
      ${body}
    `;
  }

  // ---------------- Мозг: the business, its products, materials ----------------
  function renderBrainSection(state) {
    const b = store().currentBusiness();
    const products = b ? state.remote.products[b.id] : [];
    return `
      ${b ? `
        <div class="glass-card-3d p-4 space-y-2">
          <div class="flex items-center justify-between gap-2">
            ${SF.sectionTitle('briefcase', 'О бизнесе')}
            <button onclick="SF.actions.editBusiness('${SF.js(b.id)}'); SF.go('profile')" class="px-2.5 py-1 rounded-lg btn-3d-dark text-[11px]">Изменить</button>
          </div>
          <div class="text-sm font-bold text-ink">${SF.esc(b.name || 'Мой бизнес')}${b.niche ? ` <span class="text-[11px] font-normal text-muted">· ${SF.esc(b.niche)}</span>` : ''}</div>
          ${b.about ? `<div class="text-xs text-ink-2 leading-relaxed whitespace-pre-line">${SF.esc(b.about)}</div>` : '<div class="text-xs text-muted leading-snug">Расскажите в двух словах, что вы делаете и для кого — это узнают все SI-продавцы бизнеса.</div>'}
        </div>
        <div class="glass-card-3d p-4 space-y-2.5">
          ${SF.sectionTitle('shopping-bag', 'Продукты')}
          <p class="text-[11px] text-muted leading-snug">Опишите продукт один раз: что получает клиент, результат, цену, рассрочку. SI-продавец, привязанный к продукту, возьмёт отсюда всё, чего нет в его карточке.</p>
          ${!products ? '<div class="text-xs text-muted">Загружаю…</div>' : ''}
          ${(products || []).map(p => `
            <button onclick="SF.push('office-product', { businessId: '${SF.js(b.id)}', id: '${SF.js(p.id)}' })" class="w-full p-3 rounded-xl bg-card border border-line flex items-center gap-2.5 text-left">
              <span class="flex-1 min-w-0">
                <span class="block text-xs font-bold text-ink truncate">${SF.esc(p.name)}</span>
                <span class="block text-[10px] text-muted truncate">${SF.esc(productPrice(p))}${p.format ? ` · ${SF.esc(p.format)}` : ''}</span>
              </span>
              <i data-lucide="chevron-right" class="w-4 h-4 text-faint"></i>
            </button>`).join('')}
          <button onclick="SF.push('office-product', { businessId: '${SF.js(b.id)}' })" class="w-full py-2.5 rounded-xl btn-3d-tiffany text-xs flex items-center justify-center gap-1.5"><i data-lucide="plus" class="w-3.5 h-3.5"></i>Добавить продукт</button>
        </div>` : ''}
      ${renderBrain(state)}
    `;
  }

  const productPrice = (p) => (p.priceMode === 'free' ? 'Бесплатно' : p.priceMode === 'on_request' ? 'Цена по запросу' : (p.priceLabel || 'Цена не указана'));

  // A product of the business: one form for a new one and for changes
  function renderProduct(route, state) {
    const list = state.remote.products[route.businessId];
    if (route.id && !list) return '<div class="text-xs text-muted">Загружаю…</div>';
    const p = route.id ? (list || []).find(x => x.id === route.id) : null;
    if (route.id && !p) return SF.emptyState('assistant', 'Продукт не найден', 'Возможно, он в архиве.');
    const v = p || { name: '', description: '', result: '', format: '', duration: '', priceMode: 'fixed', priceLabel: '', installment: '', guarantee: '', paymentUrl: '', accessUrl: '' };
    return `
      <form onsubmit="SF.actions.saveProduct(event, '${SF.js(route.businessId)}', '${SF.js(route.id || '')}')" class="glass-card-3d p-4 space-y-3 text-xs">
        ${field('name', 'Название', v.name, { placeholder: 'Например: Курс «Йога за 15 минут»', max: 120 })}
        ${field('description', 'Что получает клиент', v.description, { rows: 3, max: 3000, placeholder: 'Что входит, как проходит' })}
        ${field('result', 'Результат для клиента', v.result, { rows: 2, max: 1000, placeholder: 'Только настоящий — без обещаний, которых нет' })}
        <div class="grid grid-cols-2 gap-2">
          ${field('format', 'Формат', v.format, { placeholder: 'Онлайн, видео + чат', max: 200 })}
          ${field('duration', 'Длительность', v.duration, { placeholder: '21 день', max: 200 })}
        </div>
        <label class="block space-y-1">
          <span class="block text-[11px] font-semibold text-ink-2">Цена</span>
          <select name="priceMode" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink">
            ${PRICE_MODES.map(([id, label]) => `<option value="${id}" ${v.priceMode === id ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
        ${field('priceLabel', 'Сумма (для фиксированной цены)', v.priceLabel, { placeholder: '15 000 ₸', max: 80 })}
        ${field('installment', 'Рассрочка', v.installment, { placeholder: 'Если есть — какая', max: 300 })}
        ${field('guarantee', 'Гарантии и возврат', v.guarantee, { rows: 2, max: 500, placeholder: 'Только настоящие условия' })}
        ${field('paymentUrl', 'Ссылка на оплату', v.paymentUrl, { placeholder: 'https://…', max: 300 })}
        ${field('accessUrl', 'Ссылка на доступ после оплаты', v.accessUrl, { placeholder: 'https://…', max: 300, hint: 'Клиент получит её, когда вы подтвердите оплату.' })}
        <button type="submit" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm">${p ? 'Сохранить' : 'Добавить продукт'}</button>
        ${p ? `<button type="button" onclick="SF.actions.archiveProduct('${SF.js(p.id)}', '${SF.js(route.businessId)}')" class="w-full py-2 text-[11px] text-faint">Убрать в архив</button>` : ''}
      </form>`;
  }

  SF.actions.saveProduct = async (e, businessId, id) => {
    e.preventDefault();
    if (needServer()) return;
    const f = e.target;
    const data = {};
    for (const k of ['name', 'description', 'result', 'format', 'duration', 'priceMode', 'priceLabel', 'installment', 'guarantee', 'paymentUrl', 'accessUrl']) data[k] = f[k].value.trim();
    try {
      if (id) await api().updateProduct(id, data);
      else await api().createProduct(businessId, data);
      SF.data.invalidate(`products:${businessId}`);
      SF.data.invalidate('businesses');
      await SF.data.products(businessId, 0);
      showToast(id ? 'Продукт сохранён' : 'Продукт добавлен');
      SF.back();
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не сохранилось', err));
    }
  };

  SF.actions.archiveProduct = async (id, businessId) => {
    if (!window.confirm('Убрать продукт в архив? SI-продавцы перестанут брать из него сведения.')) return;
    try {
      await api().archiveProduct(id);
      SF.data.invalidate(`products:${businessId}`);
      SF.data.invalidate('businesses');
      await SF.data.products(businessId, 0);
      SF.back();
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не получилось', err));
    }
  };

  // Which product this SI-продавец sells (from its business)
  SF.actions.attachProduct = async (projectId, productId) => {
    if (needServer()) return;
    try {
      await api().attachProduct(projectId, productId);
      SF.data.invalidate('consultants');
      SF.data.invalidate('puzzle:');
      await SF.data.myConsultants();
      showToast(productId ? 'Продукт привязан — SI знает о нём всё' : 'Продукт отвязан');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не получилось', err));
    }
  };

  const waitingCount = (state, projectId) => (state.remote.inquiries[projectId] || []).filter(i => i.status === 'waiting').length;

  function renderConsultantList(state) {
    // Only the SI-продавцы of the business open in the Office (Профиль → «Мои бизнесы»)
    const list = store().consultantsOfCurrent();
    const assisted = state.office.consultants.filter(c => c.assisting);
    const owners = [...new Set(assisted.map(c => c.ownerName))];
    const assistedBlock = assisted.length ? `
      <div class="space-y-2.5">
        <div class="text-[11px] text-muted px-1 leading-snug">Вы помощник: ${SF.esc(owners.join(', '))}. Отвечаете клиентам и ставите SI на паузу; деньги, SI-мозг и настройки видит только владелец.</div>
        ${assisted.map(c => `
          <button onclick="SF.push('office-consultant', { id: '${SF.js(c.id)}', tab: 'income' })" class="relative w-full glass-card-3d p-3.5 text-left flex items-center gap-3">
            ${waitingCount(state, c.id) ? `<span class="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[9px] font-bold">ждут: ${waitingCount(state, c.id)}</span>` : ''}
            ${SF.avatar(c.photoUrl, { size: 48, kind: 'si' })}
            <span class="flex-1 min-w-0">
              <span class="block text-sm font-bold text-ink truncate">${SF.esc(c.name)}</span>
              <span class="block text-[11px]">${SF.siLabel(c.roleTitle)}</span>
              <span class="block text-[10px] mt-0.5 text-brand">Бизнес: ${SF.esc(c.ownerName)}</span>
            </span>
            <i data-lucide="chevron-right" class="w-4 h-4 text-faint"></i>
          </button>`).join('')}
      </div>` : '';
    if (assistantOnly()) {
      return `${assistedBlock}
        <button onclick="SF.actions.startCreateConsultant()" class="w-full py-2.5 rounded-2xl btn-3d-dark text-xs flex items-center justify-center gap-1.5">
          <i data-lucide="plus" class="w-4 h-4"></i> Создать своего SI-продавца
        </button>`;
    }
    return `
      <button onclick="SF.push('office-create')" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm flex items-center justify-center gap-1.5">
        <i data-lucide="plus" class="w-4 h-4"></i> Создать SI-продавца
      </button>
      ${SF.funnels ? SF.funnels.officeEntry() : ''}
      <button onclick="SF.go('community')" class="w-full glass-card-3d p-3.5 flex items-center gap-3 text-left">
        <span class="w-10 h-10 rounded-2xl bg-[#81D8D0]/20 flex items-center justify-center text-brand"><i data-lucide="users" class="w-5 h-5"></i></span>
        <span class="flex-1">
          <span class="block text-sm font-bold text-ink">Мои сообщества</span>
          <span class="block text-[11px] text-muted">Лента, участники, заявки и оплаты, цифры — во вкладке «Комьюнити»</span>
        </span>
        <i data-lucide="chevron-right" class="w-4 h-4 text-faint"></i>
      </button>
      ${assistedBlock}
      <div class="space-y-2.5">
        ${list.map(c => `
          <button onclick="SF.push('office-consultant', { id: '${SF.js(c.id)}', tab: 'analytics' })" class="relative w-full glass-card-3d p-3.5 text-left flex items-center gap-3">
            ${waitingCount(state, c.id) ? `<span class="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[9px] font-bold">ждут: ${waitingCount(state, c.id)}</span>` : ''}
            ${SF.avatar(c.photoUrl, { size: 48, kind: 'si' })}
            <span class="flex-1 min-w-0">
              <span class="block text-sm font-bold text-ink truncate">${SF.esc(c.name)}</span>
              <span class="block text-[11px]">${SF.siLabel(c.roleTitle)}</span>
              <span class="block text-[10px] mt-0.5 ${c.isListed ? 'text-brand' : 'text-faint'}">${c.isListed ? 'В Маркетплейсе' : 'Не в Маркетплейсе'}${c.paymentUrl ? ' · ссылка на оплату есть' : ' · нет ссылки на оплату'}</span>
              ${state.remote.puzzle[c.id] ? `
                <span class="flex items-center gap-1.5 mt-1">
                  <i data-lucide="puzzle" class="w-3 h-3 ${state.remote.puzzle[c.id].missingRequired.length ? 'text-amber-500' : 'text-brand'}"></i>
                  <span class="flex-1 h-1.5 rounded-full bg-sunken overflow-hidden"><span class="block h-full rounded-full ${state.remote.puzzle[c.id].missingRequired.length ? 'bg-amber-500' : 'bg-[#81D8D0]'}" style="width:${Math.round(state.remote.puzzle[c.id].done / Math.max(1, state.remote.puzzle[c.id].total) * 100)}%"></span></span>
                  <span class="text-[10px] font-semibold text-muted">${state.remote.puzzle[c.id].done}/${state.remote.puzzle[c.id].total}</span>
                </span>` : ''}
            </span>
            <i data-lucide="chevron-right" class="w-4 h-4 text-faint"></i>
          </button>`).join('')}
        ${!list.length ? `<div class="text-xs text-muted px-1">${SF.data.signedIn() ? 'Пока нет SI-продавцов — создайте первого.' : 'Откройте приложение в Telegram, чтобы увидеть своих SI-продавцов.'}</div>` : ''}
      </div>
    `;
  }

  // ---------------- Funnel: where every client of the business is now ----------------
  // The business shown: my own, or (for the assistant) the one I help
  function funnelBusinessId(state) {
    const info = state.remote.business;
    if (!info) return null;
    if (info.business) return info.business.id;
    return info.assisting && info.assisting[0] ? info.assisting[0].businessId : '';
  }

  // «По шагам»: one SI-seller — how many reached each step, are on it now, refused on it; where they stop
  function funnelStepsProject(route) {
    const list = store().data.office.consultants;
    // By default — the first SI-seller that already has steps
    return list.find(c => c.id === route.fproject) || list.find(c => (c.steps || []).length) || list[0] || null;
  }

  // The funnel of one SI-продавец: the 5 statuses or «По шагам» (route.fview), for 7 / 30 days / all time
  function renderSellerFunnel(c, route, state) {
    const days = FUNNEL_DAYS.some(d => d.id === route.days) ? route.days : '30';
    const view = route.fview === 'steps' ? 'steps' : 'status';
    const toggle = `
      <div class="grid grid-cols-2 gap-1 bg-raised p-1 rounded-2xl border border-line">
        ${[['status', 'По статусам'], ['steps', 'По шагам']].map(([id, label]) => `
          <button onclick="SF.patch({ fview: '${id}' })" class="py-2 rounded-xl text-[11px] font-semibold ${view === id ? 'bg-[#81D8D0] text-[#08302c] shadow' : 'text-muted'}">${label}</button>`).join('')}
      </div>`;
    if (view === 'steps') return toggle + renderFunnelSteps({ ...route, fproject: c.id }, state, days, { single: true });
    const funnel = state.remote.sellerFunnel[`${c.id}|${days}`];
    const status = FUNNEL.some(f => f.id === route.fstatus) ? route.fstatus : 'waiting_human';
    const list = state.remote.sellerFunnelLists[`${c.id}|${days}|${status}`];
    const counts = (funnel && funnel.counts) || {};
    return `
      ${toggle}
      <div class="flex gap-1.5">
        ${FUNNEL_DAYS.map(d => `
          <button onclick="SF.patch({ days: '${d.id}' })" class="flex-1 py-1.5 rounded-xl text-[11px] font-semibold border ${days === d.id ? 'bg-card border-[#81D8D0] text-ink' : 'bg-sunken border-line text-muted'}">${d.label}</button>`).join('')}
      </div>
      <div class="grid grid-cols-2 gap-2">
        ${FUNNEL.map((f, i) => `
          <button onclick="SF.patch({ fstatus: '${f.id}' })" class="${i === 0 ? 'col-span-2 ' : ''}p-3 rounded-2xl border text-left ${f.cls} ${status === f.id ? 'ring-2 ring-[#81D8D0] ring-offset-1 ring-offset-page' : ''}">
            <div class="text-[11px] font-semibold leading-tight">${f.label}</div>
            <div class="text-xl font-extrabold">${funnel ? (counts[f.id] || 0) : '…'}</div>
          </button>`).join('')}
      </div>
      ${SF.sectionTitle('', funnelOf(status).label)}
      ${!list ? '<div class="text-xs text-muted">Загружаю…</div>' : ''}
      ${list && !list.clients.length ? '<div class="text-xs text-muted px-1">Здесь пока никого нет.</div>' : ''}
      <div class="space-y-1.5">
        ${(list ? list.clients : []).map(cl => `
          <button onclick="SF.push('office-client', { id: '${SF.js(cl.id)}', projectId: '${SF.js(cl.project_id)}' })" class="w-full p-2.5 rounded-xl bg-card border border-line flex items-center gap-2.5 text-left">
            ${SF.avatar(cl.avatar_url, { size: 32 })}
            <span class="flex-1 min-w-0">
              <span class="block text-xs font-bold text-ink truncate">${SF.esc(cl.name)}</span>
              <span class="block text-[10px] text-muted truncate">${cl.last_objection ? `«${SF.esc(cl.last_objection)}»` : SF.esc(funnelOf(cl.funnel_status).label)}</span>
            </span>
            <span class="text-[10px] text-faint whitespace-nowrap">${timeLabel(cl.last_activity)}</span>
          </button>`).join('')}
      </div>
      ${list && !list.done ? `<button onclick="SF.actions.moreSellerFunnel('${SF.js(c.id)}', '${SF.js(c.businessId || '')}', '${days}', '${status}')" class="w-full py-2.5 rounded-xl btn-3d-dark text-xs">Показать ещё</button>` : ''}
    `;
  }

  function renderFunnelSteps(route, state, days, { single = false } = {}) {
    const consultants = single ? [] : store().data.office.consultants;
    const c = funnelStepsProject(route);
    if (!c) return SF.emptyState('consultant', 'Пока нет SI-продавцов', 'Создайте SI-продавца — здесь будет видно, на каком шаге каждый клиент.');
    const report = state.remote.funnelSteps[`${c.id}|${days}`];
    const steps = report ? report.steps : [];
    const stepId = steps.some(s => s.id === route.fstep) ? route.fstep : (steps[0] && steps[0].id);
    const list = stepId && state.remote.funnelStepLists[`${c.id}|${days}|${stepId}`];
    const top = Math.max(1, ...steps.map(s => s.reached));
    return `
      ${consultants.length > 1 ? `
        <select onchange="SF.patch({ fproject: this.value, fstep: '' })" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink text-xs">
          ${consultants.map(o => `<option value="${SF.esc(o.id)}" ${o.id === c.id ? 'selected' : ''}>${SF.esc(o.name)}</option>`).join('')}
        </select>` : ''}
      <div class="flex gap-1.5">
        ${FUNNEL_DAYS.map(d => `
          <button onclick="SF.patch({ days: '${d.id}' })" class="flex-1 py-1.5 rounded-xl text-[11px] font-semibold border ${days === d.id ? 'bg-card border-[#81D8D0] text-ink' : 'bg-sunken border-line text-muted'}">${d.label}</button>`).join('')}
      </div>
      ${!report ? '<div class="text-xs text-muted">Загружаю…</div>' : ''}
      ${report && !steps.length ? `
        <div class="glass-card-3d p-4 space-y-2 text-xs">
          <div class="font-bold text-ink">У «${SF.esc(c.name)}» пока нет шагов воронки</div>
          <p class="text-muted leading-relaxed">Шаги — это путь клиента к покупке: например, знакомство → материал → вопросы → встреча или оффер → оплата. SI ведёт каждого клиента от шага к шагу, а здесь видно, где люди останавливаются.</p>
          ${c.assisting ? '<p class="text-faint">Шаги добавляет владелец бизнеса.</p>' : `<button onclick="${single ? "SF.patch({ tab: 'methodology' })" : `SF.push('office-consultant', { id: '${SF.js(c.id)}', tab: 'methodology' })`}" class="w-full py-2.5 rounded-xl btn-3d-tiffany">Добавить шаги</button>`}
        </div>` : ''}
      ${steps.length ? `
        <div class="space-y-1.5">
          ${steps.map((s, i) => `
            <button onclick="SF.patch({ fstep: '${SF.js(s.id)}' })" class="w-full p-2.5 rounded-xl bg-card border text-left space-y-1.5 ${s.id === stepId ? 'border-[#81D8D0] ring-1 ring-[#81D8D0]' : 'border-line'}">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-bold text-ink truncate">${i + 1}. ${SF.esc(s.title)}</span>
                ${s.id === report.stopStepId ? '<span class="text-[10px] font-semibold text-amber-500 whitespace-nowrap">здесь чаще останавливаются</span>' : ''}
              </div>
              <div class="h-1.5 rounded-full bg-sunken overflow-hidden"><div class="h-full rounded-full bg-[#81D8D0]" style="width:${Math.round(s.reached / top * 100)}%"></div></div>
              <div class="flex gap-3 text-[10px] text-muted">
                <span>Дошли: <b class="text-ink">${s.reached}</b>${i > 0 && steps[i - 1].reached ? ` (${Math.round(s.reached / steps[i - 1].reached * 100)}%)` : ''}</span>
                <span>Сейчас здесь: <b class="text-ink">${s.here}</b></span>
                ${s.refused ? `<span>Отказ: <b class="text-ink">${s.refused}</b></span>` : ''}
              </div>
            </button>`).join('')}
        </div>
        <div class="text-[10px] text-faint px-1 leading-snug">Всего клиентов: ${report.total}, купили: ${report.bought}. «Дошли» — дошли до шага или дальше; процент — от предыдущего шага. SI переводит клиента дальше, когда шаг пройден; вы или помощник можете перевести вручную в карточке клиента.</div>
        ${SF.sectionTitle('', `Сейчас на шаге «${SF.esc((steps.find(s => s.id === stepId) || {}).title || '')}»`)}
        ${!list ? '<div class="text-xs text-muted">Загружаю…</div>' : ''}
        ${list && !list.clients.length ? '<div class="text-xs text-muted px-1">Здесь сейчас никого нет.</div>' : ''}
        <div class="space-y-1.5">
          ${(list ? list.clients : []).map(cl => `
            <button onclick="SF.push('office-client', { id: '${SF.js(cl.id)}', projectId: '${SF.js(cl.project_id)}' })" class="w-full p-2.5 rounded-xl bg-card border border-line flex items-center gap-2.5 text-left">
              ${SF.avatar(cl.avatar_url, { size: 32 })}
              <span class="flex-1 min-w-0">
                <span class="block text-xs font-bold text-ink truncate">${SF.esc(cl.name)}</span>
                <span class="block text-[10px] text-muted truncate">${SF.esc(funnelOf(cl.funnel_status).label)}${cl.last_objection ? ` · «${SF.esc(cl.last_objection)}»` : ''}</span>
              </span>
              <span class="text-[10px] text-faint whitespace-nowrap">${timeLabel(cl.last_activity)}</span>
            </button>`).join('')}
        </div>
        ${list && !list.done ? `<button onclick="SF.actions.moreFunnelStep('${SF.js(c.id)}', '${days}', '${SF.js(stepId)}')" class="w-full py-2.5 rounded-xl btn-3d-dark text-xs">Показать ещё</button>` : ''}` : ''}
    `;
  }

  // ---------------- Calendar: free windows of the owner and the assistant, meetings ----------------
  // The owner sets the rules and the windows (for himself and for the assistant); both see meetings.
  // Windows are typed in the owner's phone time; clients see free times in their own time.
  const WEEK = [{ day: 1, label: 'Пн' }, { day: 2, label: 'Вт' }, { day: 3, label: 'Ср' }, { day: 4, label: 'Чт' }, { day: 5, label: 'Пт' }, { day: 6, label: 'Сб' }, { day: 0, label: 'Вс' }];
  const MEETING_STATUS = { booked: 'Запланирована', done: 'Состоялась', no_show: 'Не пришёл', cancelled: 'Отменена' };
  const calDrafts = {}; // { [userId]: windows being edited }
  const phoneOffset = () => -new Date().getTimezoneOffset();
  const utcLabel = (offset) => `UTC${offset >= 0 ? '+' : '−'}${Math.floor(Math.abs(offset) / 60)}${Math.abs(offset) % 60 ? `:${String(Math.abs(offset) % 60).padStart(2, '0')}` : ''}`;
  const meetingWhen = (iso) => new Date(iso).toLocaleString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  function calendarKey(state) {
    const businessId = funnelBusinessId(state);
    if (businessId === null) return null;
    return businessId || (store().isBusinessActive() ? 'own' : '');
  }

  function renderMeeting(m, businessId) {
    const started = new Date(m.startsAt) <= new Date();
    const id = SF.js(m.id);
    const b = SF.js(businessId);
    return `
      <div class="p-3 rounded-2xl bg-card border ${m.status === 'booked' && !started ? 'border-[#81D8D0]' : 'border-line'} space-y-1.5">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-bold text-ink">${SF.esc(meetingWhen(m.startsAt))}</span>
          <span class="text-[10px] ${m.status === 'booked' ? 'text-brand' : 'text-faint'}">${MEETING_STATUS[m.status] || ''}</span>
        </div>
        <div class="text-[11px] text-ink-2">${SF.esc(m.clientName || 'Клиент')}${m.clientUsername ? ` · @${SF.esc(m.clientUsername)}` : ''}</div>
        <div class="text-[10px] text-muted">Ведёт: ${SF.esc(m.hostName)}${m.projectName ? ` · SI-продавец «${SF.esc(m.projectName)}»` : ''}</div>
        ${m.status === 'booked' ? `
          <div class="flex gap-1.5 pt-0.5">
            ${m.zoomUrl ? `<button onclick="SF.openLink('${SF.js(m.zoomUrl)}')" class="flex-1 py-1.5 rounded-xl btn-3d-tiffany text-[11px] flex items-center justify-center gap-1"><i data-lucide="video" class="w-3.5 h-3.5"></i>Zoom</button>` : ''}
            ${started ? `
              <button onclick="SF.actions.meetingAction('${b}', '${id}', 'done')" class="flex-1 py-1.5 rounded-xl bg-sunken border border-line text-[11px] text-ink-2">Состоялась</button>
              <button onclick="SF.actions.meetingAction('${b}', '${id}', 'no_show')" class="flex-1 py-1.5 rounded-xl bg-sunken border border-line text-[11px] text-ink-2">Не пришёл</button>` : `
              <button onclick="SF.actions.meetingAction('${b}', '${id}', 'cancel')" class="flex-1 py-1.5 rounded-xl bg-sunken border border-line text-[11px] text-ink-2">Отменить</button>`}
          </div>` : ''}
      </div>`;
  }

  function renderHostForm(h, settings) {
    const uid = SF.js(h.userId);
    // Every row has its own key, so a typed value never moves to another row after adding or removing one
    const windows = calDrafts[h.userId] || h.windows.map((w, i) => ({ ...w, key: `s${i}` }));
    return `
      <div class="glass-card-3d p-3.5 space-y-2.5" data-host="${SF.esc(h.userId)}">
        <div class="flex items-center justify-between gap-2">
          <span class="min-w-0">
            <span class="block text-xs font-bold text-ink truncate">${SF.esc(h.name)}</span>
            <span class="block text-[10px] text-muted">${h.role === 'owner' ? 'Вы' : 'Помощник'}</span>
          </span>
          <label class="flex items-center gap-1.5 text-[11px] text-ink-2">
            <input type="checkbox" name="active" ${h.active || !h.windows.length ? 'checked' : ''} class="w-4 h-4 accent-[#0d9488]" />Принимает встречи
          </label>
        </div>
        <input type="url" name="zoom" data-keep="cal-${SF.esc(h.userId)}-zoom" value="${SF.esc(h.zoomUrl)}" placeholder="Постоянная ссылка Zoom: https://…" class="w-full bg-card border border-line-2 rounded-xl px-3 py-2 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]" />
        <div class="text-[11px] text-muted">Свободные окна каждую неделю (время ${utcLabel(settings.tzOffset)}):</div>
        <div class="space-y-1.5">
          ${windows.map((w, i) => `
            <div class="flex items-center gap-1.5" data-window="${w.key}">
              <select name="day" data-keep="cal-${SF.esc(h.userId)}-${w.key}-day" class="bg-card border border-line-2 rounded-lg px-1.5 py-1.5 text-xs text-ink">
                ${WEEK.map(d => `<option value="${d.day}" ${d.day === Number(w.day) ? 'selected' : ''}>${d.label}</option>`).join('')}
              </select>
              <input type="time" name="from" data-keep="cal-${SF.esc(h.userId)}-${w.key}-from" value="${SF.esc(w.from)}" step="900" class="flex-1 min-w-0 bg-card border border-line-2 rounded-lg px-1.5 py-1.5 text-xs text-ink" />
              <span class="text-faint text-xs">–</span>
              <input type="time" name="to" data-keep="cal-${SF.esc(h.userId)}-${w.key}-to" value="${SF.esc(w.to)}" step="900" class="flex-1 min-w-0 bg-card border border-line-2 rounded-lg px-1.5 py-1.5 text-xs text-ink" />
              <button onclick="SF.actions.removeCalendarWindow('${uid}', '${SF.js(w.key)}')" class="px-1.5 text-faint text-lg leading-none" aria-label="Убрать окно">&times;</button>
            </div>`).join('')}
          ${!windows.length ? '<div class="text-[11px] text-faint">Окон пока нет — клиенты не смогут записаться к этому человеку.</div>' : ''}
        </div>
        <div class="grid grid-cols-2 gap-2">
          <button onclick="SF.actions.addCalendarWindow('${uid}')" class="py-2 rounded-xl btn-3d-dark text-xs flex items-center justify-center gap-1"><i data-lucide="plus" class="w-3.5 h-3.5"></i>Окно</button>
          <button onclick="SF.actions.saveCalendarHost('${uid}')" class="py-2 rounded-xl btn-3d-tiffany text-xs">Сохранить</button>
        </div>
      </div>`;
  }

  // businessKey: the business of the SI-продавец (the calendar is shared by all SI-продавцы of the business)
  function renderCalendar(state, businessKey = null) {
    const key = businessKey || calendarKey(state);
    if (key === null) return '<div class="text-xs text-muted">Загружаю…</div>';
    const cal = key && state.remote.calendar[key];
    if (key && !cal) return '<div class="text-xs text-muted">Загружаю…</div>';
    if (!cal || !cal.businessId) return SF.emptyState('consultant', 'Календарь появится с первым SI-продавцом', 'Создайте и включите SI-продавца — клиенты смогут записываться к вам на встречу прямо в чате.');
    const owner = cal.role === 'owner';
    const b = SF.js(cal.businessId);
    const s = cal.settings;
    const now = Date.now();
    const upcoming = cal.meetings.filter(m => m.status === 'booked' && new Date(m.endsAt) > now);
    const past = cal.meetings.filter(m => !upcoming.includes(m)).reverse();
    return `
      <div class="p-3 rounded-2xl ${cal.enabled ? 'bg-card border border-[#81D8D0]' : 'bg-sunken border border-line'} text-[11px] text-ink-2 leading-snug">
        ${cal.enabled
          ? '📅 Запись открыта: когда SI-продавец предложит встречу, у клиента в чате появится кнопка «Записаться» со свободным временем на 2 недели вперёд.'
          : (owner ? 'Запись закрыта. Добавьте свободные окна себе или помощнику и нажмите «Сохранить» — клиенты смогут записываться прямо в чате.' : 'Запись пока закрыта: свободные окна задаёт владелец бизнеса.')}
      </div>

      ${SF.sectionTitle('', 'Встречи')}
      <div class="space-y-1.5">
        ${upcoming.map(m => renderMeeting(m, cal.businessId)).join('')}
        ${!upcoming.length ? '<div class="text-xs text-muted px-1">Запланированных встреч пока нет.</div>' : ''}
      </div>
      ${past.length ? `
        <details class="space-y-1.5">
          <summary class="text-[11px] text-muted px-1 cursor-pointer">Прошедшие и отменённые (${past.length})</summary>
          <div class="space-y-1.5 pt-1.5">${past.map(m => renderMeeting(m, cal.businessId)).join('')}</div>
        </details>` : ''}

      ${owner ? `
        ${SF.sectionTitle('', 'Кто принимает встречи')}
        ${cal.hosts.map(h => renderHostForm(h, s)).join('')}
        ${cal.hosts.length < 2 ? '<div class="text-[10px] text-faint px-1">Помощника можно добавить в разделе «Помощник» — потом задать окна и ему.</div>' : ''}

        ${SF.sectionTitle('', 'Правила записи')}
        <div class="glass-card-3d p-3.5 space-y-2.5" id="calendar-rules">
          <div class="text-[11px] text-muted">Длительность встречи</div>
          <div class="flex flex-wrap gap-1.5">
            ${cal.durations.map(d => `<button onclick="SF.actions.saveCalendarRules('${b}', { durationMinutes: ${d} })" class="px-2.5 py-1.5 rounded-xl text-[11px] ${s.durationMinutes === d ? 'btn-3d-tiffany' : 'bg-sunken border border-line text-ink-2'}">${d} мин</button>`).join('')}
          </div>
          <label class="flex items-center gap-2 text-xs text-ink-2">
            <input type="checkbox" ${s.clientCanReschedule ? 'checked' : ''} onchange="SF.actions.saveCalendarRules('${b}', { clientCanReschedule: this.checked })" class="w-4 h-4 accent-[#0d9488]" />Клиент может сам перенести встречу
          </label>
          <label class="flex items-center gap-2 text-xs text-ink-2">
            <input type="checkbox" ${s.clientCanCancel ? 'checked' : ''} onchange="SF.actions.saveCalendarRules('${b}', { clientCanCancel: this.checked })" class="w-4 h-4 accent-[#0d9488]" />Клиент может сам отменить встречу
          </label>
          <label class="flex items-center gap-2 text-xs text-ink-2">
            Не позже чем за
            <input type="number" min="0" max="168" value="${s.hoursBefore}" onchange="SF.actions.saveCalendarRules('${b}', { hoursBefore: this.value })" class="w-16 bg-card border border-line-2 rounded-lg px-2 py-1 text-xs text-ink" />
            ч до встречи
          </label>
          <div class="text-[10px] text-faint leading-snug">Вы и помощник можете отменить встречу всегда. Клиент получит сообщение в чате, а вы — у Бадди и в Telegram. За час до встречи напоминание придёт обеим сторонам.</div>
        </div>` : ''}
    `;
  }

  function readHostForm(userId) {
    const card = [...document.querySelectorAll('[data-host]')].find(el => el.dataset.host === userId);
    if (!card) return null;
    return {
      active: card.querySelector('[name="active"]').checked,
      zoomUrl: card.querySelector('[name="zoom"]').value.trim(),
      windows: [...card.querySelectorAll('[data-window]')].map(row => ({
        key: row.dataset.window,
        day: Number(row.querySelector('[name="day"]').value),
        from: row.querySelector('[name="from"]').value,
        to: row.querySelector('[name="to"]').value
      }))
    };
  }

  function calendarOf(businessId) {
    const remote = store().data.remote.calendar;
    return Object.keys(remote).find(k => remote[k] && remote[k].businessId === businessId);
  }

  SF.actions.addCalendarWindow = (userId) => {
    const form = readHostForm(userId);
    if (!form) return;
    const last = form.windows[form.windows.length - 1];
    const next = last ? WEEK[(WEEK.findIndex(d => d.day === last.day) + 1) % 7].day : 1;
    calDrafts[userId] = [...form.windows, { key: `n${Date.now()}`, day: next, from: last ? last.from : '10:00', to: last ? last.to : '13:00' }];
    store().notify();
  };

  SF.actions.removeCalendarWindow = (userId, key) => {
    const form = readHostForm(userId);
    if (!form) return;
    calDrafts[userId] = form.windows.filter(w => w.key !== key);
    store().notify();
  };

  async function saveCalendar(businessId, request, toast) {
    const key = calendarOf(businessId);
    try {
      const res = await request();
      if (key) store().setRemote(`calendar.${key}`, res);
      showToast(toast);
      return true;
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не сохранилось', err));
      return false;
    }
  }

  SF.actions.saveCalendarHost = async (userId) => {
    const form = readHostForm(userId);
    const key = Object.keys(store().data.remote.calendar).find(k => (store().data.remote.calendar[k].hosts || []).some(h => h.userId === userId));
    const cal = key && store().data.remote.calendar[key];
    if (!form || !cal) return;
    if (form.windows.some(w => !w.from || !w.to || w.to <= w.from)) {
      showToast('Проверьте окна: конец должен быть позже начала');
      return;
    }
    // The windows are typed in the phone's time: the business time follows the owner's phone
    if (cal.settings.tzOffset !== phoneOffset()) await api().saveCalendarSettings(cal.businessId, { tzOffset: phoneOffset() });
    const windows = form.windows.map(({ day, from, to }) => ({ day, from, to }));
    const saved = await saveCalendar(cal.businessId, () => api().saveCalendarHost(cal.businessId, userId, { ...form, windows }), 'Сохранено');
    if (saved) {
      delete calDrafts[userId];
      store().notify();
    }
  };

  SF.actions.saveCalendarRules = (businessId, change) => {
    saveCalendar(businessId, () => api().saveCalendarSettings(businessId, change), 'Сохранено');
  };

  SF.actions.meetingAction = async (businessId, meetingId, action) => {
    const key = calendarOf(businessId);
    const meeting = key && store().data.remote.calendar[key].meetings.find(m => m.id === meetingId);
    if (!meeting) return;
    if (action === 'cancel' && !confirm(`Отменить встречу ${meetingWhen(meeting.startsAt)} с ${meeting.clientName || 'клиентом'}? Клиент получит сообщение в чате.`)) return;
    await saveCalendar(businessId, () => api().meetingAction(businessId, meetingId, action),
      action === 'cancel' ? 'Встреча отменена' : `Отмечено: ${MEETING_STATUS[action]}`);
  };

  // ---------------- SI-brain: materials the SI answers from ----------------
  const BRAIN_ACCEPT = '.pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';
  const MAX_BRAIN_FILE = 10 * 1024 * 1024;
  const SOURCE_LABELS = { pdf: 'PDF', docx: 'Word', txt: 'Текст' };
  let brainBusy = null; // name of the file being read right now

  function brainUploadButtons(consultantId = '') {
    return `
      <div class="grid grid-cols-2 gap-2">
        <button onclick="SF.actions.uploadBrainFile('${SF.js(consultantId)}')" ${brainBusy ? 'disabled' : ''} class="py-2.5 rounded-xl btn-3d-tiffany text-xs flex items-center justify-center gap-1.5 disabled:opacity-60">
          <i data-lucide="upload" class="w-3.5 h-3.5"></i> Загрузить файл
        </button>
        <button onclick="SF.actions.pasteBrainText('${SF.js(consultantId)}')" ${brainBusy ? 'disabled' : ''} class="py-2.5 rounded-xl btn-3d-dark text-xs flex items-center justify-center gap-1.5 disabled:opacity-60">
          <i data-lucide="type" class="w-3.5 h-3.5"></i> Вставить текст
        </button>
      </div>
      ${brainBusy ? `<div class="text-[11px] text-si flex items-center gap-1.5"><span class="si-dot"></span>Читаю «${SF.esc(brainBusy)}»… Это может занять до минуты.</div>` : ''}`;
  }

  // A material belongs to a business; one uploaded before any business existed — to the main one
  function inBusiness(m, businessId) {
    const list = (store().data.remote.businesses && store().data.remote.businesses.businesses) || [];
    return !businessId || (m.businessId || (list[0] && list[0].id)) === businessId;
  }

  function renderBrain(state) {
    const bid = store().currentBusinessId();
    const materials = state.remote.brain && state.remote.brain.filter(m => inBusiness(m, bid));
    const consultants = store().consultantsOfCurrent();
    return `
      <div class="glass-card-3d p-4 space-y-3">
        <div class="flex items-center gap-2">
          <span class="si-dot"></span>
          <span class="text-sm font-bold text-ink">Мой SI-мозг</span>
        </div>
        <p class="text-xs text-muted leading-relaxed">Загрузите то, что знаете вы: программу, прайс, ответы на частые вопросы, кейсы. SI будет отвечать клиентам по этим материалам своими словами. Каждый SI знает только то, что вы ему откроете.</p>
        ${brainUploadButtons()}
        <div class="text-[10px] text-faint">PDF, Word (.docx) или текст, до 10 МБ. Сохраняется только текст — сами файлы не хранятся. Сканы и картинки без текста не подойдут.</div>
      </div>
      ${!materials ? `<div class="text-xs text-muted px-1">${SF.data.signedIn() ? 'Загружаю…' : 'Откройте приложение в Telegram, чтобы увидеть свои материалы.'}</div>` : ''}
      ${materials && !materials.length ? SF.emptyState('consultant', 'Материалов пока нет', 'Начните с самого частого: что входит в ваш продукт, сколько стоит, кому подходит. Можно просто вставить текст.') : ''}
      ${(materials || []).map(m => renderMaterial(m, consultants)).join('')}
    `;
  }

  function renderMaterial(m, consultants) {
    const meta = [SOURCE_LABELS[m.sourceType] || 'Текст', `${Number(m.charCount || 0).toLocaleString('ru-RU')} знаков`, timeLabel(m.createdAt)].filter(Boolean).join(' · ');
    return `
      <div class="glass-card-3d p-3.5 space-y-2">
        <div class="flex items-start gap-2.5">
          <i data-lucide="file-text" class="w-5 h-5 text-si flex-shrink-0 mt-0.5"></i>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-bold text-ink truncate">${SF.esc(m.title)}</div>
            <div class="text-[10px] text-muted">${meta}</div>
          </div>
          <button onclick="SF.actions.deleteBrainMaterial('${SF.js(m.id)}')" class="p-1.5 rounded-lg btn-3d-dark" aria-label="Удалить материал">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
        ${m.preview ? `<div class="text-[11px] text-muted leading-snug line-clamp-3 whitespace-pre-line">${SF.esc(m.preview)}</div>` : ''}
        <div class="pt-1 border-t border-line space-y-1.5">
          <div class="text-[10px] font-semibold text-ink-2">Этот материал знают:</div>
          ${consultants.length ? `
            <div class="flex flex-wrap gap-1.5">
              ${consultants.map(c => {
                const on = (m.consultantIds || []).includes(c.id);
                return `
                <label class="flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] cursor-pointer ${on ? 'bg-[var(--si-bubble)] border-[var(--si-bubble-line)] text-ink' : 'bg-sunken border-line text-muted'}">
                  <input type="checkbox" ${on ? 'checked' : ''} onchange="SF.actions.toggleMaterialConsultant('${SF.js(m.id)}', '${SF.js(c.id)}', this.checked)" class="w-3.5 h-3.5 accent-[#0d9488]" />
                  ${SF.esc(c.name)}
                </label>`;
              }).join('')}
            </div>
            ${!(m.consultantIds || []).length ? '<div class="text-[10px] text-faint">Пока ни один SI не знает этот материал — отметьте нужных.</div>' : ''}`
          : '<div class="text-[10px] text-faint">Создайте SI-продавца, чтобы открыть ему этот материал.</div>'}
        </div>
      </div>`;
  }

  // In the consultant's tab: which materials this SI knows
  function renderConsultantBrain(c, state) {
    const materials = state.remote.brain && state.remote.brain.filter(m => inBusiness(m, c.businessId));
    return `
      <div id="seller-brain" class="glass-card-3d p-4 space-y-3 text-xs">
        ${SF.sectionTitle('brain', 'SI-мозг: что знает этот SI')}
        ${!materials ? '<div class="text-muted">Загружаю…</div>' : ''}
        ${materials && !materials.length ? '<div class="text-muted leading-snug">Материалов пока нет. Загрузите программу, прайс или ответы на частые вопросы — SI будет отвечать по ним.</div>' : ''}
        ${(materials || []).map(m => `
          <label class="flex items-center gap-2.5 p-2.5 rounded-xl bg-sunken border border-line cursor-pointer">
            <input type="checkbox" ${(m.consultantIds || []).includes(c.id) ? 'checked' : ''} onchange="SF.actions.toggleMaterialConsultant('${SF.js(m.id)}', '${SF.js(c.id)}', this.checked)" class="w-4 h-4 accent-[#0d9488]" />
            <span class="flex-1 min-w-0">
              <span class="block font-semibold text-ink truncate">${SF.esc(m.title)}</span>
              <span class="block text-[10px] text-muted">${SOURCE_LABELS[m.sourceType] || 'Текст'} · ${Number(m.charCount || 0).toLocaleString('ru-RU')} знаков</span>
            </span>
          </label>`).join('')}
        ${brainUploadButtons(c.id)}
        <div class="text-[10px] text-faint">Новый материал отсюда сразу откроется этому SI. Все материалы бизнеса — в Офисе, раздел «Мозг».</div>
      </div>
    `;
  }

  // ---------------- "Мне написали" ----------------
  function renderInbox(state, only = null) {
    const all = state.office.consultants.filter(c => !only || c.id === only.id).flatMap(c =>
      (state.remote.inquiries[c.id] || []).map(i => ({ ...i, consultant: c })));
    all.sort((a, b) => (a.status === 'waiting' ? 0 : 1) - (b.status === 'waiting' ? 0 : 1) ||
      String(b.created_at).localeCompare(String(a.created_at)));
    return `
      <div class="text-[11px] text-muted px-1 leading-snug">Клиенты, которые нажали «Связаться с человеком». SI для них на паузе, пока вы не включите его обратно. О новых обращениях пишет бот в Telegram.</div>
      ${all.length ? all.map(i => `
        <div class="glass-card-3d p-3.5 space-y-2 ${i.status === 'waiting' ? 'border-[#81D8D0]' : ''}">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="text-sm font-bold text-ink truncate">${SF.esc(i.lead_name)}${i.lead_username ? ` <span class="text-[10px] font-mono text-brand">@${SF.esc(String(i.lead_username).replace(/^@/, ''))}</span>` : ''}</div>
              <div class="text-[10px] text-muted">${SF.esc(i.consultant.name)} · ${timeLabel(i.created_at)}</div>
            </div>
            <span class="text-[10px] font-bold whitespace-nowrap ${i.status === 'waiting' ? 'text-rose-400' : 'text-emerald-400'}">${i.status === 'waiting' ? 'Ждёт ответа' : 'Отвечено'}</span>
          </div>
          <div class="text-xs text-ink-2">${SF.esc(i.reason)}</div>
          <button onclick="SF.push('office-client', { id: '${SF.js(i.client_id)}', projectId: '${SF.js(i.consultant.id)}' })" class="w-full py-2 rounded-xl btn-3d-tiffany text-xs flex items-center justify-center gap-1.5">
            <i data-lucide="message-circle" class="w-3.5 h-3.5"></i> Открыть переписку и ответить
          </button>
          ${i.consultant.assisting ? '' : `<button onclick="SF.actions.noteFromInquiry('${SF.js(i.consultant.id)}', ${SF.esc(JSON.stringify(i.reason || ''))})" class="w-full py-1.5 rounded-xl btn-3d-dark text-[11px] flex items-center justify-center gap-1.5"><i data-lucide="puzzle" class="w-3.5 h-3.5"></i>Научить SI отвечать на это</button>`}
        </div>`).join('') : SF.emptyState('buddy', 'Пока никто не написал', 'Когда клиент нажмёт «Связаться с человеком», обращение появится здесь, а бот пришлёт вам сообщение в Telegram.')}
    `;
  }

  // ---------------- Assistant (one person helps the owner) ----------------
  function renderTeam(state) {
    const info = state.remote.business;
    if (!info) return '<div class="text-xs text-muted">Загружаю…</div>';
    const rights = `
      <div class="grid grid-cols-2 gap-2 text-[11px] leading-snug">
        <div class="p-2.5 rounded-xl bg-sunken border border-line space-y-1">
          <div class="font-bold text-brand">Может</div>
          <div class="text-ink-2">Отвечать в «Мне написали»</div>
          <div class="text-ink-2">Ставить SI на паузу и включать</div>
          <div class="text-ink-2">Смотреть карточки клиентов и воронку</div>
        </div>
        <div class="p-2.5 rounded-xl bg-sunken border border-line space-y-1">
          <div class="font-bold text-muted">Не может</div>
          <div class="text-ink-2">Видеть деньги и ссылки на оплату</div>
          <div class="text-ink-2">Менять SI-мозг</div>
          <div class="text-ink-2">Менять SI-продавцов и настройки</div>
        </div>
      </div>`;
    if (!info.business) {
      return `
        <div class="glass-card-3d p-4 space-y-3">
          ${SF.sectionTitle('user-plus', 'Помощник')}
          <p class="text-xs text-muted leading-relaxed">Бизнес появится, как только вы создадите и включите своего SI-продавца. Тогда сюда можно будет пригласить помощника.</p>
          ${rights}
        </div>`;
    }
    const assistants = info.business.members.filter(m => m.role === 'assistant');
    const canInvite = assistants.length < (info.maxAssistants || 1);
    return `
      <div class="glass-card-3d p-4 space-y-3">
        ${SF.sectionTitle('user-plus', 'Помощник')}
        <p class="text-xs text-muted leading-relaxed">Один человек, который отвечает клиентам вместе с вами. Когда он отвечает клиенту, SI для этого клиента встаёт на паузу.</p>
        ${rights}
        ${assistants.map(m => `
          <div class="p-3 rounded-xl bg-card border border-line flex items-center gap-3">
            <div class="flex-1 min-w-0">
              <div class="text-sm font-bold text-ink truncate">${SF.esc(m.name)}</div>
              <div class="text-[10px] text-muted">${m.username ? `@${SF.esc(m.username)} · ` : ''}${SF.esc(m.supportCode || '')}</div>
            </div>
            <button onclick="SF.actions.removeAssistant('${SF.js(m.userId)}', '${SF.js(m.name)}')" class="px-2.5 py-1.5 rounded-lg btn-3d-dark text-[11px]">Убрать</button>
          </div>`).join('')}
        ${canInvite ? `
          <form onsubmit="SF.actions.inviteAssistant(event)" class="space-y-2 text-xs">
            ${field('supportCode', 'Номер помощника', '', { placeholder: 'SF-48213', max: 12, hint: 'Номер внизу Профиля помощника. Пусть он откроет SmartFlow и продиктует его вам.' })}
            <button type="submit" class="w-full py-2.5 rounded-xl btn-3d-tiffany text-sm">Пригласить</button>
          </form>` : ''}
      </div>`;
  }

  // ---------------- Create a consultant ----------------
  // ---------------- «Быстрый старт» (owner's decision 21 Nov.) ----------------
  // A working SI-seller in a minute: pick a goal, answer 2–4 questions, talk to it as a client.
  // Simple and fit for any niche (the server fills steps and one reminder: server/services/quick-start.js).
  const QUICK_GOALS = [
    { id: 'consult', icon: 'calendar-check', title: 'Записать на консультацию', hint: 'SI узнаёт задачу клиента и записывает к вам' },
    { id: 'sell', icon: 'shopping-bag', title: 'Продать продукт или услугу', hint: 'SI помогает выбрать и ведёт к оплате' },
    { id: 'leads', icon: 'inbox', title: 'Собрать заявки', hint: 'SI узнаёт задачу и передаёт вам контакт клиента' },
    { id: 'free', icon: 'gift', title: 'Выдать бесплатный материал', hint: 'Гайд, чек-лист или видео — и мягко к следующему шагу' },
    { id: 'custom', icon: 'pencil', title: 'Своя задача', hint: 'Опишете цель словами' }
  ];

  function renderQuickGoals() {
    return `
      <div class="glass-card-3d p-4 space-y-1">
        <div class="text-base font-extrabold text-ink">Какая у вас цель?</div>
        <div class="text-xs text-muted leading-snug">Выберите — SI-продавец будет готов за минуту. Всё можно поменять потом.</div>
      </div>
      <div class="space-y-2">
        ${QUICK_GOALS.map(g => `
          <button onclick="SF.push('office-create', { goal: '${g.id}' })" class="w-full p-3.5 rounded-2xl bg-card border border-line flex items-center gap-3 text-left">
            <span class="w-10 h-10 rounded-xl bg-sunken flex items-center justify-center flex-shrink-0"><i data-lucide="${g.icon}" class="w-5 h-5 text-brand"></i></span>
            <span class="flex-1 min-w-0">
              <span class="block text-sm font-bold text-ink">${g.title}</span>
              <span class="block text-[11px] text-muted leading-snug">${g.hint}</span>
            </span>
            <i data-lucide="chevron-right" class="w-4 h-4 text-faint"></i>
          </button>`).join('')}
      </div>`;
  }

  function renderQuickForm(goal) {
    const g = QUICK_GOALS.find(x => x.id === goal);
    const priceBlock = goal === 'consult' ? `
        <label class="block space-y-1">
          <span class="font-semibold text-ink-2">Консультация</span>
          <select name="priceMode" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink">
            <option value="free">Бесплатная</option>
            <option value="fixed">Платная</option>
            <option value="on_request">Цена по запросу</option>
          </select>
        </label>
        ${field('priceLabel', 'Цена (если платная)', '', { placeholder: 'Например: 15 000 ₸', max: 80 })}` : goal === 'sell' ? `
        ${field('priceLabel', 'Цена', '', { placeholder: 'Например: 45 000 ₸', max: 80 })}
        ${field('link', 'Ваша ссылка на оплату (можно добавить позже)', '', { type: 'url', placeholder: 'https://...', max: 300, hint: 'Деньги приходят вам напрямую.' })}` : '';
    const linkBlock = goal === 'free'
      ? field('link', 'Материал: ссылка или текст', '', { placeholder: 'https://... — гайд, чек-лист, видео', rows: 3, max: 500, hint: 'Клиент получит его сразу после приветствия SI.' })
      : '';
    return `
      <form onsubmit="SF.actions.quickStart(event, '${goal}')" class="glass-card-3d p-4 space-y-3 text-xs">
        <div class="flex items-center gap-2 text-sm font-bold text-ink"><i data-lucide="${g ? g.icon : 'sparkles'}" class="w-4 h-4 text-brand"></i>${g ? g.title : ''}</div>
        ${field('about', 'Чем вы занимаетесь — одним-двумя словами', '', { placeholder: 'Например: нутрициолог', max: 40 })}
        ${field('offer', 'Что получит клиент', '', { placeholder: goal === 'free' ? 'Например: чек-лист «7 шагов к режиму сна»' : 'Например: план питания и поддержка 4 недели', max: 200 })}
        ${priceBlock}
        ${linkBlock}
        <button type="submit" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm">Создать SI-продавца</button>
        <div class="text-[10px] text-faint text-center">Шаги разговора и мягкое напоминание SI подставит сам — их можно поменять в настройках.</div>
      </form>`;
  }

  // The «aha»: the SI-seller is ready — talk to it as a client right now
  function renderQuickReady(route) {
    const c = store().findOfficeConsultant(route.id);
    if (!c) return '<div class="text-xs text-muted">Загружаю…</div>';
    return `
      <div class="glass-card-3d p-5 space-y-3 text-center border-[var(--si-bubble-line)]">
        <div class="flex justify-center">${SF.avatar(c.photoUrl, { size: 64, kind: 'si' })}</div>
        <div class="text-lg font-extrabold text-ink">SI-продавец готов</div>
        <div class="text-xs text-ink-2 leading-snug">«${SF.esc(c.name)}» уже умеет вести клиента: ${(c.steps || []).map(st => SF.esc(st.title)).join(' → ')}.</div>
        <button onclick="SF.actions.openChat('${SF.js(c.slug)}')" class="w-full py-3 rounded-2xl btn-3d-red text-sm flex items-center justify-center gap-1.5">
          <i data-lucide="message-circle" class="w-4 h-4"></i> Поговорить как клиент
        </button>
        <div class="text-[10px] text-faint">Попробуйте сами — так его увидят ваши клиенты. Этот разговор будет подписан «Вы (проверка)».</div>
      </div>
      <div class="glass-card-3d p-4 space-y-2 text-xs">
        <div class="font-semibold text-ink-2">Ссылка для клиентов — открывает чат с SI:</div>
        <button onclick="SF.copyText('${SF.js(c.link)}', 'Ссылка скопирована')" class="w-full py-2.5 rounded-xl btn-3d-tiffany text-xs flex items-center justify-center gap-1.5"><i data-lucide="copy" class="w-3.5 h-3.5"></i> Скопировать ссылку</button>
        <button onclick="SF.push('office-consultant', { id: '${SF.js(c.id)}', tab: 'methodology' })" class="w-full py-2.5 rounded-xl btn-3d-dark text-xs">Дополнить настройки: фото, описание, материалы</button>
      </div>`;
  }

  // «Шаблон для продажи другим» (step 5 of «Бизнес-режим 2.0»): only where templates are open (flag funnels)
  function templateEntry() {
    if (!SF.feature('funnels')) return '';
    return `
      <button onclick="SF.push('office-template')" class="w-full p-3.5 rounded-2xl bg-card border-2 border-dashed border-[#81D8D0] flex items-center gap-3 text-left">
        <span class="w-10 h-10 rounded-xl bg-[#81D8D0]/20 flex items-center justify-center flex-shrink-0"><i data-lucide="layers" class="w-5 h-5 text-brand"></i></span>
        <span class="flex-1 min-w-0">
          <span class="block text-sm font-bold text-ink">Шаблон для продажи другим</span>
          <span class="block text-[11px] text-muted leading-snug">Ответьте на бриф — ИИ соберёт скелет продавца, вы поправите, проверите на примерах бизнесов и опубликуете</span>
        </span>
        <i data-lucide="chevron-right" class="w-4 h-4 text-faint"></i>
      </button>`;
  }

  function renderCreate(route = {}) {
    if (SF.feature('quick-start') && route.goal !== 'custom') {
      return route.goal ? renderQuickForm(route.goal) : renderQuickGoals() + templateEntry();
    }
    return `${templateEntry()}
      <form onsubmit="SF.actions.createConsultant(event)" class="glass-card-3d p-4 space-y-3 text-xs">
        <div class="text-[11px] text-muted leading-snug">У каждого SI-продавца есть цель, чёткие инструкции и лимит на клиента — он работает сам, без вашего участия.</div>
        ${field('name', 'Имя для клиентов', '', { placeholder: 'Например: Елена · менторство', max: 60 })}
        <label class="block space-y-1">
          <span class="font-semibold text-ink-2">Роль (всегда начинается с SI)</span>
          <input name="role" list="role-suggestions" placeholder="SI-консультант" maxlength="40" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink" />
          <datalist id="role-suggestions">${ROLE_SUGGESTIONS.map(r => `<option value="${r}"></option>`).join('')}</datalist>
        </label>
        ${field('goal', 'Цель', '', { placeholder: 'Например: записать на разбор', max: 160 })}
        <button type="submit" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm">Создать</button>
        <div class="text-[10px] text-faint text-center">Оффер, цену и ссылку на оплату добавите на следующем шаге.</div>
      </form>
    `;
  }

  // ---------------- Конструктор шаблона: бриф по разделам → ИИ собирает → новый SI-продавец-шаблон ----------------
  // Owner's decisions 22 Nov.: the brief — ниша и продукт · чек и клиенты · цель и кому подходит · стиль и возражения ·
  // путь клиента шаг за шагом и что на каждом шаге. The answers live in memory until «Собрать шаблон».
  const TPL_PARTS = ['Ниша и продукт', 'Чек и клиенты', 'Цель и кому подходит', 'Стиль и возражения', 'Путь клиента'];
  const TPL_PRODUCT = [['consult', 'Консультация'], ['course', 'Курс'], ['mentoring', 'Наставничество'], ['service', 'Услуга'], ['webinar', 'Вебинар или интенсив'], ['goods', 'Товар'], ['other', 'Другое']];
  const TPL_AUDIENCE = [['warm', 'Тёплые — подписчики, уже знают эксперта'], ['cold', 'Холодные — из рекламы, видят впервые'], ['both', 'И те, и другие']];
  const TPL_GOAL = [['sale', 'Продать'], ['booking', 'Записать на встречу или консультацию'], ['lead', 'Собрать заявку'], ['free', 'Выдать бесплатный материал и прогреть']];
  const TPL_TONE = [['soft', 'Мягкий и бережный'], ['expert', 'Экспертный, уверенный'], ['friendly', 'Дружеский, на лёгкой ноте']];
  let tpl = null; // { part, building, data: { … , path: [{ title, content }] } }
  const tplData = () => (tpl || (tpl = { part: 0, building: false, data: { productType: 'course', audience: 'both', goal: 'sale', tone: 'soft', path: [{ title: '', content: '' }, { title: '', content: '' }] } })).data;

  function renderTemplateBuilder() {
    const d = tplData();
    const part = tpl.part;
    const box = 'w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink';
    const inp = (key, label, opts = {}) => `
      <label class="block space-y-1">
        <span class="font-semibold text-ink-2">${label}</span>
        ${opts.rows
          ? `<textarea rows="${opts.rows}" maxlength="${opts.max || 600}" placeholder="${SF.esc(opts.placeholder || '')}" oninput="SF.actions.tplSet('${key}', this.value)" class="${box}">${SF.esc(d[key] || '')}</textarea>`
          : `<input maxlength="${opts.max || 120}" value="${SF.esc(d[key] || '')}" placeholder="${SF.esc(opts.placeholder || '')}" oninput="SF.actions.tplSet('${key}', this.value)" class="${box}" />`}
        ${opts.hint ? `<span class="block text-[10px] text-faint">${opts.hint}</span>` : ''}
      </label>`;
    const choice = (key, list) => `
      <div class="space-y-1.5">${list.map(([id, label]) => `
        <label class="flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer ${d[key] === id ? 'bg-[#81D8D0]/15 border-[#81D8D0]' : 'bg-sunken border-line'}">
          <input type="radio" name="tpl-${key}" ${d[key] === id ? 'checked' : ''} onchange="SF.actions.tplSet('${key}', '${id}', true)" class="accent-[#0d9488]" />
          <span class="text-ink">${label}</span>
        </label>`).join('')}</div>`;
    let body = '';
    if (part === 0) {
      body = `
        ${SF.niches.field({ value: d.nicheName || '', section: d.nicheSection || '', label: 'Ниша', hint: 'Для какой ниши шаблон. Начните писать — появятся подсказки; нет вашей — создастся сама.',
          onName: "SF.actions.tplSet('nicheName', this.value)", onSection: "SF.actions.tplSet('nicheSection', this.value)" })}
        <div class="font-semibold text-ink-2">Тип продукта</div>
        ${choice('productType', TPL_PRODUCT)}
        ${inp('product', 'Что продаёт SI-продавец на этом шаблоне', { rows: 3, placeholder: 'Например: программа питания на 4 недели с меню и поддержкой в чате' })}
        ${inp('title', 'Название шаблона (можно потом)', { max: 80, placeholder: 'Например: Продажа программы нутрициолога' })}`;
    } else if (part === 1) {
      body = `
        ${inp('check', 'Средний чек', { max: 80, placeholder: 'Например: 30 000–60 000 ₸' })}
        <div class="font-semibold text-ink-2">Какие клиенты приходят</div>
        ${choice('audience', TPL_AUDIENCE)}
        ${inp('sources', 'Откуда приходят', { max: 300, placeholder: 'Например: Instagram, реклама в Telegram, сарафанное радио' })}`;
    } else if (part === 2) {
      body = `
        <div class="font-semibold text-ink-2">Цель SI-продавца</div>
        ${choice('goal', TPL_GOAL)}
        ${inp('fitsFor', 'Кому подходит шаблон', { rows: 2, max: 500, placeholder: 'Например: нутрициологам и диетологам с личным брендом и своими курсами' })}
        ${inp('notFor', 'Кому не подходит', { rows: 2, max: 500, placeholder: 'Например: товарному бизнесу, тем, у кого нет своего продукта' })}`;
    } else if (part === 3) {
      body = `
        <div class="font-semibold text-ink-2">Стиль общения</div>
        ${choice('tone', TPL_TONE)}
        ${inp('objections', 'Главные возражения клиентов — каждое с новой строки', { rows: 4, max: 800, placeholder: 'дорого\nнет времени\nуже пробовал(а), не помогло' })}`;
    } else {
      body = `
        <div class="text-[11px] text-muted leading-snug">Как клиент идёт к цели — по шагам, своими словами: что происходит на каждом шаге и что SI говорит или делает. ИИ возьмёт ваши шаги как есть и допишет детали. От 2 до ${MAX_STEPS} шагов.</div>
        ${d.path.map((st, i) => `
          <div class="p-2.5 rounded-xl bg-sunken border border-line space-y-1.5">
            <div class="flex items-center gap-1.5">
              <span class="w-6 h-6 rounded-full bg-[#81D8D0] text-[#08302c] text-[11px] font-extrabold flex items-center justify-center flex-shrink-0">${i + 1}</span>
              <input maxlength="60" value="${SF.esc(st.title)}" placeholder="Название шага: например «Знакомство»" oninput="SF.actions.tplStep(${i}, 'title', this.value)" class="w-full p-2 rounded-xl bg-card border border-line-2 text-ink" />
              ${d.path.length > 2 ? `<button onclick="SF.actions.tplStepRemove(${i})" class="p-1 text-faint" aria-label="Удалить шаг"><i data-lucide="x" class="w-4 h-4"></i></button>` : ''}
            </div>
            <textarea rows="2" maxlength="600" placeholder="Что на этом шаге: например «узнать, что сейчас с питанием и что хочется изменить»" oninput="SF.actions.tplStep(${i}, 'content', this.value)" class="w-full p-2 rounded-xl bg-card border border-line-2 text-ink">${SF.esc(st.content)}</textarea>
          </div>`).join('')}
        ${d.path.length < MAX_STEPS ? '<button onclick="SF.actions.tplStepAdd()" class="w-full py-2 rounded-xl btn-3d-dark text-[11px] flex items-center justify-center gap-1.5"><i data-lucide="plus" class="w-3.5 h-3.5"></i>Шаг</button>' : ''}`;
    }
    const last = part === TPL_PARTS.length - 1;
    if (tpl.building) {
      return `
        <div class="glass-card-3d p-6 text-center space-y-3">
          <div class="mx-auto w-16 h-16 rounded-full bg-[var(--si-bubble)] flex items-center justify-center animate-pulse"><i data-lucide="sparkles" class="w-8 h-8 text-si"></i></div>
          <div class="text-sm font-extrabold text-ink">ИИ собирает шаблон…</div>
          <div class="text-[11px] text-muted leading-snug">Шаги по вашему пути, общее описание, сценарии на возражения и молчание, пазл для покупателей. Обычно до минуты — не закрывайте экран.</div>
        </div>`;
    }
    return `
      <div class="glass-card-3d p-4 space-y-3 text-xs">
        <div class="flex gap-1">${TPL_PARTS.map((_, i) => `<span class="flex-1 h-1.5 rounded-full ${i < part ? 'bg-[#81D8D0]' : i === part ? 'bg-[#0d9488]' : 'bg-sunken'}"></span>`).join('')}</div>
        <div class="text-[10px] text-faint">Бриф шаблона · ${part + 1} из ${TPL_PARTS.length}</div>
        <div class="text-base font-extrabold text-ink">${TPL_PARTS[part]}</div>
        ${body}
        <div class="grid ${part > 0 ? 'grid-cols-2' : 'grid-cols-1'} gap-2 pt-1">
          ${part > 0 ? '<button onclick="SF.actions.tplGo(-1)" class="py-2.5 rounded-xl bg-sunken border border-line text-ink-2">Назад</button>' : ''}
          ${last
            ? '<button onclick="SF.actions.tplBuild()" class="py-2.5 rounded-xl btn-3d-tiffany flex items-center justify-center gap-1.5"><i data-lucide="sparkles" class="w-4 h-4"></i>Собрать шаблон</button>'
            : '<button onclick="SF.actions.tplGo(1)" class="py-2.5 rounded-xl btn-3d-tiffany">Дальше</button>'}
        </div>
      </div>
      <div class="text-[10px] text-faint px-1 leading-snug">Получится новый SI-продавец «Шаблон: …» в открытом бизнесе. Всё можно поправить в его «Методологии», проверить на примерах бизнесов SmartFlow и потом опубликовать.</div>`;
  }

  // Typing keeps the answers without re-drawing; a choice re-draws (its highlight)
  SF.actions.tplSet = (key, value, redraw = false) => { tplData()[key] = value; if (redraw) store().notify(); };
  SF.actions.tplStep = (i, key, value) => { const st = tplData().path[i]; if (st) st[key] = value; };
  SF.actions.tplStepAdd = () => { tplData().path.push({ title: '', content: '' }); store().notify(); };
  SF.actions.tplStepRemove = (i) => { tplData().path.splice(i, 1); store().notify(); };
  SF.actions.tplGo = (delta) => {
    const d = tplData();
    if (delta > 0) {
      if (tpl.part === 0 && !String(d.product || '').trim()) return showToast('Опишите, что продаёт SI-продавец');
      if (tpl.part === 2 && !String(d.fitsFor || '').trim()) return showToast('Напишите, кому подходит шаблон');
    }
    tpl.part = Math.max(0, Math.min(TPL_PARTS.length - 1, tpl.part + delta));
    store().notify();
    const body = document.getElementById('screen-body');
    if (body) body.scrollTo(0, 0);
  };
  SF.actions.tplBuild = async () => {
    if (needServer()) return;
    const d = tplData();
    const path = d.path.map(s => ({ title: String(s.title || '').trim(), content: String(s.content || '').trim() })).filter(s => s.title);
    if (path.length < 2) return showToast('Опишите путь клиента хотя бы в 2 шага — с названиями');
    tpl.building = true;
    store().notify();
    try {
      const res = await api().buildTemplate({ ...d, path, businessId: store().currentBusinessId() });
      tpl = null;
      SF.data.invalidate('consultants');
      SF.data.invalidate('niches');
      await SF.data.myConsultants();
      SF.confetti();
      showToast(res.source === 'openai' ? 'Шаблон собран 🎉 Проверьте и поправьте методологию' : 'Черновик собран из ваших ответов 🎉 Допишите методологию');
      store().popRoute();
      SF.push('office-consultant', { id: res.project.id, tab: 'methodology' });
    } catch (err) {
      tpl.building = false;
      store().notify();
      showToast(SF.withErrorCode(err.message || 'Не получилось собрать', err));
    }
  };

  // Test a template on a SmartFlow demo business («Пример»): the SI answers as if that business bought it
  function renderDemoTest(c, state) {
    if (!c.isTemplate) return '';
    const demos = state.remote.templateDemos;
    return `
      <div class="glass-card-3d p-4 space-y-2.5 text-xs border border-amber-500/50">
        ${SF.sectionTitle('flask-conical', 'Проверить на примере бизнеса')}
        <div class="text-[11px] text-muted leading-snug">Переписка «как клиент», будто шаблон купил этот бизнес: продукт, цена и «Вопросы и ответы» — из примера, скелет — ваш. Настоящие клиенты и цифры не затрагиваются. Каждый раз чат начинается заново.</div>
        ${demos ? `<div class="grid grid-cols-2 gap-1.5">${demos.map(dm => `
          <button onclick="SF.actions.testOnDemo('${SF.js(c.id)}', '${SF.js(dm.id)}')" class="p-2.5 rounded-xl bg-sunken border border-line text-left space-y-0.5">
            <span class="block font-bold text-ink">${SF.esc(dm.title)}</span>
            <span class="block text-[10px] text-muted leading-snug">${SF.esc(dm.product)} · ${SF.esc(dm.price)}</span>
          </button>`).join('')}</div>` : '<div class="text-[11px] text-muted">Загружаю примеры…</div>'}
        <button onclick="SF.actions.testOnDemo('${SF.js(c.id)}', '')" class="w-full py-2 rounded-xl btn-3d-dark text-[11px]">На моих данных</button>
      </div>`;
  }

  SF.actions.testOnDemo = async (projectId, demoId) => {
    if (needServer()) return;
    try {
      const res = await api().testTemplateOnDemo(projectId, demoId);
      // The test chat starts over on the server: forget the old one on the phone too
      SF.data.invalidate(`messages:${res.slug}`);
      store().setRemote(`messages.${res.slug}`, null);
      showToast(res.demo ? `Проверка на примере «${res.demo.title}»` : 'Проверка на ваших данных');
      SF.actions.openChat(res.slug);
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не получилось', err));
    }
  };

  // ---------------- One consultant ----------------
  function renderConsultant(route, state) {
    const c = store().findOfficeConsultant(route.id);
    if (!c) return SF.emptyState('assistant', 'SI-продавец не найден', 'Вернитесь в Офис и выберите другого.');
    if (c.assisting) return renderAssistedConsultant(c, route, state);
    const tab = CONSULTANT_TABS.some(t => t.id === route.tab) ? route.tab : 'analytics';
    let body = '';
    if (tab === 'methodology') body = renderDemoTest(c, state) + renderPuzzle(c, route, state) + renderProductPicker(c, state) + renderMethodology(c, route) + renderConsultantBrain(c, state) + renderAuthorPuzzle(c) + (SF.funnels ? SF.funnels.consultantBlock(c) : '');
    if (tab === 'analytics') body = renderSellerFunnel(c, route, state) + renderAnalytics(c, state);
    if (tab === 'income') body = renderSellerClients(c, route, state);
    if (tab === 'broadcasts') body = renderBroadcasts(c, state);

    return `
      <div class="glass-card-3d p-4 space-y-3 border-[var(--si-bubble-line)]">
        <div class="flex items-center gap-3">
          <button onclick="SF.actions.changeConsultantPhoto('${SF.js(c.id)}')" class="relative flex-shrink-0" aria-label="Изменить фото">
            ${SF.avatar(c.photoUrl, { size: 64, kind: 'si' })}
            <span class="absolute -bottom-1 -left-1 w-7 h-7 rounded-full bg-card border border-line-2 flex items-center justify-center text-ink-2 shadow">
              <i data-lucide="camera" class="w-3.5 h-3.5"></i>
            </span>
          </button>
          <div class="flex-1 min-w-0">
            <div class="text-base font-extrabold text-ink truncate">${SF.esc(c.name)}</div>
            <div class="text-xs">${SF.siLabel(c.roleTitle)}</div>
          </div>
          <button onclick="SF.actions.editConsultant('${SF.js(c.id)}')" class="p-2 rounded-xl btn-3d-dark" aria-label="Изменить имя и роль">
            <i data-lucide="pencil" class="w-4 h-4"></i>
          </button>
        </div>
        <div class="p-2.5 rounded-xl bg-sunken border border-line space-y-1.5">
          <div class="text-[10px] text-muted">Ссылка для клиентов — открывает чат с этим SI-продавцом:</div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-mono text-brand truncate flex-1">${SF.esc(c.link)}</span>
            <button onclick="SF.copyText('${SF.js(c.link)}')" class="px-2 py-1 rounded-lg btn-3d-tiffany text-[11px] flex items-center gap-1"><i data-lucide="copy" class="w-3 h-3"></i>Копировать</button>
          </div>
        </div>
        ${renderSourceLinks(c, state)}
      </div>

      <div class="grid grid-cols-4 gap-1 bg-raised p-1 rounded-2xl border border-line">
        ${CONSULTANT_TABS.map(t => `
          <button onclick="SF.patch({ tab: '${t.id}' })" class="relative py-2 px-1 rounded-xl text-[10px] font-semibold leading-tight flex flex-col items-center gap-1 ${tab === t.id ? 'bg-[#81D8D0] text-[#08302c] shadow' : 'text-muted'}">
            <i data-lucide="${t.icon}" class="w-4 h-4"></i>${t.label}
            ${t.id === 'income' && waitingCount(state, c.id) ? `<span class="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">${waitingCount(state, c.id)}</span>` : ''}
          </button>`).join('')}
      </div>

      ${body}
    `;
  }

  // Links with a traffic source: up to 3 per SI-seller, each counted separately (owner's decision)
  function renderSourceLinks(c, state) {
    const data = state.remote.projectLinks[c.id];
    const stat = (s) => `перешли ${s.opens} · новых людей ${s.newPeople} · клиентов ${s.clients} · написали ${s.wrote} · купили ${s.bought}`;
    return `
      <details class="p-2.5 rounded-xl bg-sunken border border-line text-xs" ${data && data.links.length ? 'open' : ''}>
        <summary class="cursor-pointer font-semibold text-ink-2">Ссылки с меткой источника${data ? ` · ${data.links.length} из ${data.max}` : ''}</summary>
        <div class="space-y-2 mt-2">
          <div class="text-[10px] text-muted leading-snug">Напишите, где будете делиться ссылкой (Instagram, канал, блогер) — получите отдельную ссылку на этого SI-продавца. Видно, сколько людей пришло с каждой и сколько купили.</div>
          ${!data ? '<div class="text-muted">Загружаю…</div>' : ''}
          ${(data ? data.links : []).map(l => `
            <div class="p-2 rounded-lg bg-card border border-line space-y-1">
              <div class="flex items-center gap-2">
                <span class="font-bold text-ink flex-1 truncate">${SF.esc(l.label)}</span>
                <button onclick="SF.copyText('${SF.js(l.url)}')" class="px-2 py-1 rounded-lg btn-3d-tiffany text-[10px] flex items-center gap-1"><i data-lucide="copy" class="w-3 h-3"></i>Копировать</button>
                <button onclick="SF.actions.removeSourceLink('${SF.js(c.id)}', '${SF.js(l.id)}', '${SF.js(l.label)}')" class="p-1 rounded-lg btn-3d-dark" aria-label="Убрать ссылку"><i data-lucide="x" class="w-3 h-3"></i></button>
              </div>
              <div class="text-[10px] font-mono text-brand truncate">${SF.esc(l.url)}</div>
              <div class="text-[10px] text-muted">${stat(l.stats)}</div>
            </div>`).join('')}
          ${data && data.withoutLink ? `<div class="text-[10px] text-faint">Без метки (по обычной ссылке): клиентов ${data.withoutLink}</div>` : ''}
          ${data && data.links.length < data.max ? `
            <form onsubmit="SF.actions.addSourceLink(event, '${SF.js(c.id)}')" class="flex gap-2">
              <input name="label" maxlength="40" placeholder="Источник: Instagram, канал, блогер…" class="flex-1 min-w-0 p-2 rounded-lg bg-card border border-line-2 text-ink" />
              <button type="submit" class="px-3 rounded-lg btn-3d-tiffany text-[11px] font-bold">Создать</button>
            </form>` : ''}
        </div>
      </details>`;
  }

  SF.actions.addSourceLink = async (e, projectId) => {
    e.preventDefault();
    if (needServer()) return;
    const label = e.target.label.value.trim();
    if (!label) {
      showToast('Напишите источник, например: Instagram');
      return;
    }
    try {
      const res = await api().createProjectLink(projectId, label);
      SF.data.invalidate(`projectLinks:${projectId}`);
      await SF.data.projectLinks(projectId);
      SF.copyText(res.link.url, 'Ссылка создана и скопирована');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не получилось', err));
    }
  };

  SF.actions.removeSourceLink = async (projectId, linkId, label) => {
    if (needServer()) return;
    if (!confirm(`Убрать ссылку «${label}» из списка? Она продолжит работать, а пришедшие по ней клиенты останутся посчитанными.`)) return;
    try {
      await api().removeProjectLink(projectId, linkId);
      SF.data.invalidate(`projectLinks:${projectId}`);
      await SF.data.projectLinks(projectId);
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не получилось', err));
    }
  };

  // The assistant: the SI-seller's clients only
  // Клиенты of one SI-продавец: «Мне написали» · all clients · the calendar of its business
  function renderSellerClients(c, route, state) {
    const ctab = CLIENT_TABS.some(([id]) => id === route.ctab) ? route.ctab : (waitingCount(state, c.id) ? 'inbox' : 'all');
    return `
      <div class="grid grid-cols-3 gap-1 bg-raised p-1 rounded-2xl border border-line">
        ${CLIENT_TABS.map(([id, label]) => `
          <button onclick="SF.patch({ ctab: '${id}' })" class="relative py-2 rounded-xl text-[11px] font-semibold ${ctab === id ? 'bg-[#81D8D0] text-[#08302c] shadow' : 'text-muted'}">${label}
            ${id === 'inbox' && waitingCount(state, c.id) ? `<span class="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">${waitingCount(state, c.id)}</span>` : ''}
          </button>`).join('')}
      </div>
      ${ctab === 'inbox' ? renderInbox(state, c) : ''}
      ${ctab === 'all' ? renderClients(c, state) : ''}
      ${ctab === 'calendar' ? `<div class="text-[10px] text-faint px-1">Календарь общий для всех SI-продавцов этого бизнеса.</div>${c.businessId ? renderCalendar(state, c.businessId) : '<div class="text-xs text-muted">Загружаю…</div>'}` : ''}
    `;
  }

  // ---------------- «Пазл» («Бизнес-режим 2.0», шаг 3) ----------------
  // What this SI-продавец knows, what it still lacks, and the expert's own additions «тема → как отвечать».
  let noteForm = null; // { projectId, id?, topic?, text?, stepId? }
  // The open piece of the funnel author's puzzle: one question at a time (owner's decision 22 Nov., «интервью»)
  let pieceForm = null; // { projectId, pieceId, index, draft: { questionId: text }, found: { questionId: true }, saving }
  function renderPuzzle(c, route, state) {
    const pz = state.remote.puzzle[c.id];
    if (!pz) return '<div class="glass-card-3d p-4 text-xs text-muted">Загружаю пазл…</div>';
    // From «Мне написали»: the form opens with the client's question as the topic
    if (route.noteTopic && (!noteForm || noteForm.projectId !== c.id)) noteForm = { projectId: c.id, topic: route.noteTopic, source: 'inquiry' };
    const form = noteForm && noteForm.projectId === c.id ? noteForm : null;
    const steps = c.steps || [];
    const stepTitle = (id) => (steps.find(st => st.id === id) || {}).title || '';
    const toggle = (key, label, hint, on) => `
      <label class="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-sunken border border-line cursor-pointer">
        <span><span class="block font-semibold text-ink">${label}</span><span class="block text-[10px] text-faint leading-snug">${hint}</span></span>
        <input type="checkbox" ${on ? 'checked' : ''} onchange="SF.actions.setPuzzleAccess('${SF.js(c.id)}', '${key}', this.checked)" class="w-5 h-5 accent-[#0d9488] flex-shrink-0" />
      </label>`;
    const field2 = 'w-full bg-card border border-line-2 rounded-xl px-3 py-2 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]';
    const funnel = pz.mode === 'funnel';
    return `
      <div class="glass-card-3d p-4 space-y-3 text-xs">
        ${renderPuzzleGame(c, pz)}
        ${funnel ? renderPieceInterview(c, pz) : ''}
        <div class="space-y-1.5">
          <div class="text-[11px] font-bold text-muted uppercase tracking-wider">Что брать из Мозга</div>
          ${funnel ? `
            <label class="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-sunken border border-line cursor-pointer">
              <span><span class="block font-semibold text-ink">Доступ шаблона к Мозгу</span><span class="block text-[10px] text-faint leading-snug">Что уже есть в Мозге, подставится в ответы само. Ваши ответы тоже сохранятся в Мозг.</span></span>
              <input type="checkbox" ${pz.access.brain ? 'checked' : ''} onchange="SF.actions.setPuzzleBrain('${SF.js(c.id)}', this.checked)" class="w-5 h-5 accent-[#0d9488] flex-shrink-0" />
            </label>` : ''}
          ${toggle('knowsBusiness', 'Знает о бизнесе', 'Что вы делаете и для кого — из Офиса → «Мозг».', pz.access.knowsBusiness)}
          ${toggle('knowsProfile', 'Знает обо мне', 'О себе, регалии и результаты из вашего Профиля.', pz.access.knowsProfile)}
          <div class="text-[10px] text-faint leading-snug">Продукт и материалы этого SI выбираются ниже.</div>
        </div>
        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-bold text-muted uppercase tracking-wider">Дополнения</span>
            ${!form ? `<button onclick="SF.actions.openNoteForm('${SF.js(c.id)}')" class="px-2 py-1 rounded-lg btn-3d-dark text-[10px] flex items-center gap-1"><i data-lucide="plus" class="w-3 h-3"></i>Добавить</button>` : ''}
          </div>
          <div class="text-[10px] text-faint leading-snug">О чём спрашивают клиенты и как отвечать. SI отвечает на эти темы именно так — даже с подключённой готовой воронкой.</div>
          ${pz.notes.map(n => `
            <div class="p-2.5 rounded-xl bg-card border border-line space-y-0.5">
              <div class="flex items-start justify-between gap-2">
                <span class="font-bold text-ink">${SF.esc(n.topic)}${n.stepId && stepTitle(n.stepId) ? ` <span class="text-[10px] font-normal text-faint">· шаг «${SF.esc(stepTitle(n.stepId))}»</span>` : ''}</span>
                <span class="flex gap-1 flex-shrink-0">
                  <button onclick="SF.actions.editNote('${SF.js(c.id)}', '${SF.js(n.id)}')" class="p-1 text-faint" aria-label="Изменить"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>
                  <button onclick="SF.actions.deleteNote('${SF.js(c.id)}', '${SF.js(n.id)}')" class="p-1 text-faint" aria-label="Удалить"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                </span>
              </div>
              <div class="text-ink-2 whitespace-pre-line">${SF.esc(n.text)}</div>
            </div>`).join('')}
          ${!pz.notes.length && !form ? '<div class="text-[11px] text-muted">Пока нет. Добавляйте, когда видите в «Мне написали», что SI чего-то не знал.</div>' : ''}
          ${form ? `
            <form onsubmit="SF.actions.saveNote(event, '${SF.js(c.id)}')" class="p-2.5 rounded-xl bg-sunken border border-[#81D8D0] space-y-1.5">
              <input name="topic" required maxlength="120" value="${SF.esc(form.topic || '')}" placeholder="Тема: например «Рассрочка»" class="${field2}" />
              <textarea name="text" required rows="3" maxlength="1500" placeholder="Как отвечать: например «Только Kaspi Red на 3 месяца»" class="${field2}">${SF.esc(form.text || '')}</textarea>
              ${steps.length ? `
                <select name="stepId" class="${field2}">
                  <option value="">Ко всему разговору</option>
                  ${steps.map(st => `<option value="${SF.esc(st.id)}" ${form.stepId === st.id ? 'selected' : ''}>Шаг «${SF.esc(st.title)}»</option>`).join('')}
                </select>` : ''}
              <div class="grid grid-cols-2 gap-1.5">
                <button type="button" onclick="SF.actions.closeNoteForm()" class="py-2 rounded-xl bg-card border border-line text-ink-2">Отмена</button>
                <button type="submit" class="py-2 rounded-xl btn-3d-tiffany">${form.id ? 'Сохранить' : 'Добавить'}</button>
              </div>
            </form>` : ''}
        </div>
      </div>`;
  }

  // ---------------- The puzzle as a game (owner's request 22 Nov.: «геймифицируй пазл») ----------------
  // 8 pieces around the SI in the middle — like the logo: SI in the centre, the pieces of knowledge around it.
  // A piece lights up when it is really filled (the server checks the real data — nothing is made up).
  // Levels of the SI; «Следующий кусочек» — the most important missing one; confetti when a piece or a level is new.
  const PIECE_SHORT = { offer: 'Продукт', price: 'Цена', payment: 'Оплата', business: 'О бизнесе', profile: 'Обо мне', materials: 'Материалы', path: 'Путь клиента', access: 'Доступ' };
  const PIECE_ICON = { offer: 'shopping-bag', price: 'wallet', payment: 'receipt', business: 'briefcase', profile: 'user', materials: 'file-text', path: 'route', access: 'gift' };
  // Grid 3×3: the SI in the middle cell (index 4), the pieces around it clockwise from the top left
  const PIECE_CELLS = [0, 1, 2, 5, 8, 7, 6, 3];
  const PUZZLE_LEVELS = [
    { name: 'Собирается', hint: 'Соберите оранжевые кусочки — и SI сможет продавать.' },
    { name: 'Готов продавать', hint: 'Главное есть. Ещё кусочки — и SI ответит на больше вопросов.' },
    { name: 'Хорошо подготовлен', hint: 'Почти всё на месте. Осталось чуть-чуть.' },
    { name: 'Пазл собран', hint: 'SI знает всё основное. Учите его дальше: «Научить SI» в «Мне написали».' },
    { name: 'Собран и учится у вас', hint: 'Каждое дополнение делает SI точнее.' }
  ];
  function puzzleLevel(pz) {
    if (pz.missingRequired.length) return 0;
    if (pz.done === pz.total) return pz.notes.length >= 3 ? 4 : 3;
    return pz.done >= Math.ceil(pz.total * 0.75) ? 2 : 1;
  }

  function renderPuzzleGame(c, pz) {
    const level = puzzleLevel(pz);
    const funnel = pz.mode === 'funnel';
    // A piece of the funnel author opens its questions right here; the standard ones lead to their place
    const go = (it) => funnel ? `SF.actions.openPiece('${SF.js(c.id)}', '${SF.js(it.id)}')` : `SF.actions.puzzleGo('${SF.js(c.id)}', '${it.place}')`;
    const short = (it) => funnel ? SF.esc(it.label) : (PIECE_SHORT[it.id] || it.label);
    const icon = (it) => (it.done ? (funnel ? 'check' : PIECE_ICON[it.id] || 'puzzle') : 'puzzle');
    const order = { true: 0, false: 1 };
    // The next piece: a required one first, then in the list order
    const next = pz.items.filter(i => !i.done).sort((x, y) => order[x.required] - order[y.required])[0] || null;
    const cells = Array(9).fill(null);
    pz.items.slice(0, 8).forEach((it, i) => { cells[PIECE_CELLS[i]] = it; });
    // Fewer pieces than 8 (the author decides): empty places around the SI stay quiet
    const empty = '<div class="aspect-square rounded-2xl border border-dashed border-line opacity-40"></div>';
    const piece = (it) => `
      <button onclick="${go(it)}" title="${SF.esc(it.label)}"
        class="aspect-square rounded-2xl flex flex-col items-center justify-center gap-1 p-1 text-center transition
          ${pieceForm && pieceForm.projectId === c.id && pieceForm.pieceId === it.id ? 'ring-2 ring-[#0d9488]' : ''}
          ${it.done ? 'bg-[#81D8D0] text-[#08302c] shadow' : it.required ? 'border-2 border-dashed border-amber-500 bg-amber-500/10 text-amber-500' : 'border-2 border-dashed border-line-2 bg-sunken text-faint'}">
        <i data-lucide="${icon(it)}" class="w-5 h-5"></i>
        <span class="text-[10px] font-bold leading-tight line-clamp-2">${short(it)}</span>
      </button>`;
    return `
      <div class="flex items-center justify-between gap-2">
        ${SF.sectionTitle('puzzle', 'Пазл SI')}
        <span class="text-[11px] font-bold ${pz.missingRequired.length ? 'text-amber-500' : 'text-brand'}">${pz.done} из ${pz.total}</span>
      </div>
      <div class="grid grid-cols-3 gap-1.5 max-w-[300px] mx-auto">
        ${cells.map((it, i) => (i === 4 ? `
          <div class="aspect-square rounded-2xl bg-[var(--si-bubble)] border border-[var(--si-bubble-line)] flex flex-col items-center justify-center gap-1">
            ${SF.avatar(c.photoUrl, { size: 40, kind: 'si' })}
            <span class="text-[9px] font-bold text-si">Ур. ${level + 1}</span>
          </div>` : it ? piece(it) : empty)).join('')}
      </div>
      ${funnel ? `
        <div class="p-2.5 rounded-xl text-[11px] leading-snug ${pz.release.released ? 'bg-[#81D8D0]/15 border border-[#81D8D0] text-ink' : 'bg-amber-500/10 border border-amber-500/50 text-ink'}">
          ${pz.release.released
            ? `<b class="text-brand">Шаблон${pz.funnelTitle ? ` «${SF.esc(pz.funnelTitle)}»` : ''} работает</b> — SI продаёт по нему. Кусочки этого шаблона выбрал его автор.`
            : `<b class="text-amber-500">Шаблон${pz.funnelTitle ? ` «${SF.esc(pz.funnelTitle)}»` : ''} включится</b>, ${SF.esc(pz.release.text)} — так решил его автор, чтобы SI не продавал без нужного. Пока SI работает по вашей методологии.`}
        </div>` : ''}
      <div class="p-3 rounded-2xl bg-sunken border border-line space-y-1.5">
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm font-extrabold text-ink">${PUZZLE_LEVELS[level].name}</span>
          <span class="text-sm tracking-widest" aria-label="Уровень ${level + 1} из 5"><span class="text-amber-400">${'★'.repeat(level + 1)}</span><span class="text-faint">${'★'.repeat(4 - level)}</span></span>
        </div>
        <div class="text-[11px] text-muted leading-snug">${PUZZLE_LEVELS[level].hint}</div>
        ${next ? `
          <button onclick="${go(next)}" class="w-full py-2.5 rounded-xl ${next.required ? 'btn-3d-tiffany' : 'btn-3d-dark'} text-xs flex items-center justify-center gap-1.5">
            <i data-lucide="puzzle" class="w-3.5 h-3.5"></i>Следующий кусочек: ${SF.esc(next.label)}
          </button>
          <div class="text-[10px] text-faint text-center leading-snug">${SF.esc(next.hint)}</div>` : ''}
        ${pz.notes.length ? `<div class="text-[10px] text-brand font-semibold text-center">Вы научили SI ${pz.notes.length} ${pz.notes.length % 10 === 1 && pz.notes.length % 100 !== 11 ? 'теме' : 'темам'}</div>` : ''}
      </div>`;
  }

  // ---------------- The author's editor: the puzzle the buyers of this funnel fill in ----------------
  // The author (marketer) decides which pieces this funnel needs, the questions of each piece, where the
  // answer may already be in the buyer's Brain, and when the funnel may start selling. Frozen on publishing.
  const PUZZLE_SOURCES = [
    ['', 'Эксперт отвечает сам'],
    ['brain', 'Материалы SI-мозга (SI найдёт сам)'],
    ['business.about', 'Мозг → о бизнесе'],
    ['business.niche', 'Мозг → ниша'],
    ['product.name', 'Продукт → название'],
    ['product.description', 'Продукт → описание'],
    ['product.result', 'Продукт → результат клиента'],
    ['product.format', 'Продукт → формат'],
    ['product.duration', 'Продукт → длительность'],
    ['product.price_label', 'Продукт → цена'],
    ['product.installment', 'Продукт → рассрочка'],
    ['product.guarantee', 'Продукт → гарантия'],
    ['seller.payment_url', 'Ссылка на оплату'],
    ['seller.access_url', 'Ссылка на доступ после оплаты'],
    ['profile.headline', 'Профиль → чем занимаюсь'],
    ['profile.bio', 'Профиль → о себе'],
    ['profile.regalia', 'Профиль → регалии'],
    ['profile.results', 'Профиль → результаты']
  ];
  const MAX_AUTHOR_PIECES = 8;
  const MAX_AUTHOR_QUESTIONS = 6;
  let authorPuzzle = null; // { projectId, open, pieces, release }

  function authorDraft(c) {
    if (!authorPuzzle || authorPuzzle.projectId !== c.id) {
      const src = c.puzzle || { pieces: [], release: { mode: 'required' } };
      authorPuzzle = { projectId: c.id, open: false, pieces: JSON.parse(JSON.stringify(src.pieces || [])), release: { mode: 'required', ...(src.release || {}) } };
    }
    return authorPuzzle;
  }

  function renderAuthorPuzzle(c) {
    if (!SF.feature('funnels') || c.assisting) return '';
    const d = authorDraft(c);
    const f = 'w-full bg-card border border-line-2 rounded-xl px-2.5 py-2 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]';
    const pid = SF.js(c.id);
    if (!d.open) {
      return `
        <div class="glass-card-3d p-3.5 flex items-center gap-3 text-xs">
          <i data-lucide="puzzle" class="w-5 h-5 text-brand flex-shrink-0"></i>
          <span class="flex-1 text-ink-2 leading-snug"><b class="text-ink">Пазл для покупателей шаблона</b><br>${d.pieces.length ? `Кусочков: ${d.pieces.length}. Эксперт ответит на ваши вопросы, и шаблон включится по вашему условию.` : 'Какие сведения нужны вашему шаблону от эксперта — решаете вы.'}</span>
          <button onclick="SF.actions.authorPuzzleOpen(true)" class="px-3 py-2 rounded-xl btn-3d-dark text-[11px] flex-shrink-0">${d.pieces.length ? 'Изменить' : 'Создать'}</button>
        </div>`;
    }
    const inp = (path, value, ph, max) => `<input value="${SF.esc(value || '')}" maxlength="${max}" placeholder="${ph}" oninput="SF.actions.authorPuzzleSet('${path}', this.value)" class="${f}" />`;
    return `
      <div id="author-puzzle" class="glass-card-3d p-4 space-y-3 text-xs">
        <div class="flex items-center justify-between gap-2">
          ${SF.sectionTitle('puzzle', 'Пазл для покупателей шаблона')}
          <button onclick="SF.actions.authorPuzzleOpen(false)" class="p-1 text-faint" aria-label="Свернуть"><i data-lucide="chevron-up" class="w-4 h-4"></i></button>
        </div>
        <div class="text-[11px] text-muted leading-snug">Эксперт, купивший шаблон, увидит эти кусочки вокруг своего SI и ответит на вопросы по одному. Что уже есть в его Мозге, подставится само. Без лишнего: только то, что нужно этому шаблону. До ${MAX_AUTHOR_PIECES} кусочков, в каждом до ${MAX_AUTHOR_QUESTIONS} вопросов. Изменения дойдут до покупателей, когда вы сохраните шаблон снова.</div>
        ${d.pieces.map((p, i) => `
          <div class="p-2.5 rounded-xl bg-sunken border border-line space-y-2">
            <div class="flex items-center gap-1.5">
              <span class="w-6 h-6 rounded-lg bg-[#81D8D0] text-[#08302c] text-[11px] font-extrabold flex items-center justify-center flex-shrink-0">${i + 1}</span>
              ${inp(`${i}.title`, p.title, 'Название кусочка: например «Ваш клиент»', 40)}
              <button onclick="SF.actions.authorPuzzleRemove(${i})" class="p-1.5 rounded-lg btn-3d-dark flex-shrink-0" aria-label="Удалить кусочек"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
            </div>
            <label class="flex items-center gap-2 text-[11px] text-ink-2"><input type="checkbox" ${p.required !== false ? 'checked' : ''} onchange="SF.actions.authorPuzzleSet('${i}.required', this.checked)" class="w-4 h-4 accent-[#0d9488]" />Обязательный</label>
            ${(p.questions || []).map((q, j) => `
              <div class="p-2 rounded-xl bg-card border border-line space-y-1.5">
                <div class="flex items-center gap-1.5">
                  <span class="text-[10px] font-bold text-faint w-5 flex-shrink-0">${j + 1}.</span>
                  ${inp(`${i}.q.${j}.text`, q.text, 'Вопрос эксперту', 200)}
                  <button onclick="SF.actions.authorPuzzleRemove(${i}, ${j})" class="p-1 text-faint flex-shrink-0" aria-label="Удалить вопрос"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>
                </div>
                ${inp(`${i}.q.${j}.hint`, q.hint, 'Подсказка (необязательно): например «возраст, ситуация, боль»', 200)}
                <select onchange="SF.actions.authorPuzzleSet('${i}.q.${j}.source', this.value)" class="${f}">
                  ${PUZZLE_SOURCES.map(([v, label]) => `<option value="${v}" ${String(q.source || '') === v ? 'selected' : ''}>${v ? 'Ответ может быть: ' : ''}${label}</option>`).join('')}
                </select>
              </div>`).join('')}
            ${(p.questions || []).length < MAX_AUTHOR_QUESTIONS ? `<button onclick="SF.actions.authorPuzzleAdd(${i})" class="w-full py-1.5 rounded-xl bg-card border border-dashed border-line-2 text-ink-2 text-[11px]">+ Вопрос</button>` : ''}
          </div>`).join('')}
        ${d.pieces.length < MAX_AUTHOR_PIECES ? `<button onclick="SF.actions.authorPuzzleAdd()" class="w-full py-2 rounded-xl btn-3d-dark text-[11px] flex items-center justify-center gap-1.5"><i data-lucide="plus" class="w-3.5 h-3.5"></i>Кусочек</button>` : ''}
        <div class="space-y-1.5 pt-2 border-t border-line">
          <div class="font-semibold text-ink-2">Когда воронка начинает продавать у эксперта</div>
          <select onchange="SF.actions.authorPuzzleSet('release.mode', this.value)" class="${f}">
            <option value="required" ${d.release.mode === 'required' ? 'selected' : ''}>Когда собраны все обязательные кусочки</option>
            <option value="all" ${d.release.mode === 'all' ? 'selected' : ''}>Когда собраны все кусочки</option>
            <option value="count" ${d.release.mode === 'count' ? 'selected' : ''}>Когда собрано столько кусочков:</option>
          </select>
          ${d.release.mode === 'count' ? `<input type="number" min="1" max="${Math.max(1, d.pieces.length)}" value="${SF.esc(d.release.count || d.pieces.length || 1)}" oninput="SF.actions.authorPuzzleSet('release.count', this.value)" class="${f}" />` : ''}
          <div class="text-[10px] text-faint leading-snug">Пока условие не выполнено, SI эксперта работает по его методологии — неполный SI не испортит ваши цифры и имя.</div>
        </div>
        <button onclick="SF.actions.authorPuzzleSave('${pid}')" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm">Сохранить пазл</button>
      </div>`;
  }

  SF.actions.authorPuzzleOpen = (open) => { if (authorPuzzle) { authorPuzzle.open = open; store().notify(); } };
  // Typing keeps the draft without re-drawing; a checkbox or a select re-draws only when it changes the form
  SF.actions.authorPuzzleSet = (path, value) => {
    if (!authorPuzzle) return;
    const parts = path.split('.');
    if (parts[0] === 'release') {
      authorPuzzle.release[parts[1]] = parts[1] === 'count' ? parseInt(value, 10) || 1 : value;
      if (parts[1] === 'mode') store().notify();
      return;
    }
    const piece = authorPuzzle.pieces[Number(parts[0])];
    if (!piece) return;
    if (parts[1] === 'q') {
      const q = (piece.questions || [])[Number(parts[2])];
      if (q) q[parts[3]] = value;
    } else piece[parts[1]] = value;
  };
  SF.actions.authorPuzzleAdd = (pieceIndex) => {
    if (!authorPuzzle) return;
    if (pieceIndex === undefined) authorPuzzle.pieces.push({ title: '', required: true, questions: [{ text: '', hint: '', source: '' }] });
    else authorPuzzle.pieces[pieceIndex].questions.push({ text: '', hint: '', source: '' });
    store().notify();
  };
  SF.actions.authorPuzzleRemove = (pieceIndex, questionIndex) => {
    if (!authorPuzzle) return;
    if (questionIndex === undefined) authorPuzzle.pieces.splice(pieceIndex, 1);
    else authorPuzzle.pieces[pieceIndex].questions.splice(questionIndex, 1);
    store().notify();
  };
  SF.actions.authorPuzzleSave = async (id) => {
    if (!authorPuzzle || needServer()) return;
    try {
      const project = await api().getProject(id);
      const res = await api().updateProject(id, { custom_ai_settings: { ...(project.custom_ai_settings || {}), puzzle: { pieces: authorPuzzle.pieces, release: authorPuzzle.release } } });
      const puzzle = (res.custom_ai_settings || {}).puzzle || { pieces: [], release: { mode: 'required' } };
      store().updateOfficeConsultant(id, { puzzle });
      authorPuzzle = { projectId: id, open: false, pieces: JSON.parse(JSON.stringify(puzzle.pieces)), release: { ...puzzle.release } };
      store().notify();
      showToast(puzzle.pieces.length ? `Пазл сохранён: кусочков ${puzzle.pieces.length}. Сохраните шаблон снова («Мои шаблоны» → «Изменить»), чтобы он дошёл до покупателей` : 'Пазл пуст: кусочек без названия или без вопросов не сохраняется');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не сохранилось', err));
    }
  };

  // ---------------- A piece of the funnel author's puzzle: questions one by one ----------------
  // What the Brain has is already in the answer (the expert may change it); «Сохранить» at the bottom → confetti.
  function renderPieceInterview(c, pz) {
    const form = pieceForm && pieceForm.projectId === c.id ? pieceForm : null;
    const piece = form && pz.items.find(i => i.id === form.pieceId);
    if (!piece) return '';
    const qs = piece.questions;
    const i = Math.min(form.index, qs.length - 1);
    const q = qs[i];
    const value = form.draft[q.id] !== undefined ? form.draft[q.id] : (q.answer || q.prefill || '');
    const fromBrain = !q.answer && ((q.prefill && form.draft[q.id] === undefined) || form.found[q.id]);
    const last = i === qs.length - 1;
    return `
      <div id="puzzle-piece" class="p-3 rounded-2xl bg-card border-2 border-[#81D8D0] space-y-2.5">
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm font-extrabold text-ink flex items-center gap-1.5"><i data-lucide="puzzle" class="w-4 h-4 text-brand"></i>${SF.esc(piece.label)}</span>
          <button onclick="SF.actions.closePiece()" class="p-1 text-faint" aria-label="Закрыть"><i data-lucide="x" class="w-4 h-4"></i></button>
        </div>
        <div class="flex gap-1" aria-label="Вопрос ${i + 1} из ${qs.length}">
          ${qs.map((x, j) => `<span class="flex-1 h-1.5 rounded-full ${j < i ? 'bg-[#81D8D0]' : j === i ? 'bg-[#0d9488]' : 'bg-sunken'}"></span>`).join('')}
        </div>
        <div class="text-[10px] text-faint">Вопрос ${i + 1} из ${qs.length}</div>
        <div class="text-[13px] font-bold text-ink leading-snug">${SF.esc(q.text)}</div>
        ${q.hint ? `<div class="text-[11px] text-muted leading-snug">${SF.esc(q.hint)}</div>` : ''}
        ${fromBrain ? `<div class="text-[10px] font-semibold text-brand flex items-center gap-1"><i data-lucide="sparkles" class="w-3 h-3"></i>${form.found[q.id] ? 'SI нашёл в ваших материалах' : `Взято из Мозга${q.sourceLabel ? ` (${SF.esc(q.sourceLabel)})` : ''}`} — проверьте и поправьте, если нужно</div>` : ''}
        ${form.searching && q.source === 'brain' && !value ? '<div class="text-[10px] text-faint">SI ищет ответ в ваших материалах…</div>' : ''}
        <textarea id="piece-answer" rows="4" maxlength="2000" oninput="SF.actions.pieceInput('${SF.js(q.id)}', this.value)"
          placeholder="Ваш ответ своими словами" class="w-full bg-sunken border border-line-2 rounded-xl px-3 py-2 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]">${SF.esc(value)}</textarea>
        <div class="grid ${i > 0 ? 'grid-cols-2' : 'grid-cols-1'} gap-1.5">
          ${i > 0 ? '<button onclick="SF.actions.pieceStep(-1)" class="py-2 rounded-xl bg-sunken border border-line text-ink-2">Назад</button>' : ''}
          ${last ? '' : '<button onclick="SF.actions.pieceStep(1)" class="py-2 rounded-xl btn-3d-dark">Дальше</button>'}
          ${last && i > 0 ? '<span></span>' : ''}
        </div>
        ${last ? `<button onclick="SF.actions.savePiece()" ${form.saving ? 'disabled' : ''} class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm flex items-center justify-center gap-1.5"><i data-lucide="check" class="w-4 h-4"></i>${form.saving ? 'Сохраняю…' : 'Сохранить'}</button>` : ''}
      </div>`;
  }

  // Remember what this phone has seen, so the next look does not throw the confetti again
  function rememberPuzzle(projectId, pz) {
    try { localStorage.setItem(`sf_puzzle_${projectId}`, JSON.stringify({ done: pz.done, level: puzzleLevel(pz) })); } catch (e) { /* private mode */ }
  }

  SF.actions.openPiece = async (projectId, pieceId) => {
    const pz = store().data.remote.puzzle[projectId];
    const piece = pz && pz.items.find(i => i.id === pieceId);
    if (!piece) return;
    // The first question without an answer (all answered — from the start, to look and change)
    const first = piece.questions.findIndex(q => !q.answer);
    pieceForm = { projectId, pieceId, index: first < 0 ? 0 : first, draft: {}, found: {}, saving: false, searching: false };
    store().notify();
    setTimeout(() => { const el = document.getElementById('puzzle-piece'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
    // «SI найдёт сам»: questions the author pointed to the Brain's materials
    if (pz.access.brain && piece.questions.some(q => q.source === 'brain' && !q.answer)) {
      pieceForm.searching = true;
      try {
        const res = await api().suggestPuzzlePiece(projectId, pieceId);
        if (pieceForm && pieceForm.pieceId === pieceId) {
          for (const [qid, text] of Object.entries(res.suggestions || {})) {
            if (pieceForm.draft[qid] === undefined) { pieceForm.draft[qid] = text; pieceForm.found[qid] = true; }
          }
        }
      } catch (err) { /* nothing found — the expert writes it */ }
      if (pieceForm) { pieceForm.searching = false; store().notify(); }
    }
  };
  SF.actions.closePiece = () => { pieceForm = null; store().notify(); };
  SF.actions.pieceInput = (qid, value) => { if (pieceForm) pieceForm.draft[qid] = value; };
  SF.actions.pieceStep = (delta) => {
    if (!pieceForm) return;
    pieceForm.index = Math.max(0, pieceForm.index + delta);
    store().notify();
    setTimeout(() => { const el = document.getElementById('piece-answer'); if (el) el.focus(); }, 50);
  };
  SF.actions.savePiece = async () => {
    const form = pieceForm;
    if (!form || form.saving) return;
    const pz = store().data.remote.puzzle[form.projectId];
    const piece = pz && pz.items.find(i => i.id === form.pieceId);
    if (!piece) return;
    // Every question goes: what the expert typed, else what was there (the saved answer or the Brain's)
    const answers = {};
    for (const q of piece.questions) answers[q.id] = String(form.draft[q.id] !== undefined ? form.draft[q.id] : (q.answer || q.prefill || '')).trim();
    form.saving = true;
    store().notify();
    try {
      const res = await api().savePuzzlePiece(form.projectId, form.pieceId, answers);
      const { saved, ...next } = res;
      pieceForm = null;
      rememberPuzzle(form.projectId, next);
      store().setRemote(`puzzle.${form.projectId}`, next);
      SF.data.invalidate('office'); // the funnel may have just started
      // Dopamine on every «Сохранить» (owner's decision): the bigger the step, the bigger the word
      SF.confetti();
      if (saved.released) showToast('Пазл собран — шаблон включён, SI продаёт по нему 🎉');
      else if (saved.newlyDone) showToast(`Кусочек «${piece.label}» на месте 🧩 Собрано ${next.done} из ${next.total}`);
      else if (saved.done) showToast('Сохранено — SI уже знает это ✨');
      else showToast(`Сохранено. Осталось ответить: ${piece.questions.filter(q => !answers[q.id]).length}`);
    } catch (err) {
      form.saving = false;
      store().notify();
      showToast(SF.withErrorCode(err.message || 'Не сохранилось', err));
    }
  };
  SF.actions.setPuzzleBrain = async (projectId, on) => {
    try {
      store().setRemote(`puzzle.${projectId}`, await api().setPuzzleBrain(projectId, on));
      showToast(on ? 'Шаблон берёт ответы из Мозга' : 'Шаблон не берёт ответы из Мозга');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не получилось', err));
    }
  };

  // A piece or a level is new since this phone last saw this SI-продавец: confetti and a short word
  function celebratePuzzle(projectId, pz) {
    const key = `sf_puzzle_${projectId}`;
    const level = puzzleLevel(pz);
    let seen = null;
    try { seen = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { seen = null; }
    try { localStorage.setItem(key, JSON.stringify({ done: pz.done, level })); } catch (e) { /* private mode */ }
    if (!seen) return; // the first look is the starting point
    if (level > seen.level) {
      SF.confetti();
      showToast(`Новый уровень SI: «${PUZZLE_LEVELS[level].name}» 🎉`);
    } else if (pz.done > seen.done) {
      SF.confetti();
      showToast('Новый кусочек пазла на месте 🧩');
    }
  }

  // «Дополнить»: to the place where this piece is filled in
  SF.actions.puzzleGo = (projectId, place) => {
    if (place === 'business') return SF.openIn('marketplace', 'office', { section: 'brain' });
    if (place === 'profile') return SF.openIn('profile', 'edit');
    const target = { product: 'seller-product', card: 'seller-card', materials: 'seller-brain', methodology: 'seller-methodology' }[place];
    const el = target && document.getElementById(target);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  SF.actions.setPuzzleAccess = async (projectId, key, on) => {
    try {
      store().setRemote(`puzzle.${projectId}`, await api().setPuzzleAccess(projectId, { [key]: on }));
      showToast(on ? 'SI теперь знает это' : 'SI больше не берёт это из Мозга');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не получилось', err));
    }
  };

  SF.actions.openNoteForm = (projectId) => { noteForm = { projectId }; store().notify(); };
  SF.actions.closeNoteForm = () => {
    noteForm = null;
    const route = store().currentRoute();
    if (route.noteTopic) SF.patch({ noteTopic: null });
    else store().notify();
  };
  SF.actions.editNote = (projectId, noteId) => {
    const n = ((store().data.remote.puzzle[projectId] || {}).notes || []).find(x => x.id === noteId);
    if (n) { noteForm = { projectId, id: n.id, topic: n.topic, text: n.text, stepId: n.stepId }; store().notify(); }
  };
  SF.actions.saveNote = async (e, projectId) => {
    e.preventDefault();
    const f = e.target;
    const note = { topic: f.topic.value.trim(), text: f.text.value.trim(), stepId: f.stepId ? f.stepId.value : '', source: (noteForm && noteForm.source) || 'manual' };
    try {
      const res = noteForm && noteForm.id
        ? await api().updateSellerNote(projectId, noteForm.id, note)
        : await api().addSellerNote(projectId, note);
      store().setRemote(`puzzle.${projectId}`, res);
      noteForm = null;
      if (store().currentRoute().noteTopic) SF.patch({ noteTopic: null });
      showToast('Сохранено — SI уже отвечает так');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не сохранилось', err));
    }
  };
  SF.actions.deleteNote = async (projectId, noteId) => {
    if (!window.confirm('Удалить дополнение?')) return;
    try {
      store().setRemote(`puzzle.${projectId}`, await api().deleteSellerNote(projectId, noteId));
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не получилось', err));
    }
  };

  // From «Мне написали»: the client asked something the SI did not know — teach it right here
  SF.actions.noteFromInquiry = (projectId, reason) => {
    noteForm = null;
    SF.openIn('marketplace', 'office-consultant', { id: projectId, tab: 'methodology', noteTopic: String(reason || '').slice(0, 120) });
  };

  // Which product of the business this SI-продавец sells: what is not in its card, it takes from the product
  function renderProductPicker(c, state) {
    const products = c.businessId ? state.remote.products[c.businessId] : [];
    if (!products) return '';
    return `
      <div id="seller-product" class="glass-card-3d p-3.5 space-y-2 text-xs">
        ${SF.sectionTitle('shopping-bag', 'Продукт')}
        ${products.length ? `
          <select onchange="SF.actions.attachProduct('${SF.js(c.id)}', this.value)" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink text-xs">
            <option value="">Без продукта</option>
            ${products.map(p => `<option value="${SF.esc(p.id)}" ${c.productId === p.id ? 'selected' : ''}>${SF.esc(p.name)} · ${SF.esc(productPrice(p))}</option>`).join('')}
          </select>
          <div class="text-[10px] text-faint leading-snug">Чего нет в карточке этого SI-продавца (оффер, цена, ссылки), он возьмёт из продукта. Своё в карточке главнее.</div>`
        : `<div class="text-muted leading-snug">Продуктов пока нет. Добавьте их в Офисе → «Мозг» — и привяжите здесь.</div>`}
      </div>`;
  }

  function renderAssistedConsultant(c, route, state) {
    const tab = ['income', 'analytics', 'broadcasts'].includes(route.tab) ? route.tab : 'income';
    return `
      <div class="glass-card-3d p-4 flex items-center gap-3 border-[var(--si-bubble-line)]">
        ${SF.avatar(c.photoUrl, { size: 56, kind: 'si' })}
        <div class="flex-1 min-w-0">
          <div class="text-base font-extrabold text-ink truncate">${SF.esc(c.name)}</div>
          <div class="text-xs">${SF.siLabel(c.roleTitle)}</div>
          <div class="text-[10px] text-brand mt-0.5">Бизнес: ${SF.esc(c.ownerName)} · вы помощник</div>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-1 bg-raised p-1 rounded-2xl border border-line">
        ${[['analytics', 'Воронка'], ['income', 'Клиенты'], ['broadcasts', 'Рассылки']].map(([id, label]) => `
          <button onclick="SF.patch({ tab: '${id}' })" class="py-2 rounded-xl text-[11px] font-semibold ${tab === id ? 'bg-[#81D8D0] text-[#08302c] shadow' : 'text-muted'}">${label}</button>`).join('')}
      </div>
      ${tab === 'income' ? renderSellerClients(c, route, state) : ''}
      ${tab === 'analytics' ? renderSellerFunnel(c, route, state) : ''}
      ${tab === 'broadcasts' ? renderBroadcasts(c, state) : ''}
    `;
  }

  // The price mode and the card button: each expert chooses for their goal and situation (owner's decision 20 Nov.)
  const PRICE_MODES = [['fixed', 'Фиксированная цена'], ['free', 'Бесплатно'], ['on_request', 'Цена по запросу — зависит от ситуации']];
  const CTA_KINDS = [
    ['buy', 'Купить', 'открывает оплату по вашей ссылке'],
    ['free', 'Получить бесплатно', 'открывает чат: SI выдаёт бесплатное'],
    ['book', 'Записаться на консультацию', 'открывает чат: SI помогает записаться'],
    ['price', 'Узнать цену', 'открывает чат: SI называет цену или узнаёт ситуацию'],
    ['ask', 'Задать вопрос', 'открывает чат с SI']
  ];
  function cardOfferFields(c) {
    const select = (name, options, value) => `
      <select name="${name}" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink">
        ${options.map(([v, label]) => `<option value="${v}" ${value === v ? 'selected' : ''}>${label}</option>`).join('')}
      </select>`;
    return `
      <label class="block space-y-1">
        <span class="font-semibold text-ink-2">Цена</span>
        ${select('priceMode', PRICE_MODES, c.priceMode || 'fixed')}
      </label>
      ${field('priceLabel', 'Сумма (для фиксированной цены)', c.priceLabel, { placeholder: 'Например: 25 000 ₸', max: 80 })}
      <label class="block space-y-1">
        <span class="font-semibold text-ink-2">Кнопка на карточке</span>
        ${select('ctaKind', CTA_KINDS.map(([v, label, what]) => [v, `${label} — ${what}`]), c.ctaKind || 'buy')}
      </label>
      ${field('ctaLabel', 'Свой текст кнопки (необязательно)', c.ctaLabel, { placeholder: 'Например: Хочу на разбор', max: 40, hint: 'Холодным людям отправляйте ссылку на чат, прогретым — ссылку на карточку. Карточку можно отправить по ссылке, даже если SI-продавец не показан в Маркетплейсе.' })}`;
  }

  // A ready-made funnel connected to the SI-seller: the SI follows it, the own methodology waits
  function readyFunnelNote(c) {
    const f = c.readyFunnel;
    if (!f) return '';
    return `
      <div class="glass-card-3d p-3.5 space-y-1.5 text-xs border border-[#81D8D0]">
        <div class="font-bold text-ink flex items-center gap-1.5"><i data-lucide="layers" class="w-4 h-4 text-brand"></i>${f.waitingPuzzle ? 'Шаблон ждёт пазл' : f.active ? 'Работает по шаблону' : 'Шаблон не продлён'} «${SF.esc(f.title)}»</div>
        <div class="text-[11px] text-ink-2 leading-snug">${f.waitingPuzzle
          ? 'Соберите пазл выше — и SI начнёт вести клиентов по шагам шаблона. Пока он работает по вашей методологии ниже.'
          : f.active
          ? `SI ведёт клиентов по его шагам: ${f.steps.map(st => SF.esc(st.title)).join(' → ')}. Ваши цель, инструкции, шаги и сценарии ниже сохранены и снова заработают, если отключить шаблон${f.until ? ' или не продлить оплату' : ''}.`
          : 'Оплаченный месяц закончился — SI снова работает по вашей методологии ниже. Оплатите следующий месяц, чтобы вернуть шаблон.'}</div>
        <button type="button" onclick="SF.push('office-funnels', { view: 'bought' })" class="text-[11px] text-brand font-semibold">Купленные шаблоны →</button>
      </div>`;
  }

  // The niche's name by its id (the list of niches is loaded with the Office)
  function nicheName(id) {
    const n = id && store().data.remote.niches && store().data.remote.niches.niches.find(x => x.id === id);
    return n ? n.name : '';
  }

  function renderMethodology(c, route = {}) {
    return `${readyFunnelNote(c)}
      <form onsubmit="SF.actions.saveConsultant(event, '${SF.js(c.id)}')" class="space-y-3 text-xs">
        <div id="seller-card" class="glass-card-3d p-4 space-y-3">
          ${SF.sectionTitle('store', 'Карточка в Маркетплейсе')}
          ${field('slug', 'Адрес ссылки — латиницей', c.slug, { placeholder: 'Например: aliya-nutri', max: 32, hint: 'Короткий и понятный адрес для Instagram и рассылок. Старая ссылка продолжит работать.' })}
          ${field('offer', 'Оффер — что получит клиент', c.offer, { placeholder: 'Например: выйти из операционки за 8 недель', max: 200 })}
          ${field('description', 'Описание', c.description, { placeholder: 'Коротко: для кого, как проходит, что внутри', rows: 3, max: 1000 })}
          ${SF.niches.field({ value: nicheName(c.nicheId), hint: 'По нише клиенты находят вас в Маркетплейсе. Начните писать — появятся подсказки; нет вашей — создастся сама.' })}
          ${SF.feature('card-cta') ? cardOfferFields(c) : field('priceLabel', 'Цена', c.priceLabel, { placeholder: 'Например: 25 000 ₽ или Бесплатно', max: 80 })}
          ${field('paymentUrl', 'Ваша ссылка на оплату', c.paymentUrl, { type: 'url', placeholder: 'https://...', max: 300, hint: 'Своя у каждого SI-продавца. Кнопка «Купить» ведёт сюда, деньги приходят вам напрямую.' })}
          ${field('accessUrl', 'Ссылка на доступ после оплаты (необязательно)', c.accessUrl, { type: 'url', placeholder: 'https://... (курс, закрытый канал)', max: 300, hint: 'Клиент получит её, только когда вы или помощник подтвердите его чек. SI эту ссылку не знает и сам не выдаёт.' })}
          <div class="grid grid-cols-2 gap-2">
            <label class="block space-y-1">
              <span class="font-semibold text-ink-2">Тип</span>
              <select name="category" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink">
                <option value="sales" ${c.category !== 'warmup' ? 'selected' : ''}>Продажи</option>
                <option value="warmup" ${c.category === 'warmup' ? 'selected' : ''}>Прогрев и заявки</option>
              </select>
            </label>
            ${field('trialDays', 'Пробный период, дней', c.trialDays || 0, { type: 'number', max: 2 })}
          </div>
          <label class="flex items-center gap-2.5 p-3 rounded-xl bg-sunken border border-line cursor-pointer">
            <input type="checkbox" name="isListed" ${c.isListed ? 'checked' : ''} class="w-4 h-4 accent-[#0d9488]" />
            <span class="text-xs font-semibold text-ink">Показывать в Маркетплейсе</span>
          </label>
          <div class="space-y-1.5 pt-1">
            <div class="font-semibold text-ink-2">Вопросы и ответы</div>
            <div class="text-[10px] text-faint leading-snug">Видны всем в карточке, как на маркетплейсах. SI отвечает по ним; чего здесь и в сведениях нет — передаёт вопрос вам, и клиент ждёт вашего ответа в чате.</div>
            ${SF.niches.faqEditor(c.faq)}
          </div>
          <div class="text-[10px] text-faint leading-snug px-1">Показанный в Маркетплейсе SI-продавец может появляться и в чатах других экспертов — когда их клиенту что-то не подошло. Чем подробнее в методологии описан продукт и закрыты возражения (общее описание, сценарии, шаги), тем чаще он появляется.</div>
        </div>

        <div class="glass-card-3d p-4 space-y-3">
          ${SF.sectionTitle('target', 'Методология: цель, инструкции, лимит')}
          ${field('goal', 'Цель', c.goal, { placeholder: 'Например: записать на разбор', max: 160 })}
          ${field('instructions', 'Инструкции', c.instructions, { placeholder: 'Что можно и чего нельзя: не обещать результат в цифрах, вопросы про договор передавать мне...', rows: 4, max: 800 })}
          ${field('clientLimit', 'Лимит ответов SI на одного клиента', c.clientLimit || 40, { type: 'number', max: 3 })}
        </div>

        <button type="submit" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm">Сохранить</button>
      </form>
      ${renderSteps(c, route)}
      ${renderScenarios(c)}
    `;
  }

  // Steps of the funnel: the client's path. A step: what the SI does, when it is done, a material
  function stepForm(c, step, i) {
    const editing = Boolean(step);
    step = step || {};
    return `
      <form onsubmit="SF.actions.saveStep(event, '${SF.js(c.id)}', '${editing ? SF.js(step.id) : ''}')" class="space-y-2 ${editing ? 'p-2.5 rounded-xl bg-sunken border border-[#81D8D0]' : 'pt-2 border-t border-line'}">
        ${editing ? `<div class="font-bold text-ink">Шаг ${i + 1}</div>` : ''}
        ${field('title', 'Название шага', step.title || '', { placeholder: 'Например: Знакомство', max: 60 })}
        ${field('goal', 'Что SI делает на этом шаге', step.goal || '', { placeholder: 'Например: узнать ситуацию клиента и что для него сейчас важнее всего', rows: 2, max: 300 })}
        ${field('doneWhen', 'Шаг пройден, когда… (необязательно)', step.doneWhen || '', { placeholder: 'Например: клиент рассказал о своей ситуации', max: 200, hint: 'Тогда SI переведёт клиента на следующий шаг. Слово в кавычках, например «готов», сработает, даже если SI не уверен.' })}
        ${field('material', 'Материал шага (необязательно)', step.material || '', { placeholder: 'Например: Вот бесплатный урок: https://...', rows: 2, max: 500, hint: 'Текст или ссылка. Клиент получит их от SI, когда дойдёт до этого шага (один раз).' })}
        <div class="flex gap-2">
          ${editing ? `<button type="button" onclick="SF.patch({ editStep: '' })" class="flex-1 py-2.5 rounded-xl btn-3d-dark">Отмена</button>` : ''}
          <button type="submit" class="flex-1 py-2.5 rounded-xl btn-3d-tiffany">${editing ? 'Сохранить шаг' : 'Добавить шаг'}</button>
        </div>
      </form>`;
  }

  function renderSteps(c, route) {
    const steps = c.steps || [];
    return `
      <div class="glass-card-3d p-4 space-y-3 text-xs">
        ${SF.sectionTitle('footprints', 'Шаги воронки')}
        <div class="text-[11px] text-muted leading-snug">Путь клиента к покупке, по порядку: например, знакомство → материал или вебинар → вопросы и возражения → встреча или оффер → оплата. SI видит, на каком шаге каждый клиент, и мягко ведёт к следующему. В «Воронке» видно, где люди останавливаются. По умолчанию шагов нет — до ${MAX_STEPS}.</div>
        ${steps.map((st, i) => route.editStep === st.id ? stepForm(c, st, i) : `
          <div class="p-2.5 rounded-xl bg-sunken border border-line flex items-start gap-2">
            <span class="w-6 h-6 rounded-full bg-[#81D8D0] text-[#08302c] text-[11px] font-extrabold flex items-center justify-center flex-shrink-0">${i + 1}</span>
            <div class="flex-1 min-w-0 space-y-0.5">
              <div class="font-bold text-ink">${SF.esc(st.title)}</div>
              ${st.goal ? `<div class="text-ink-2">${SF.esc(st.goal)}</div>` : ''}
              ${st.doneWhen ? `<div><span class="text-faint">Пройден, когда</span> <span class="text-ink-2">${SF.esc(st.doneWhen)}</span></div>` : ''}
              ${st.material ? `<div class="text-brand truncate">📎 ${SF.esc(st.material)}</div>` : ''}
            </div>
            <div class="flex flex-col gap-1">
              <button onclick="SF.patch({ editStep: '${SF.js(st.id)}' })" class="p-1.5 rounded-lg btn-3d-dark" aria-label="Изменить шаг"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>
              ${i > 0 ? `<button onclick="SF.actions.moveStep('${SF.js(c.id)}', ${i}, -1)" class="p-1.5 rounded-lg btn-3d-dark" aria-label="Выше"><i data-lucide="arrow-up" class="w-3.5 h-3.5"></i></button>` : ''}
              ${i < steps.length - 1 ? `<button onclick="SF.actions.moveStep('${SF.js(c.id)}', ${i}, 1)" class="p-1.5 rounded-lg btn-3d-dark" aria-label="Ниже"><i data-lucide="arrow-down" class="w-3.5 h-3.5"></i></button>` : ''}
              <button onclick="SF.actions.removeStep('${SF.js(c.id)}', '${SF.js(st.id)}')" class="p-1.5 rounded-lg btn-3d-dark" aria-label="Удалить шаг"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
            </div>
          </div>`).join('')}
        ${!steps.length ? '<div class="text-faint">Шагов пока нет.</div>' : ''}
        ${steps.length >= MAX_STEPS ? `<div class="text-faint">Добавлено ${MAX_STEPS} шагов — это максимум.</div>` : stepForm(c, null, steps.length)}
      </div>`;
  }

  // Methodology: "если…, то…" — SI answers by them, hands the client over or tells the owner
  // What a branch is called: its title, or its condition
  function scenarioName(sc) {
    if (!sc) return '';
    if (sc.title) return sc.title;
    if (sc.when === 'custom') return sc.condition;
    return SCENARIO_WHEN[sc.when] || '';
  }

  // Hints under "Что сказать или сделать" for each action
  const THEN_HINTS = {
    si_says: ['Что SI должен сказать', 'Например: мягко рассказать про рассрочку на 3 месяца'],
    send_text: ['Текст или ссылка, которые получит клиент', 'Например: Вот запись урока, о которой я говорила: https://...'],
    handover: ['Что передать человеку (необязательно)', 'Например: обсудить индивидуальные условия'],
    notify: ['Что напомнить вам (необязательно)', 'Например: позвонить и предложить скидку']
  };

  // Methodology: the funnel is a tree of branches "если…, то…" the expert (or marketer) builds
  function renderScenarios(c) {
    const list = c.scenarios || [];
    const steps = c.steps || [];
    const stepTitle = (id) => SF.esc((steps.find(st => st.id === id) || {}).title || '');
    const whenText = (sc) => {
      if (sc.when === 'step_reached') return `Клиент перешёл на шаг «${stepTitle(sc.step)}»`;
      if (sc.when === 'custom') return SF.esc(sc.condition);
      if (sc.when === 'silent') {
        const after = (sc.after === 'text' && `после «${SF.esc(sc.afterText)}»`) || SILENT_AFTER[sc.after]
          || `после сценария «${SF.esc(scenarioName(list.find(o => o.id === sc.after)))}»`;
        return `Клиент молчит ${minutesLabel(sc.minutes)} ${after}`;
      }
      return `${SCENARIO_WHEN[sc.when] || ''}${sc.when === 'objection' && sc.words ? ` («${SF.esc(sc.words)}»)` : ''}`;
    };
    return `
      <div id="seller-methodology" class="glass-card-3d p-4 space-y-3 text-xs">
        ${SF.sectionTitle('git-branch', 'Методология: сценарии «если…, то…»')}
        <form onsubmit="SF.actions.saveMethodology(event, '${SF.js(c.id)}')" class="space-y-2">
          ${field('methodology', 'Общее описание', c.methodology || '', { rows: 6, max: 3000, placeholder: 'Опишите своими словами, как SI ведёт клиента к покупке: с чего начинает, какие вопросы задаёт, когда предлагает оффер, каким тоном говорит.', hint: 'SI следует этому описанию в каждом разговоре. Ниже — отдельные сценарии для особых случаев.' })}
          <button type="submit" class="w-full py-2.5 rounded-xl btn-3d-dark">Сохранить описание</button>
        </form>
        <div class="text-[11px] text-muted leading-snug pt-2 border-t border-line">Каждый сценарий ведёт клиента к покупке своим путём. По умолчанию сценариев нет — вы создаёте их сами, до ${MAX_SCENARIOS}. Например: «если клиент спрашивает про рассрочку → отправить материал о рассрочке», «если молчит 60 минут после этого сценария → SI спрашивает, удалось ли посмотреть».</div>
        ${list.map((sc, i) => `
          <div class="p-2.5 rounded-xl bg-sunken border border-line flex items-start gap-2">
            <div class="flex-1 min-w-0 space-y-0.5">
              ${sc.title ? `<div class="font-bold text-brand">${SF.esc(sc.title)}</div>` : ''}
              ${sc.step && sc.when !== 'step_reached' ? `<div class="text-[10px] text-faint">Только на шаге «${stepTitle(sc.step)}»</div>` : ''}
              <div><span class="text-faint">Если</span> <span class="font-semibold text-ink">${whenText(sc)}</span></div>
              <div><span class="text-faint">то</span> <span class="font-semibold text-ink">${SCENARIO_THEN[sc.then] || ''}</span>${sc.text ? `<span class="text-ink-2">: ${SF.esc(sc.text)}</span>` : ''}</div>
            </div>
            <button onclick="SF.actions.removeScenario('${SF.js(c.id)}', ${i})" class="p-1.5 rounded-lg btn-3d-dark" aria-label="Удалить сценарий"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
          </div>`).join('')}
        ${!list.length ? '<div class="text-faint">Сценариев пока нет.</div>' : ''}
        ${list.length >= MAX_SCENARIOS ? `<div class="text-faint">Добавлено ${MAX_SCENARIOS} сценариев — это максимум. Удалите ненужный, чтобы добавить новый.</div>` : `
        <form onsubmit="SF.actions.addScenario(event, '${SF.js(c.id)}')" class="space-y-2 pt-2 border-t border-line">
          ${field('title', 'Название сценария (необязательно)', '', { placeholder: 'Например: Хочет рассрочку', max: 60 })}
          <label class="block space-y-1">
            <span class="font-semibold text-ink-2">Когда срабатывает</span>
            <select name="when" onchange="this.form.condition.closest('[data-custom]').style.display = this.value === 'custom' ? '' : 'none'; this.form.minutes.closest('[data-silent]').style.display = this.value === 'silent' ? '' : 'none'; if (this.form.step) this.form.step.firstElementChild.textContent = this.value === 'step_reached' ? 'выберите шаг' : 'на любом шаге'" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink">
              <option value="custom">Клиент написал или сделал то, что я опишу</option>
              <option value="silent">Клиент молчит</option>
              ${steps.length ? '<option value="step_reached">Клиент перешёл на шаг воронки</option>' : ''}
            </select>
          </label>
          ${steps.length ? `
          <label class="block space-y-1">
            <span class="font-semibold text-ink-2">Шаг воронки</span>
            <select name="step" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink">
              <option value="">на любом шаге</option>
              ${steps.map((st, i) => `<option value="${SF.esc(st.id)}">${i + 1}. ${SF.esc(st.title)}</option>`).join('')}
            </select>
            <span class="block text-[10px] text-faint">Сценарий сработает, только пока клиент на этом шаге.</span>
          </label>` : ''}
          <div data-custom class="space-y-1">
            ${field('condition', 'Если… (опишите словами)', '', { placeholder: 'Опишите, что клиент написал или сделал', rows: 2, max: 200 })}
            <div class="p-2 rounded-lg bg-sunken border border-line text-[10px] text-muted leading-snug">
              <div class="font-semibold text-ink-2">Примеры, как можно написать:</div>
              <div>• клиент сказал, что дорого</div>
              <div>• клиент спросил про рассрочку</div>
              <div>• клиент ответил, что у него уже есть свой бизнес</div>
              <div>• клиент нажал «Купить», но не оплатил</div>
              <div class="pt-0.5 text-faint">SI сам заметит это в переписке и в нажатых кнопках. Слово в кавычках, например «рассрочка», сработает, даже если SI не уверен.</div>
            </div>
          </div>
          <div data-silent style="display:none" class="space-y-2">
            ${field('minutes', 'Сколько минут молчит', 60, { type: 'number', max: 5, hint: '60 = 1 час, 1440 = сутки. Срабатывает один раз, пока клиент снова не напишет.' })}
            <label class="block space-y-1">
              <span class="font-semibold text-ink-2">После чего замолчал</span>
              <select name="after" onchange="this.form.afterText.parentElement.style.display = this.value === 'text' ? '' : 'none'" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink">
                <option value="any">в любой момент разговора</option>
                <option value="text">опишу словами</option>
                ${list.filter(o => o.when !== 'silent').map(o => `<option value="${SF.esc(o.id)}">после сценария «${SF.esc(scenarioName(o))}»</option>`).join('')}
              </select>
            </label>
            <label class="block space-y-1" style="display:none">
              <span class="font-semibold text-ink-2">После того, как…</span>
              <input name="afterText" maxlength="200" placeholder="Опишите, после чего клиент замолчал" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink" />
              <span class="block text-[10px] text-faint">Например: SI назвал цену · клиенту отправили материал · клиент сказал «подумаю»</span>
            </label>
          </div>
          <label class="block space-y-1">
            <span class="font-semibold text-ink-2">То</span>
            <select name="then" onchange="const h = SF.office.thenHints[this.value]; this.form.text.parentElement.querySelector('span').textContent = h[0]; this.form.text.placeholder = h[1]" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink">
              ${Object.entries(SCENARIO_THEN).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}
            </select>
          </label>
          ${field('text', THEN_HINTS.si_says[0], '', { placeholder: THEN_HINTS.si_says[1], rows: 2, max: 500 })}
          <button type="submit" class="w-full py-2.5 rounded-xl btn-3d-tiffany">Добавить сценарий</button>
        </form>`}
      </div>
    `;
  }

  // Two ways in: how many clients came by each and how many bought (owner's decision 20 Nov.)
  function renderEntries(a) {
    const e = a.entries || {};
    const row = (label, v) => v && v.clients ? `
      <div class="flex items-center justify-between gap-2 py-1.5 border-t border-line first:border-0">
        <span class="text-ink-2">${label}</span>
        <span class="font-bold text-ink whitespace-nowrap">${v.clients} <span class="text-faint font-normal">· купили ${v.bought}</span></span>
      </div>` : '';
    const rows = row('С карточки', e.card) + row('По ссылке на чат', e.link) + row('По ссылкам с меткой', e.source) + row('Раньше (до 20 нояб.)', e.old);
    return `
      <div class="glass-card-3d p-4 space-y-1 text-xs">
        ${SF.sectionTitle('route', 'Откуда пришли клиенты')}
        <div class="text-muted">Открыли карточку: <span class="font-bold text-ink">${a.cardViews || 0}</span> чел.</div>
        ${rows || '<div class="text-muted">Клиентов пока нет.</div>'}
      </div>`;
  }

  function renderAnalytics(c, state) {
    const a = state.remote.analytics[c.id];
    if (!a) return '<div class="text-xs text-muted">Загружаю…</div>';
    const tile = (label, value) => `
      <div class="p-3 rounded-xl bg-card border border-line">
        <div class="text-[10px] text-muted">${label}</div>
        <div class="text-lg font-extrabold text-ink">${value}</div>
      </div>`;
    return `
      <div class="grid grid-cols-2 gap-2">
        ${tile('Клиентов', a.clients || 0)}
        ${tile('Написали SI', a.talked || 0)}
        ${tile('Сообщений клиентов', a.clientMessages || 0)}
        ${tile('Ответов SI', a.siReplies || 0)}
        ${tile('Просили человека', a.humanRequests || 0)}
        ${tile('Ждут ответа', a.waiting || 0)}
      </div>
      ${renderEntries(a)}
      <div class="text-[10px] text-faint px-1">Только настоящие цифры этого SI-продавца. Оплаты идут вам напрямую, поэтому продажи здесь пока не считаются. Советы SI по воронке появятся позже.</div>
      ${renderOwnerReviews(c, state)}
    `;
  }

  // Reviews of real clients: the expert answers, never deletes (owner's decision)
  function renderOwnerReviews(c, state) {
    const list = state.remote.projectReviews[c.id];
    return `
      <div class="glass-card-3d p-4 space-y-2.5 text-xs">
        ${SF.sectionTitle('message-square-heart', 'Отзывы клиентов')}
        ${!list ? '<div class="text-muted">Загружаю…</div>' : ''}
        ${list && !list.length ? '<div class="text-muted leading-snug">Отзывов пока нет. Оставить отзыв может только клиент, которого вы или помощник отметили «Купил». Он увидит приглашение в чате с SI-продавцом.</div>' : ''}
        ${(list || []).map(r => `
          <div class="space-y-1.5 pt-2 border-t border-line first:border-0 first:pt-0">
            <div class="flex items-center justify-between gap-2">
              <span class="font-bold text-ink">${SF.esc(r.name)}${r.hidden ? ' <span class="text-[10px] text-faint font-normal">· скрыт командой после жалобы</span>' : ''}</span>
              ${SF.stars(r.rating)}
            </div>
            ${r.text ? `<p class="text-ink-2 leading-relaxed whitespace-pre-line">${SF.esc(r.text)}</p>` : ''}
            <form onsubmit="SF.actions.replyReview(event, '${SF.js(c.id)}', '${SF.js(r.id)}')" class="space-y-1.5">
              <textarea name="text" rows="2" maxlength="1000" placeholder="Ответить на отзыв (увидят все)" class="w-full p-2 rounded-xl bg-sunken border border-line-2 text-ink">${SF.esc(r.reply || '')}</textarea>
              <button type="submit" class="w-full py-2 rounded-xl btn-3d-dark text-[11px]">${r.reply ? 'Изменить ответ' : 'Ответить'}</button>
            </form>
          </div>`).join('')}
        ${list && list.length ? '<div class="text-[10px] text-faint">Удалить отзыв нельзя — можно ответить. Если отзыв нарушает правила, нажмите «Пожаловаться» на карточке в Маркетплейсе: команда проверит.</div>' : ''}
      </div>
    `;
  }

  function renderClients(c, state) {
    const clients = state.remote.clients[c.id];
    if (!clients) return '<div class="text-xs text-muted">Загружаю…</div>';
    if (!clients.length) {
      return SF.emptyState('consultant', 'Клиентов пока нет', 'Отправьте ссылку SI-продавца в свой канал, сторис или рассылку — клиенты появятся здесь.');
    }
    return `
      <div class="flex gap-2 overflow-x-auto snap-x snap-mandatory pb-1 -mx-1 px-1">
        ${clients.map(cl => `
          <button onclick="SF.push('office-client', { id: '${SF.js(cl.id)}', projectId: '${SF.js(c.id)}' })" class="snap-start flex-shrink-0 w-[31%] min-w-[104px] p-2.5 rounded-2xl bg-card border border-line text-left space-y-1">
            ${SF.avatar(cl.avatar_url, { size: 32 })}
            <div class="text-[11px] font-bold text-ink truncate">${SF.esc(cl.name)}</div>
            <div class="text-[10px] font-semibold truncate ${cl.si_paused ? 'text-amber-400' : 'text-muted'}">${cl.si_paused ? (cl.responsible_user_id === myUserId() ? 'Ждёт вас' : `Отвечает ${SF.esc(cl.responsible_name || 'человек')}`) : 'Говорит с SI'}</div>
          </button>`).join('')}
      </div>
      <div class="space-y-1.5">
        ${clients.map(cl => `
          <button onclick="SF.push('office-client', { id: '${SF.js(cl.id)}', projectId: '${SF.js(c.id)}' })" class="w-full p-2.5 rounded-xl bg-card border border-line flex items-center gap-2.5 text-left">
            ${SF.avatar(cl.avatar_url, { size: 32 })}
            <span class="flex-1 min-w-0">
              <span class="block text-xs font-bold text-ink truncate">${SF.esc(cl.name)}</span>
              <span class="block text-[10px] text-muted truncate">${SF.esc(String(cl.last_message || '').replace(/^\[(SI|Эксперт|Помощник)\]:\s*/, ''))}</span>
            </span>
            <span class="text-[10px] text-faint whitespace-nowrap">${timeLabel(cl.last_activity)}</span>
          </button>`).join('')}
      </div>
    `;
  }

  // ---------------- Broadcasts: announcements in words, SI picks whom and drafts; sent only after confirming ----------------
  const BROADCAST_STATUSES = [
    { id: 'not_finished', label: 'Не дошли до конца' },
    { id: 'objections', label: 'Есть возражения' },
    { id: 'waiting_human', label: 'Ждут человека' },
    { id: 'bought', label: 'Купили' }
  ];
  const BROADCAST_DAYS = [{ id: '', label: 'Все' }, { id: '7', label: '7 дней' }, { id: '30', label: '30 дней' }, { id: '90', label: '90 дней' }];
  const BROADCAST_STATE = {
    draft: ['Черновик', 'text-muted'],
    pending_approval: ['Ждёт одобрения владельца', 'text-amber-500'],
    sending: ['Отправляется', 'text-brand'],
    sent: ['Отправлена', 'text-emerald-500'],
    cancelled: ['Отменена', 'text-faint']
  };
  const broadcastDrafts = {}; // { [projectId]: { request, audience, text, count, sample, busy } }

  function broadcastDraft(projectId) {
    return broadcastDrafts[projectId] || (broadcastDrafts[projectId] = { request: '', audience: { statuses: [], stepIds: [], days: null, objection: '' }, text: '', count: null, sample: [], open: false });
  }

  function renderBroadcasts(c, state) {
    const assisting = Boolean(c.assisting);
    const data = state.remote.broadcasts[c.id];
    const d = broadcastDraft(c.id);
    const a = d.audience;
    const steps = c.steps || [];
    const chip = (active, onclick, label) => `<button type="button" onclick="${onclick}" class="px-2 py-1 rounded-lg border text-[11px] ${active ? 'bg-[#81D8D0] text-[#08302c] border-[#81D8D0] font-semibold' : 'bg-sunken text-muted border-line'}">${label}</button>`;
    const id = SF.js(c.id);
    return `
      <div class="glass-card-3d p-4 space-y-2.5 text-xs">
        ${SF.sectionTitle('send-horizontal', 'Новая рассылка')}
        <div class="text-[11px] text-muted leading-snug">Анонс мероприятия, новость, акция. Напишите словами, кому и что отправить, — SI подберёт клиентов и подготовит текст. Ничего не уйдёт без вашего подтверждения${assisting ? ' (рассылку помощника одобряет владелец)' : ''}.</div>
        <textarea rows="3" maxlength="500" data-keep="bc-request-${id}" oninput="SF.office.broadcastField('${id}', 'request', this.value)" placeholder="Например: всем, кто не купил за последний месяц, — пригласить на бесплатный эфир в субботу в 19:00" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink">${SF.esc(d.request)}</textarea>
        <div class="flex gap-2">
          <button onclick="SF.actions.planBroadcast('${id}')" ${d.busy ? 'disabled' : ''} class="flex-1 py-2.5 rounded-xl btn-3d-tiffany font-bold disabled:opacity-60">${d.busy ? 'SI готовит…' : 'Подготовить'}</button>
          ${!d.open ? `<button onclick="SF.actions.openBroadcastForm('${id}')" class="px-3 py-2.5 rounded-xl btn-3d-dark">Вручную</button>` : ''}
        </div>
        ${d.open ? `
          <div class="space-y-2 pt-2 border-t border-line">
            <div class="font-semibold text-ink-2">Кому</div>
            <div class="flex flex-wrap gap-1.5">
              ${chip(!a.statuses.length, `SF.actions.broadcastStatus('${id}', '')`, 'Всем')}
              ${BROADCAST_STATUSES.map(st => chip(a.statuses.includes(st.id), `SF.actions.broadcastStatus('${id}', '${st.id}')`, st.label)).join('')}
            </div>
            ${steps.length ? `
              <div class="text-[11px] text-muted">Шаг воронки (необязательно)</div>
              <div class="flex flex-wrap gap-1.5">${steps.map((st, i) => chip(a.stepIds.includes(st.id), `SF.actions.broadcastStep('${id}', '${SF.js(st.id)}')`, `${i + 1}. ${SF.esc(st.title)}`)).join('')}</div>` : ''}
            <div class="text-[11px] text-muted">Писали за последние</div>
            <div class="flex flex-wrap gap-1.5">${BROADCAST_DAYS.map(dd => chip(String(a.days || '') === dd.id, `SF.actions.broadcastDays('${id}', '${dd.id}')`, dd.label)).join('')}</div>
            <input maxlength="60" value="${SF.esc(a.objection)}" onchange="SF.actions.broadcastObjection('${id}', this.value)" placeholder="Возражение содержит… (например: дорого) — необязательно" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink" />
            <div class="p-2.5 rounded-xl bg-sunken border border-line">
              ${d.count === null ? '<span class="text-muted">Считаю…</span>' : `<span class="font-bold text-ink">Получат: ${d.count}</span>${d.sample.length ? `<span class="text-muted"> · ${d.sample.map(n => SF.esc(n)).join(', ')}${d.count > d.sample.length ? '…' : ''}</span>` : ''}`}
            </div>
            <div class="font-semibold text-ink-2 pt-1">Текст</div>
            <textarea rows="5" maxlength="1000" data-keep="bc-text-${id}" oninput="SF.office.broadcastField('${id}', 'text', this.value)" placeholder="Сообщение придёт клиенту от вас в чат с SI-продавцом" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink">${SF.esc(d.text)}</textarea>
            <div class="text-[10px] text-faint leading-snug">Не получат: отказавшиеся, нажавшие «Не присылать рассылки» и те, кто ни разу не писал. Сообщение придёт в чат с SI-продавцом и уведомлением у Бадди / в Telegram — с 9:00 до 21:00 по времени клиента. Не больше 1 рассылки в день и 3 в неделю.</div>
            ${assisting
              ? `<button onclick="SF.actions.sendBroadcast('${id}', false)" class="w-full py-2.5 rounded-xl btn-3d-tiffany font-bold">Отправить владельцу на одобрение</button>`
              : `<div class="flex gap-2">
                  <button onclick="SF.actions.sendBroadcast('${id}', false)" class="px-3 py-2.5 rounded-xl btn-3d-dark">В черновик</button>
                  <button onclick="SF.actions.sendBroadcast('${id}', true)" ${!d.count ? 'disabled' : ''} class="flex-1 py-2.5 rounded-xl btn-3d-tiffany font-bold disabled:opacity-60">Отправить${d.count ? ` ${d.count} клиентам` : ''}</button>
                </div>`}
          </div>` : ''}
      </div>

      <div class="glass-card-3d p-4 space-y-2 text-xs">
        ${SF.sectionTitle('history', 'Рассылки')}
        ${!data ? '<div class="text-muted">Загружаю…</div>' : ''}
        ${data && !data.broadcasts.length ? '<div class="text-muted">Рассылок пока не было.</div>' : ''}
        ${(data ? data.broadcasts : []).map(b => `
          <div class="p-2.5 rounded-xl bg-sunken border border-line space-y-1.5">
            <div class="flex items-center justify-between gap-2 text-[11px]">
              <span class="font-semibold ${BROADCAST_STATE[b.status][1]}">${BROADCAST_STATE[b.status][0]}</span>
              <span class="text-faint">${timeLabel(b.startedAt || b.createdAt)}</span>
            </div>
            <div class="text-ink-2 whitespace-pre-line line-clamp-4">${SF.esc(b.text)}</div>
            ${b.total ? `<div class="text-[11px] text-muted">Получили ${b.sent} из ${b.total}</div>` : ''}
            ${b.status === 'pending_approval' && b.createdByName ? `<div class="text-[10px] text-faint">Подготовил(а): ${SF.esc(b.createdByName)}</div>` : ''}
            <div class="flex gap-2">
              ${!assisting && (b.status === 'draft' || b.status === 'pending_approval') ? `<button onclick="SF.actions.approveBroadcast('${id}', '${SF.js(b.id)}')" class="flex-1 py-1.5 rounded-lg btn-3d-tiffany text-[11px] font-bold">${b.status === 'draft' ? 'Отправить' : 'Одобрить и отправить'}</button>` : ''}
              ${['draft', 'pending_approval'].includes(b.status) && (!assisting || b.createdBy === myUserId()) ? `<button onclick="SF.actions.cancelBroadcast('${id}', '${SF.js(b.id)}', false)" class="px-3 py-1.5 rounded-lg btn-3d-dark text-[11px]">${b.status === 'pending_approval' && !assisting ? 'Отклонить' : 'Удалить'}</button>` : ''}
              ${b.status === 'sending' && !assisting ? `<button onclick="SF.actions.cancelBroadcast('${id}', '${SF.js(b.id)}', true)" class="px-3 py-1.5 rounded-lg btn-3d-dark text-[11px]">Остановить</button>` : ''}
            </div>
          </div>`).join('')}
      </div>
    `;
  }

  // ---------------- One client: conversation, personal reply, SI on/off ----------------
  function renderClient(route, state) {
    const clients = state.remote.clients[route.projectId] || [];
    const client = clients.find(c => c.id === route.id);
    const messages = state.remote.clientMessages[route.id];
    if (!client) return '<div class="text-xs text-muted">Загружаю…</div>';
    const paused = Boolean(client.si_paused);
    const mine = client.responsible_user_id === myUserId();
    const who = (m) => {
      if (m.authorUserId && m.authorUserId === myUserId()) return '👤 Вы лично';
      return m.authorType === 'assistant' ? '👤 Помощник' : '👤 Владелец';
    };
    return `
      <div class="glass-card-3d p-3.5 flex items-center gap-3">
        ${SF.avatar(client.avatar_url, { size: 44 })}
        <div class="flex-1 min-w-0">
          <div class="text-sm font-bold text-ink truncate">${SF.esc(client.name)}</div>
          ${client.username ? `<div class="text-[10px] font-mono text-brand">@${SF.esc(String(client.username).replace(/^@/, ''))}</div>` : ''}
        </div>
      </div>

      <div class="flex items-center justify-between p-2.5 rounded-xl border ${paused ? 'bg-[var(--human-bubble)] border-[var(--human-bubble-line)]' : 'bg-[var(--si-bubble)] border-[var(--si-bubble-line)]'}">
        <span class="text-[11px] font-semibold flex items-center gap-1.5 ${paused ? 'text-brand' : 'text-si'}">
          ${paused ? (mine ? '👤 SI на паузе — отвечаете вы' : `👤 SI на паузе — отвечает ${SF.esc(client.responsible_name || 'человек')}`) : '<span class="si-dot"></span> SI отвечает этому клиенту'}
        </span>
        <button onclick="SF.actions.setClientSi('${SF.js(route.projectId)}', '${SF.js(client.id)}', ${paused})" class="px-2 py-1 rounded-lg btn-3d-dark text-[10px] font-bold">${paused ? 'Включить SI' : 'Поставить на паузу'}</button>
      </div>

      ${renderClientFunnel(route, client, state)}

      <div class="glass-card-3d p-3 space-y-2">
        <div class="space-y-2 max-h-96 overflow-y-auto py-1 pr-1" id="client-chat-scroll">
          ${!messages ? '<div class="text-xs text-muted">Загружаю…</div>' : ''}
          ${(messages || []).map(m => `
            <div class="flex flex-col ${m.sender === 'client' ? 'items-start' : 'items-end'}">
              <div class="text-[9px] text-faint mb-0.5 px-1">
                ${m.sender === 'client' ? SF.esc(client.name) : (m.sender === 'expert_human' ? who(m) : SF.siLabel('SI'))} · ${timeLabel(m.createdAt || m.created_at)}
              </div>
              <div class="${m.sender === 'client' ? 'chat-bubble-human' : (m.sender === 'expert_human' ? 'chat-bubble-expert' : 'chat-bubble-si')} text-xs">${m.voiceId ? SF.voiceContent(m, `/api/projects/${encodeURIComponent(route.projectId)}/conversations/${encodeURIComponent(client.id)}/voice/${m.voiceId}`) : SF.formatChatMarkdown(m.text)}</div>
            </div>`).join('')}
        </div>
        <form onsubmit="SF.actions.replyToClient(event, '${SF.js(route.projectId)}', '${SF.js(client.id)}')" class="flex gap-2 pt-2 border-t border-line">
          <input type="text" name="text" data-keep="expert-reply" maxlength="2000" autocomplete="off" placeholder="Ответить лично (SI встанет на паузу)..." class="flex-1 bg-sunken border border-line-2 rounded-xl px-3 py-2 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]" />
          <button type="submit" class="px-3 py-2 rounded-xl btn-3d-tiffany text-xs flex items-center gap-1" aria-label="Отправить"><i data-lucide="send" class="w-3.5 h-3.5"></i></button>
        </form>
        <div class="text-[10px] text-faint">Клиент получит уведомление в Telegram, если разрешил боту писать ему.</div>
      </div>
    `;
  }

  // Where the client is in the funnel, the outcome buttons and the event journal
  function renderClientFunnel(route, client, state) {
    const card = state.remote.clientCards[route.id];
    const status = (card && card.funnel_status) || client.funnel_status || 'not_finished';
    const f = funnelOf(status);
    const objection = (card && card.last_objection) || client.last_objection;
    const events = (card && card.events) || [];
    const receipts = (card && card.receipts) || [];
    const phone = (card && card.contact_phone) || client.contact_phone;
    const done = status === 'bought' || status === 'refused';
    const steps = (card && card.steps) || [];
    const stepId = card && card.current_step_id;
    const RECEIPT_STATUS = { new: ['Ждёт проверки', 'text-amber-500'], confirmed: ['Оплата подтверждена', 'text-emerald-500'], rejected: ['Не подтверждён', 'text-faint'] };
    const button = (outcome, label) => `<button onclick="SF.actions.markOutcome('${SF.js(route.projectId)}', '${SF.js(client.id)}', '${outcome}')" class="flex-1 py-2 rounded-xl btn-3d-dark text-[11px] font-bold">${label}</button>`;
    return `
      <div class="glass-card-3d p-3 space-y-2">
        <div class="flex items-center justify-between gap-2">
          <span class="px-2 py-1 rounded-lg border text-[11px] font-bold ${f.cls}">${f.label}</span>
          ${objection ? `<span class="text-[10px] text-muted truncate">Возражение: «${SF.esc(objection)}»</span>` : ''}
        </div>
        ${steps.length ? `
          <label class="flex items-center gap-2 text-[11px]">
            <span class="text-muted whitespace-nowrap">Шаг воронки:</span>
            <select onchange="SF.actions.moveClientStep('${SF.js(route.projectId)}', '${SF.js(client.id)}', this.value)" class="flex-1 min-w-0 p-1.5 rounded-lg bg-sunken border border-line-2 text-ink text-[11px] font-semibold">
              ${steps.map((st, i) => `<option value="${SF.esc(st.id)}" ${st.id === stepId ? 'selected' : ''}>${i + 1}. ${SF.esc(st.title)}</option>`).join('')}
            </select>
          </label>` : ''}
        ${phone ? `<a href="tel:${SF.esc(phone)}" class="block text-[11px] text-brand font-semibold">📱 ${SF.esc(phone)} <span class="text-faint font-normal">· клиент поделился контактом</span></a>` : ''}
        ${receipts.map(r => `
          <div class="p-2 rounded-xl bg-sunken border border-line space-y-1.5">
            <div class="flex items-center justify-between gap-2 text-[11px]">
              <button onclick="SF.actions.viewReceipt('${SF.js(route.projectId)}', '${SF.js(client.id)}', '${SF.js(r.id)}', '${SF.js(r.mimeType)}')" class="font-semibold text-ink flex items-center gap-1"><i data-lucide="receipt" class="w-3.5 h-3.5"></i>Чек · ${timeLabel(r.createdAt)}</button>
              <span class="font-bold ${RECEIPT_STATUS[r.status][1]}">${RECEIPT_STATUS[r.status][0]}</span>
            </div>
            ${r.status === 'new' ? `
              <div class="flex gap-2">
                <button onclick="SF.actions.reviewReceipt('${SF.js(route.projectId)}', '${SF.js(client.id)}', '${SF.js(r.id)}', 'confirm')" class="flex-1 py-1.5 rounded-lg btn-3d-tiffany text-[11px] font-bold">Подтвердить оплату</button>
                <button onclick="SF.actions.reviewReceipt('${SF.js(route.projectId)}', '${SF.js(client.id)}', '${SF.js(r.id)}', 'reject')" class="flex-1 py-1.5 rounded-lg btn-3d-dark text-[11px]">Не подтверждаю</button>
              </div>
              <div class="text-[10px] text-faint">Сначала проверьте, что деньги пришли. После подтверждения клиент получит сообщение${store().findOfficeConsultant(route.projectId)?.accessUrl ? ' и ссылку на доступ' : ''}.</div>` : ''}
          </div>`).join('')}
        <div class="flex gap-2">
          ${done ? button('reopened', 'Вернуть в воронку') : `${button('paid', '✓ Купил')}${button('refused', 'Отказ')}`}
        </div>
        ${events.length ? `
          <details class="text-[11px]">
            <summary class="cursor-pointer text-muted">Журнал событий (${events.length})</summary>
            <div class="mt-1.5 space-y-1">
              ${events.map(e => `
                <div class="flex items-baseline gap-2">
                  <span class="text-faint whitespace-nowrap">${timeLabel(e.createdAt)}</span>
                  <span class="text-ink-2">${SF.esc(e.label)}${e.detail ? `: ${SF.esc(e.detail)}` : ''}</span>
                </div>`).join('')}
            </div>
          </details>` : ''}
      </div>`;
  }

  // ---------------- Actions ----------------
  SF.actions.activateBusiness = async (e) => {
    e.preventDefault();
    if (needServer()) return;
    const s = store();
    const profile = { ...s.data.me.profile, businessAgreedAt: new Date().toISOString(), personalMode: false };
    try {
      const res = await api().updateMyProfile(profile);
      s.applyServerUser(res.user);
      s.saveData();
    } catch (err) {
      showToast(SF.withErrorCode('Не удалось сохранить согласие. Попробуйте ещё раз', err));
      return;
    }
    SF.askWriteAccess(); // the bot will tell about new requests from clients
    SF.confetti();
    showToast(SF.feature('quick-start') ? 'Офис открыт! Выберите цель — остальное SI подготовит сам' : 'Офис открыт! Заполните карточку своего SI-продавца');
    const next = store().currentRoute().next;
    SF.patch({ section: 'consultants', next: null });
    if (next === 'create') SF.push('office-create');
  };

  // "Создать своего SI-продавца" in the Marketplace: the form, or the Office terms first
  SF.actions.startCreateConsultant = () => {
    if (store().isBusinessActive()) {
      SF.openIn('marketplace', 'office', { section: 'consultants' });
      SF.push('office-create');
    } else {
      SF.openIn('marketplace', 'office', { section: 'consultants', next: 'create' });
    }
  };

  SF.actions.quickStart = async (e, goal) => {
    e.preventDefault();
    if (needServer()) return;
    const f = e.target;
    const val = (name) => (f[name] ? f[name].value.trim() : '');
    if (!val('about') || !val('offer')) {
      showToast('Заполните, чем вы занимаетесь и что получит клиент');
      return;
    }
    const button = f.querySelector('button[type=submit]');
    if (button) { button.disabled = true; button.textContent = 'Создаю…'; }
    try {
      const project = await api().quickStart({
        businessId: store().currentBusinessId() || undefined,
        goal, about: val('about'), offer: val('offer'),
        priceMode: f.priceMode ? f.priceMode.value : (goal === 'sell' ? 'fixed' : undefined),
        priceLabel: val('priceLabel'), link: val('link')
      });
      SF.data.invalidate('consultants');
      await SF.data.myConsultants();
      // The wizard screens leave the history: «Назад» from «готов» returns to the Office
      while (store().currentRoute().screen === 'office-create' && store().popRoute()) { /* next */ }
      SF.push('office-ready', { id: project.id });
    } catch (err) {
      if (button) { button.disabled = false; button.textContent = 'Создать SI-продавца'; }
      showToast(SF.withErrorCode(err.message || 'Не получилось создать', err));
    }
  };

  SF.actions.createConsultant = async (e) => {
    e.preventDefault();
    if (needServer()) return;
    const f = e.target;
    const name = f.name.value.trim();
    const roleTitle = roleWithSi(f.role.value);
    const goal = f.goal.value.trim();
    try {
      const project = await api().createProject({ name, businessId: store().currentBusinessId() || undefined, customAiSettings: { goal, clientLimit: 40 } });
      await api().updateProject(project.id, { role_title: roleTitle });
      SF.data.invalidate('consultants');
      await SF.data.myConsultants();
      store().data.ui.routes.marketplace.pop(); // replace the form with the new consultant
      SF.push('office-consultant', { id: project.id, tab: 'methodology' });
      showToast('SI-продавец создан. Добавьте фото, оффер и ссылку на оплату');
    } catch (err) {
      showToast(err.message || 'Не удалось создать SI-продавца');
    }
  };

  SF.actions.saveConsultant = async (e, id) => {
    e.preventDefault();
    if (needServer()) return;
    const f = e.target;
    const paymentUrl = f.paymentUrl.value.trim();
    if (paymentUrl && !isWebUrl(paymentUrl)) {
      showToast('Ссылка на оплату должна начинаться с https://');
      return;
    }
    const accessUrl = f.accessUrl.value.trim();
    if (accessUrl && !isWebUrl(accessUrl)) {
      showToast('Ссылка на доступ должна начинаться с https://');
      return;
    }
    const goal = f.goal.value.trim();
    const instructions = f.instructions.value.trim();
    const clientLimit = Math.max(5, Math.min(500, parseInt(f.clientLimit.value, 10) || 40));
    try {
      // custom_ai_settings is replaced as a whole, so merge with what the server has
      const project = await api().getProject(id);
      await api().updateProject(id, {
        offer: f.offer.value.trim(),
        description: f.description.value.trim(),
        ...(f.slug && f.slug.value.trim().toLowerCase() !== (store().findOfficeConsultant(id) || {}).slug ? { slug: f.slug.value.trim().toLowerCase() } : {}),
        price_label: f.priceLabel.value.trim(),
        ...(f.priceMode ? { price_mode: f.priceMode.value, cta_kind: f.ctaKind.value, cta_label: f.ctaLabel.value.trim() } : {}),
        payment_url: paymentUrl,
        access_url: accessUrl,
        category: f.category.value,
        trial_days: parseInt(f.trialDays.value, 10) || 0,
        is_listed: f.isListed.checked,
        niche_name: f.nicheName ? f.nicheName.value.trim() : undefined,
        niche_section: f.nicheSection ? f.nicheSection.value : undefined,
        faq: SF.niches.readFaq(f),
        custom_ai_settings: { ...(project.custom_ai_settings || {}), goal, instructions, clientLimit }
      });
      SF.data.invalidate('consultants');
      SF.data.invalidate('marketplace');
      SF.data.invalidate('niches'); // a new niche may have appeared
      SF.data.niches(0);
      SF.data.invalidate('puzzle:'); // what the SI knows changed
      SF.data.puzzle(id, 0);
      await SF.data.myConsultants();
      showToast(f.isListed.checked ? 'Сохранено. SI-продавец виден в Маркетплейсе' : 'Сохранено');
    } catch (err) {
      showToast(err.message || 'Не удалось сохранить');
    }
  };

  SF.actions.changeConsultantPhoto = async (id) => {
    if (needServer() || !window.sfMedia) return;
    try {
      const result = await window.sfMedia.choosePhoto((blob) => api().uploadConsultantPhoto(id, blob));
      if (!result) return;
      if (!result.savedOnServer) {
        showToast('Фото не сохранилось на сервере. Попробуйте ещё раз');
        return;
      }
      store().updateOfficeConsultant(id, { photoUrl: result.url });
      SF.data.invalidate('marketplace');
      showToast('Фото SI-продавца сохранено');
    } catch (err) {
      showToast(err.message || 'Не удалось загрузить фото');
    }
  };

  SF.actions.editConsultant = (id) => {
    const c = store().findOfficeConsultant(id);
    if (!c) return;
    SF.openModal(`
      <form onsubmit="SF.actions.saveConsultantName(event, '${SF.js(c.id)}')" class="space-y-3 text-xs">
        <h3 class="text-sm font-bold text-ink">Имя и роль для клиентов</h3>
        ${field('name', 'Имя', c.name, { max: 60 })}
        <label class="block space-y-1">
          <span class="font-semibold text-ink-2">Роль (всегда начинается с SI)</span>
          <input name="role" list="role-suggestions-edit" maxlength="40" value="${SF.esc(c.roleTitle)}" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink" />
          <datalist id="role-suggestions-edit">${ROLE_SUGGESTIONS.map(r => `<option value="${r}"></option>`).join('')}</datalist>
        </label>
        <div class="text-[10px] text-faint">Внутри платформы все они — SI-продавцы; клиенты видят это имя и роль.</div>
        <div class="flex gap-2">
          <button type="button" onclick="SF.closeModal()" class="flex-1 py-2.5 rounded-xl btn-3d-dark">Отмена</button>
          <button type="submit" class="flex-1 py-2.5 rounded-xl btn-3d-tiffany">Сохранить</button>
        </div>
      </form>
    `);
  };

  SF.actions.saveConsultantName = async (e, id) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    const roleTitle = roleWithSi(e.target.role.value);
    SF.closeModal();
    if (needServer()) return;
    try {
      await api().updateProject(id, { name, role_title: roleTitle });
      store().updateOfficeConsultant(id, { name, roleTitle });
      SF.data.invalidate('marketplace');
      showToast('Сохранено');
    } catch (err) {
      showToast(err.message || 'Не удалось сохранить');
    }
  };

  SF.actions.replyToClient = async (e, projectId, clientId) => {
    e.preventDefault();
    const text = e.target.text.value.trim();
    if (!text || needServer()) return;
    e.target.text.value = '';
    try {
      await api().sendMessage(projectId, clientId, text);
      SF.data.invalidate(`clientMessages:${clientId}`);
      SF.data.invalidate(`clients:${projectId}`);
      SF.data.invalidate(`inquiries:${projectId}`);
      await Promise.all([SF.data.clientMessages(projectId, clientId), SF.data.clients(projectId), SF.data.inquiries(projectId)]);
      SF.scrollToBottom('client-chat-scroll');
      showToast('Ответ отправлен. SI для этого клиента на паузе');
    } catch (err) {
      e.target.text.value = text;
      showToast(err.message || 'Не отправилось');
    }
  };

  SF.actions.inviteAssistant = async (e) => {
    e.preventDefault();
    if (needServer()) return;
    const code = e.target.supportCode.value.trim();
    if (!code) return;
    try {
      const bid = store().currentBusinessId() || '';
      await api().addAssistant(code, bid);
      SF.data.invalidate('business');
      await SF.data.business(bid);
      showToast('Помощник добавлен. Бот сообщит ему об этом в Telegram');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не удалось пригласить', err));
    }
  };

  SF.actions.removeAssistant = async (userId, name) => {
    if (needServer()) return;
    if (!window.confirm(`Убрать помощника ${name}? Его диалоги вернутся к вам.`)) return;
    try {
      const bid = store().currentBusinessId() || '';
      await api().removeAssistant(userId, bid);
      SF.data.invalidate('business');
      await SF.data.business(bid);
      showToast('Помощник убран');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не получилось', err));
    }
  };

  SF.actions.markOutcome = async (projectId, clientId, outcome) => {
    if (needServer()) return;
    try {
      const res = await api().markClientOutcome(projectId, clientId, outcome);
      const card = store().data.remote.clientCards[clientId] || {};
      store().setRemote(`clientCards.${clientId}`, { ...card, funnel_status: res.funnelStatus, events: res.events });
      SF.data.invalidate(`clients:${projectId}`);
      SF.data.invalidate('funnel');
      showToast(`Отмечено: ${res.funnelLabel}`);
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не получилось', err));
    }
  };

  // ---- Broadcasts ----
  let broadcastPreviewTimer = null;
  function refreshBroadcastPreview(projectId) {
    const d = broadcastDraft(projectId);
    d.count = null;
    store().notify();
    clearTimeout(broadcastPreviewTimer);
    broadcastPreviewTimer = setTimeout(async () => {
      try {
        const res = await api().previewBroadcast(projectId, d.audience);
        d.count = res.count;
        d.sample = res.sample || [];
      } catch (err) {
        d.count = 0;
      }
      store().notify();
    }, 250);
  }

  SF.actions.openBroadcastForm = (projectId) => {
    broadcastDraft(projectId).open = true;
    refreshBroadcastPreview(projectId);
  };

  SF.actions.planBroadcast = async (projectId) => {
    if (needServer()) return;
    const d = broadcastDraft(projectId);
    if (!d.request.trim()) {
      showToast('Напишите словами, кому и что отправить');
      return;
    }
    d.busy = true;
    store().notify();
    try {
      const res = await api().planBroadcast(projectId, d.request);
      d.open = true;
      if (res.plan) {
        d.audience = { statuses: res.plan.audience.statuses, stepIds: res.plan.audience.stepIds, days: res.plan.audience.days, objection: res.plan.audience.objection };
        d.text = res.plan.text || d.text;
        d.count = res.plan.count;
        d.sample = res.plan.sample || [];
      } else {
        showToast('SI пока не подключён — выберите, кому отправить, и напишите текст вручную');
        refreshBroadcastPreview(projectId);
      }
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не получилось', err));
    } finally {
      d.busy = false;
      store().notify();
    }
  };

  SF.actions.broadcastStatus = (projectId, status) => {
    const a = broadcastDraft(projectId).audience;
    a.statuses = !status ? [] : (a.statuses.includes(status) ? a.statuses.filter(s => s !== status) : [...a.statuses, status]);
    refreshBroadcastPreview(projectId);
  };

  SF.actions.broadcastStep = (projectId, stepId) => {
    const a = broadcastDraft(projectId).audience;
    a.stepIds = a.stepIds.includes(stepId) ? a.stepIds.filter(s => s !== stepId) : [...a.stepIds, stepId];
    refreshBroadcastPreview(projectId);
  };

  SF.actions.broadcastDays = (projectId, days) => {
    broadcastDraft(projectId).audience.days = days ? Number(days) : null;
    refreshBroadcastPreview(projectId);
  };

  SF.actions.broadcastObjection = (projectId, value) => {
    broadcastDraft(projectId).audience.objection = value.trim();
    refreshBroadcastPreview(projectId);
  };

  SF.actions.sendBroadcast = async (projectId, send) => {
    if (needServer()) return;
    const d = broadcastDraft(projectId);
    if (!d.text.trim()) {
      showToast('Напишите текст рассылки');
      return;
    }
    if (send && !confirm(`Отправить рассылку ${d.count} клиентам? Отменить уже отправленные сообщения будет нельзя.`)) return;
    try {
      const res = await api().createBroadcast(projectId, { request: d.request, audience: d.audience, text: d.text, send });
      delete broadcastDrafts[projectId];
      SF.data.invalidate(`broadcasts:${projectId}`);
      await SF.data.broadcasts(projectId);
      const status = res.broadcast.status;
      showToast(status === 'sending' ? 'Рассылка отправляется — клиенты получат её с 9:00 до 21:00 по своему времени'
        : status === 'pending_approval' ? 'Отправлено владельцу на одобрение' : 'Черновик сохранён');
    } catch (err) {
      SF.data.invalidate(`broadcasts:${projectId}`);
      SF.data.broadcasts(projectId);
      showToast(SF.withErrorCode(err.message || 'Не получилось', err));
    }
  };

  SF.actions.approveBroadcast = async (projectId, broadcastId) => {
    if (needServer()) return;
    if (!confirm('Отправить эту рассылку клиентам? Отменить уже отправленные сообщения будет нельзя.')) return;
    try {
      await api().broadcastAction(projectId, broadcastId, 'approve');
      SF.data.invalidate(`broadcasts:${projectId}`);
      await SF.data.broadcasts(projectId);
      showToast('Рассылка отправляется');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не получилось', err));
    }
  };

  SF.actions.cancelBroadcast = async (projectId, broadcastId, sending) => {
    if (needServer()) return;
    if (!confirm(sending ? 'Остановить рассылку? Кто уже получил — получил, остальным не придёт.' : 'Убрать эту рассылку? Клиентам она не уйдёт.')) return;
    try {
      await api().broadcastAction(projectId, broadcastId, 'cancel');
      SF.data.invalidate(`broadcasts:${projectId}`);
      await SF.data.broadcasts(projectId);
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не получилось', err));
    }
  };

  SF.actions.replyReview = async (e, projectId, reviewId) => {
    e.preventDefault();
    if (needServer()) return;
    try {
      await api().replyReview(projectId, reviewId, e.target.text.value);
      SF.data.invalidate(`projectReviews:${projectId}`);
      SF.data.invalidate('cardReviews');
      await SF.data.projectReviews(projectId);
      showToast('Ответ сохранён — его видят все на карточке');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не получилось', err));
    }
  };

  SF.actions.moveClientStep = async (projectId, clientId, stepId) => {
    if (needServer()) return;
    try {
      const res = await api().moveClientStep(projectId, clientId, stepId);
      const card = store().data.remote.clientCards[clientId] || {};
      store().setRemote(`clientCards.${clientId}`, { ...card, current_step_id: res.currentStepId, events: res.events });
      SF.data.invalidate('funnelStep');
      showToast('Клиент переведён на этот шаг. Материал шага при ручном переводе не отправляется');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не получилось', err));
    }
  };

  SF.actions.moreFunnelStep = async (projectId, days, stepId) => {
    if (needServer()) return;
    const key = `${projectId}|${days}|${stepId}`;
    const list = store().data.remote.funnelStepLists[key];
    if (!list) return;
    try {
      const res = await api().getFunnelSteps({ projectId, days: days === 'all' ? '' : days, step: stepId, offset: list.clients.length });
      const more = res.clients || [];
      const seen = new Set(list.clients.map(c => c.id));
      store().setRemote(`funnelStepLists.${key}`, {
        clients: list.clients.concat(more.filter(c => !seen.has(c.id))),
        done: more.length < (res.pageSize || 30)
      });
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не загрузилось', err));
    }
  };

  SF.actions.viewReceipt = async (projectId, clientId, receiptId, mimeType) => {
    if (needServer()) return;
    try {
      const blob = await api().getReceiptFile(projectId, clientId, receiptId);
      const url = URL.createObjectURL(blob);
      SF.openModal(`
        <div class="space-y-3 text-xs">
          <h3 class="text-sm font-bold text-ink">Чек клиента</h3>
          ${mimeType === 'application/pdf'
            ? `<iframe src="${url}" class="w-full h-[60vh] rounded-xl border border-line bg-card"></iframe>
               <a href="${url}" download="check.pdf" class="block text-center text-brand font-semibold">Скачать PDF</a>`
            : `<img src="${url}" alt="Чек" class="w-full rounded-xl border border-line" />`}
          <button onclick="SF.closeModal()" class="w-full py-2.5 rounded-xl btn-3d-dark">Закрыть</button>
        </div>`);
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не открылся', err));
    }
  };

  SF.actions.reviewReceipt = async (projectId, clientId, receiptId, action) => {
    if (needServer()) return;
    const question = action === 'confirm'
      ? 'Деньги пришли? Клиент станет «Купили» и получит сообщение об этом.'
      : 'Не подтверждать этот чек? Клиенту придёт мягкое сообщение, что нужно уточнить.';
    if (!confirm(question)) return;
    try {
      const res = await api().reviewReceipt(projectId, clientId, receiptId, action);
      const card = store().data.remote.clientCards[clientId] || {};
      store().setRemote(`clientCards.${clientId}`, { ...card, funnel_status: res.funnelStatus, events: res.events, receipts: res.receipts });
      SF.data.invalidate(`clientMessages:${clientId}`);
      SF.data.invalidate(`clients:${projectId}`);
      SF.data.invalidate(`inquiries:${projectId}`);
      SF.data.invalidate('funnel');
      SF.data.clientMessages(projectId, clientId);
      showToast(action === 'confirm' ? 'Оплата подтверждена, клиент получил сообщение' : 'Клиенту написали, что нужно уточнить');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не получилось', err));
    }
  };

  SF.actions.moreSellerFunnel = async (projectId, businessId, days, status) => {
    if (needServer()) return;
    const key = `${projectId}|${days}|${status}`;
    const list = store().data.remote.sellerFunnelLists[key];
    if (!list) return;
    try {
      const res = await api().getFunnel({ businessId, projectId, days: days === 'all' ? '' : days, status, offset: list.clients.length });
      const more = res.clients || [];
      const seen = new Set(list.clients.map(c => c.id));
      store().setRemote(`sellerFunnelLists.${key}`, { clients: list.clients.concat(more.filter(c => !seen.has(c.id))), done: more.length < (res.pageSize || 30) });
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не загрузилось', err));
    }
  };

  // Scenarios are saved inside custom_ai_settings, merged with what the server has
  SF.actions.saveMethodology = async (e, id) => {
    e.preventDefault();
    if (needServer()) return;
    const methodology = e.target.methodology.value.trim();
    try {
      const project = await api().getProject(id);
      await api().updateProject(id, { custom_ai_settings: { ...(project.custom_ai_settings || {}), methodology } });
      store().updateOfficeConsultant(id, { methodology });
      showToast('Описание сохранено. SI будет ему следовать');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не удалось сохранить', err));
    }
  };

  async function saveScenarios(id, scenarios) {
    const project = await api().getProject(id);
    const res = await api().updateProject(id, {
      custom_ai_settings: { ...(project.custom_ai_settings || {}), scenarios }
    });
    store().updateOfficeConsultant(id, { scenarios: (res.custom_ai_settings || {}).scenarios || scenarios });
  }

  // Steps are saved inside custom_ai_settings too; scenarios of a deleted step go with it (the server drops them)
  async function saveSteps(id, steps) {
    const project = await api().getProject(id);
    const res = await api().updateProject(id, {
      custom_ai_settings: { ...(project.custom_ai_settings || {}), steps }
    });
    const settings = res.custom_ai_settings || {};
    store().updateOfficeConsultant(id, { steps: settings.steps || steps, scenarios: settings.scenarios || [] });
    SF.data.invalidate('funnelStep');
  }

  SF.actions.saveStep = async (e, id, stepId) => {
    e.preventDefault();
    if (needServer()) return;
    const f = e.target;
    const c = store().findOfficeConsultant(id);
    if (!c) return;
    const step = {
      title: f.title.value.trim(),
      goal: f.goal.value.trim(),
      doneWhen: f.doneWhen.value.trim(),
      material: f.material.value.trim()
    };
    if (!step.title) {
      showToast('Напишите название шага');
      return;
    }
    const list = c.steps || [];
    const steps = stepId ? list.map(st => (st.id === stepId ? { ...st, ...step } : st)) : [...list, step];
    try {
      await saveSteps(id, steps);
      if (stepId) SF.patch({ editStep: '' });
      showToast(stepId ? 'Шаг сохранён' : 'Шаг добавлен. SI будет вести клиентов по шагам');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не удалось сохранить', err));
    }
  };

  SF.actions.moveStep = async (id, index, delta) => {
    if (needServer()) return;
    const c = store().findOfficeConsultant(id);
    const steps = [...((c && c.steps) || [])];
    const other = index + delta;
    if (!steps[index] || !steps[other]) return;
    [steps[index], steps[other]] = [steps[other], steps[index]];
    try {
      await saveSteps(id, steps);
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не удалось сохранить', err));
    }
  };

  SF.actions.removeStep = async (id, stepId) => {
    if (needServer()) return;
    const c = store().findOfficeConsultant(id);
    const steps = (c && c.steps) || [];
    const step = steps.find(st => st.id === stepId);
    if (!step) return;
    const tied = ((c && c.scenarios) || []).filter(sc => sc.step === stepId).length;
    const question = `Удалить шаг «${step.title}»? Клиенты с этого шага окажутся на первом шаге.${tied ? ` Сценарии этого шага тоже удалятся: ${tied}.` : ''}`;
    if (!confirm(question)) return;
    try {
      await saveSteps(id, steps.filter(st => st.id !== stepId));
      showToast('Шаг удалён');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не удалось удалить', err));
    }
  };

  SF.actions.addScenario = async (e, id) => {
    e.preventDefault();
    if (needServer()) return;
    const f = e.target;
    const c = store().findOfficeConsultant(id);
    if (!c) return;
    const scenario = {
      title: f.title.value.trim(),
      when: f.when.value,
      condition: f.when.value === 'custom' ? f.condition.value.trim() : '',
      minutes: f.when.value === 'silent' ? parseInt(f.minutes.value, 10) || 60 : undefined,
      after: f.when.value === 'silent' ? f.after.value : undefined,
      afterText: f.when.value === 'silent' && f.after.value === 'text' ? f.afterText.value.trim() : undefined,
      then: f.then.value,
      text: f.text.value.trim(),
      step: f.step ? f.step.value || undefined : undefined
    };
    if (scenario.when === 'step_reached' && !scenario.step) {
      showToast('Выберите шаг воронки');
      return;
    }
    if (scenario.after === 'text' && !scenario.afterText) {
      showToast('Опишите, после чего клиент замолчал');
      return;
    }
    if (scenario.when === 'custom' && !scenario.condition) {
      showToast('Напишите условие словами');
      return;
    }
    if (scenario.when === 'silent' && (scenario.minutes < 5 || scenario.minutes > 43200)) {
      showToast('Минут — от 5 до 43 200 (30 дней)');
      return;
    }
    if (scenario.then === 'send_text' && !scenario.text) {
      showToast('Вставьте текст или ссылку для клиента');
      return;
    }
    if (scenario.when === 'step_reached' && scenario.then === 'si_says') {
      showToast('Когда клиент переходит на шаг, выберите другое действие. Что SI говорит на шаге — в описании шага');
      return;
    }
    if (scenario.then === 'si_says' && !scenario.text && scenario.when !== 'silent') {
      showToast('Напишите, что SI должен ответить');
      return;
    }
    try {
      await saveScenarios(id, [...(c.scenarios || []), scenario]);
      showToast('Сценарий добавлен');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не удалось сохранить', err));
    }
  };

  SF.actions.removeScenario = async (id, index) => {
    if (needServer()) return;
    const c = store().findOfficeConsultant(id);
    const list = (c && c.scenarios) || [];
    const removed = list[index];
    if (!removed) return;
    // Branches that continue this one ("после ветки «…»") go with it, so they never fire on their own
    const next = list.filter(o => o.when === 'silent' && o.after === removed.id);
    const question = next.length
      ? `Удалить этот сценарий? Вместе с ним удалятся сценарии, которые идут после него: ${next.length}.`
      : 'Удалить этот сценарий?';
    if (!confirm(question)) return;
    try {
      await saveScenarios(id, list.filter(o => o !== removed && !next.includes(o)));
      showToast('Сценарий удалён');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не удалось удалить', err));
    }
  };

  SF.actions.setClientSi = async (projectId, clientId, enabled) => {
    if (needServer()) return;
    try {
      await api().setClientSi(projectId, clientId, enabled);
      SF.data.invalidate(`clients:${projectId}`);
      SF.data.invalidate(`inquiries:${projectId}`);
      await Promise.all([SF.data.clients(projectId), SF.data.inquiries(projectId)]);
      showToast(enabled ? 'SI снова отвечает этому клиенту' : 'SI на паузе — отвечаете вы');
    } catch (err) {
      showToast(err.message || 'Не получилось');
    }
  };

  // ---------------- SI-brain actions ----------------
  function pickFile(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.style.display = 'none';
      input.addEventListener('change', () => {
        resolve(input.files && input.files[0] ? input.files[0] : null);
        input.remove();
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  function replaceMaterial(material) {
    const list = (store().data.remote.brain || []).filter(m => m.id !== material.id);
    store().setRemote('brain', [material, ...list].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
  }

  // consultantId: upload from a consultant's tab (only this SI gets it); empty: all my SI get it
  async function uploadMaterial(file, { name, title = '', consultantId = '' }) {
    const seller = consultantId ? store().findOfficeConsultant(consultantId) : null;
    const consultantIds = consultantId ? [consultantId] : store().consultantsOfCurrent().map(c => c.id);
    // Into the business of this SI-продавец, or the one open in the Office
    const businessId = (seller && seller.businessId) || store().currentBusinessId() || '';
    brainBusy = title || name;
    store().notify();
    try {
      const res = await api().uploadBrainMaterial(file, { name, title, consultantIds, businessId });
      replaceMaterial(res.material);
      const known = res.material.consultantIds.length;
      showToast(consultantId
        ? 'Материал добавлен. Этот SI уже отвечает по нему'
        : (known ? 'Материал добавлен. Его знают все ваши SI — снимите галочку, если кому-то не нужен' : 'Материал добавлен. Отметьте, какие SI его знают'));
      return true;
    } catch (err) {
      showToast(err.message || 'Не удалось загрузить материал');
      return false;
    } finally {
      brainBusy = null;
      store().notify();
    }
  }

  SF.actions.uploadBrainFile = async (consultantId) => {
    if (needServer() || brainBusy) return;
    const file = await pickFile(BRAIN_ACCEPT);
    if (!file) return;
    if (file.size > MAX_BRAIN_FILE) {
      showToast('Файл больше 10 МБ. Разделите его на части');
      return;
    }
    await uploadMaterial(file, { name: file.name, consultantId });
  };

  SF.actions.pasteBrainText = (consultantId) => {
    if (needServer() || brainBusy) return;
    SF.openModal(`
      <form onsubmit="SF.actions.saveBrainText(event, '${SF.js(consultantId)}')" class="space-y-3 text-xs">
        <h3 class="text-sm font-bold text-ink">Текст для SI-мозга</h3>
        ${field('title', 'Название', '', { placeholder: 'Например: Частые вопросы', max: 120 })}
        <label class="block space-y-1">
          <span class="font-semibold text-ink-2">Текст</span>
          <textarea name="text" rows="9" maxlength="400000" required placeholder="Вставьте сюда программу, прайс, ответы на вопросы клиентов…" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink"></textarea>
        </label>
        <div class="flex gap-2">
          <button type="button" onclick="SF.closeModal()" class="flex-1 py-2.5 rounded-xl btn-3d-dark">Отмена</button>
          <button type="submit" class="flex-1 py-2.5 rounded-xl btn-3d-tiffany">Сохранить</button>
        </div>
      </form>
    `);
  };

  SF.actions.saveBrainText = async (e, consultantId) => {
    e.preventDefault();
    const title = e.target.title.value.trim() || 'Текст';
    const text = e.target.text.value.trim();
    if (text.length < 20) {
      showToast('Текст слишком короткий');
      return;
    }
    SF.closeModal();
    const blob = new Blob([text], { type: 'text/plain' });
    await uploadMaterial(blob, { name: 'text.txt', title, consultantId });
  };

  SF.actions.toggleMaterialConsultant = async (materialId, consultantId, on) => {
    if (needServer()) return;
    const material = (store().data.remote.brain || []).find(m => m.id === materialId);
    if (!material) return;
    const ids = new Set(material.consultantIds || []);
    if (on) ids.add(consultantId); else ids.delete(consultantId);
    try {
      const res = await api().setMaterialConsultants(materialId, [...ids]);
      replaceMaterial(res.material);
    } catch (err) {
      store().notify(); // put the checkbox back
      showToast(err.message || 'Не удалось сохранить');
    }
  };

  SF.actions.deleteBrainMaterial = async (materialId) => {
    if (needServer()) return;
    const material = (store().data.remote.brain || []).find(m => m.id === materialId);
    if (!material || !confirm(`Удалить «${material.title}»? SI перестанут отвечать по этому материалу.`)) return;
    try {
      await api().deleteBrainMaterial(materialId);
      store().setRemote('brain', (store().data.remote.brain || []).filter(m => m.id !== materialId));
      showToast('Материал удалён');
    } catch (err) {
      showToast(err.message || 'Не удалось удалить');
    }
  };

  // ---------------- Screen registration (rendered inside the Marketplace tab) ----------------
  const TITLES = {
    office: 'Офис',
    'office-create': 'Новый SI-продавец',
    'office-ready': 'SI-продавец готов',
    'office-consultant': 'SI-продавец',
    'office-client': 'Клиент',
    'office-product': 'Продукт',
    'office-template': 'Шаблон для продажи другим'
  };

  SF.office = {
    // Typing in a broadcast draft is kept without re-drawing the screen
    broadcastField: (projectId, field, value) => { broadcastDraft(projectId)[field] = value; },
    thenHints: THEN_HINTS,
    title(route) {
      if (SF.funnels && SF.funnels.owns(route.screen)) return SF.funnels.title(route);
      return TITLES[route.screen] || 'Офис';
    },
    render(route, state) {
      if (route.screen === 'office') return renderOffice(route, state);
      // Ready-made funnels (js/screens/funnels.js): for anyone with an open Office
      // Templates (js/screens/funnels.js): the catalogue and a template for everyone, the rest with an open Office
      if (SF.funnels && SF.funnels.owns(route.screen)) return store().isBusinessActive() || SF.funnels.open(route) ? SF.funnels.render(route, state) : renderTerms();
      if (route.screen === 'office-create' && !store().isBusinessActive()) return renderTerms();
      if (!store().isBusinessActive() && !store().isAssistant()) return renderTerms();
      if (route.screen === 'office-create') return renderCreate(route);
      if (route.screen === 'office-ready') return renderQuickReady(route);
      if (route.screen === 'office-consultant') return renderConsultant(route, state);
      if (route.screen === 'office-client') return renderClient(route, state);
      if (route.screen === 'office-product') return renderProduct(route, state);
      if (route.screen === 'office-template') return store().isBusinessActive() ? renderTemplateBuilder() : renderTerms();
      return renderOffice(route, state);
    },
    afterRender(route, state) {
      // New or removed assistant roles show up without reopening the app
      SF.data.officeLists();
      if (SF.funnels && SF.funnels.owns(route.screen) && SF.funnels.open(route)) return SF.funnels.afterRender(route, state);
      if (!store().isBusinessActive() && !store().isAssistant()) return;
      if (SF.funnels && SF.funnels.owns(route.screen)) return SF.funnels.afterRender(route, state);
      if (store().isBusinessActive()) SF.data.businesses();
      SF.data.niches();
      if (route.screen === 'office') {
        SF.data.allInquiries();
        const bid = store().currentBusinessId();
        if (route.section === 'brain') {
          SF.data.brain();
          if (bid) SF.data.products(bid);
        }
        if (route.section === 'team') SF.data.business(bid || '');
        // The small puzzle bar on each SI-продавец of the open business
        if (!route.section || route.section === 'consultants') store().consultantsOfCurrent().forEach(c => SF.data.puzzle(c.id, 60000));
      } else if (route.screen === 'office-consultant') {
        const c = store().findOfficeConsultant(route.id);
        const tab = c && c.assisting
          ? (['income', 'analytics', 'broadcasts'].includes(route.tab) ? route.tab : 'income')
          : (CONSULTANT_TABS.some(t => t.id === route.tab) ? route.tab : 'analytics');
        if (c && !c.assisting) SF.data.projectLinks(route.id);
        if (tab === 'broadcasts') SF.data.broadcasts(route.id);
        if (tab === 'methodology') {
          SF.data.brain();
          if (c && c.businessId) SF.data.products(c.businessId);
          if (c && c.isTemplate) SF.data.templateDemos();
          if (c && !c.assisting) {
            SF.data.puzzle(route.id);
            const pz = state.remote.puzzle[route.id];
            if (pz) celebratePuzzle(route.id, pz);
          }
          // «Научить SI»: straight to the form
          if (route.noteTopic) setTimeout(() => document.querySelector('[name=topic]')?.scrollIntoView({ block: 'center' }), 80);
        }
        if (tab === 'analytics') {
          const days = FUNNEL_DAYS.some(d => d.id === route.days) ? route.days : '30';
          if (route.fview === 'steps') {
            const report = state.remote.funnelSteps[`${route.id}|${days}`];
            SF.data.funnelSteps(route.id, days);
            const steps = (report && report.steps) || [];
            const stepId = steps.some(st => st.id === route.fstep) ? route.fstep : (steps[0] && steps[0].id);
            if (stepId) SF.data.funnelStepList(route.id, days, stepId);
          } else {
            const status = FUNNEL.some(f => f.id === route.fstatus) ? route.fstatus : 'waiting_human';
            const bid = (c && c.businessId) || '';
            SF.data.sellerFunnel(route.id, bid, days);
            SF.data.sellerFunnelList(route.id, bid, days, status);
          }
          if (c && !c.assisting) {
            SF.data.analytics(route.id);
            SF.data.projectReviews(route.id);
          }
        }
        if (tab === 'income') {
          SF.data.allInquiries();
          SF.data.clients(route.id);
          if (route.ctab === 'calendar' && c && c.businessId) SF.data.calendar(c.businessId);
        }
      } else if (route.screen === 'office-product') {
        SF.data.products(route.businessId);
      } else if (route.screen === 'office-client') {
        SF.data.clients(route.projectId);
        SF.data.clientMessages(route.projectId, route.id);
        SF.data.clientCard(route.projectId, route.id);
        SF.scrollToBottom('client-chat-scroll');
        SF.data.poll(`client:${route.id}`, () => SF.data.clientMessages(route.projectId, route.id));
      }
    }
  };
})(window);
