// screens/office.js - Office (business profile) inside the Marketplace tab. Real data only.
// Sections: Мои SI-продавцы · Воронка · Календарь · Мой SI-мозг (материалы, по которым отвечает SI) · Мне написали · Помощник.
// Each SI-consultant has four tabs: Карточка и методология · Аналитика · Клиенты · Рассылки.
// The assistant of a business sees its SI-sellers with clients, the funnel and "Мне написали" only: no money,
// payment links, SI-brain or settings (the server checks this too).

(function (window) {
  const SF = window.SF;
  const showToast = SF.showToast;

  const SECTIONS = [
    { id: 'consultants', label: 'Мои SI', icon: 'bot' },
    { id: 'funnel', label: 'Воронка', icon: 'filter' },
    { id: 'calendar', label: 'Календарь', icon: 'calendar' },
    { id: 'brain', label: 'SI-мозг', icon: 'brain' },
    { id: 'inbox', label: 'Мне написали', icon: 'user-check' },
    { id: 'team', label: 'Помощник', icon: 'user-plus' }
  ];
  const ASSISTANT_SECTIONS = ['consultants', 'funnel', 'calendar', 'inbox'];

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

  const CONSULTANT_TABS = [
    { id: 'methodology', label: 'Карточка и методология', icon: 'git-branch' },
    { id: 'analytics', label: 'Аналитика', icon: 'trending-up' },
    { id: 'income', label: 'Клиенты', icon: 'users' },
    { id: 'broadcasts', label: 'Рассылки', icon: 'send-horizontal' }
  ];

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
    const waiting = SF.data.waitingInquiries(state).length;
    let body = '';
    if (section === 'consultants') body = renderConsultantList(state);
    if (section === 'funnel') body = renderFunnel(route, state);
    if (section === 'calendar') body = renderCalendar(state);
    if (section === 'brain') body = renderBrain(state);
    if (section === 'inbox') body = renderInbox(state);
    if (section === 'team') body = renderTeam(state);
    return `
      <div class="grid ${sections.length === 4 ? 'grid-cols-4' : 'grid-cols-3'} gap-1 bg-raised p-1.5 rounded-2xl border border-line">
        ${sections.map(s => `
          <button onclick="SF.patch({ section: '${s.id}' })" class="relative py-2 rounded-xl text-[10px] font-semibold flex flex-col items-center gap-1 ${section === s.id ? 'bg-[#81D8D0] text-[#08302c] shadow' : 'text-muted'}">
            <i data-lucide="${s.icon}" class="w-4 h-4"></i>${s.label}
            ${s.id === 'inbox' && waiting ? `<span class="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">${waiting}</span>` : ''}
          </button>`).join('')}
      </div>
      ${body}
    `;
  }

  function renderConsultantList(state) {
    const list = state.office.consultants.filter(c => !c.assisting);
    const assisted = state.office.consultants.filter(c => c.assisting);
    const owners = [...new Set(assisted.map(c => c.ownerName))];
    const assistedBlock = assisted.length ? `
      <div class="space-y-2.5">
        <div class="text-[11px] text-muted px-1 leading-snug">Вы помощник: ${SF.esc(owners.join(', '))}. Отвечаете клиентам и ставите SI на паузу; деньги, SI-мозг и настройки видит только владелец.</div>
        ${assisted.map(c => `
          <button onclick="SF.push('office-consultant', { id: '${SF.js(c.id)}', tab: 'income' })" class="w-full glass-card-3d p-3.5 text-left flex items-center gap-3">
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
      ${assistedBlock}
      <div class="space-y-2.5">
        ${list.map(c => `
          <button onclick="SF.push('office-consultant', { id: '${SF.js(c.id)}', tab: 'methodology' })" class="w-full glass-card-3d p-3.5 text-left flex items-center gap-3">
            ${SF.avatar(c.photoUrl, { size: 48, kind: 'si' })}
            <span class="flex-1 min-w-0">
              <span class="block text-sm font-bold text-ink truncate">${SF.esc(c.name)}</span>
              <span class="block text-[11px]">${SF.siLabel(c.roleTitle)}</span>
              <span class="block text-[10px] mt-0.5 ${c.isListed ? 'text-brand' : 'text-faint'}">${c.isListed ? 'В Маркетплейсе' : 'Не в Маркетплейсе'}${c.paymentUrl ? ' · ссылка на оплату есть' : ' · нет ссылки на оплату'}</span>
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

  function renderFunnel(route, state) {
    const businessId = funnelBusinessId(state);
    if (businessId === null) return '<div class="text-xs text-muted">Загружаю…</div>';
    if (!businessId) {
      return SF.emptyState('consultant', 'Воронка появится с первым SI-продавцом', 'Создайте и включите SI-продавца — здесь будет видно, на каком шаге каждый клиент.');
    }
    const days = FUNNEL_DAYS.some(d => d.id === route.days) ? route.days : '30';
    const view = route.fview === 'steps' ? 'steps' : 'status';
    const viewToggle = `
      <div class="grid grid-cols-2 gap-1 bg-raised p-1 rounded-2xl border border-line">
        ${[['status', 'По статусам'], ['steps', 'По шагам']].map(([id, label]) => `
          <button onclick="SF.patch({ fview: '${id}' })" class="py-2 rounded-xl text-[11px] font-semibold ${view === id ? 'bg-[#81D8D0] text-[#08302c] shadow' : 'text-muted'}">${label}</button>`).join('')}
      </div>`;
    if (view === 'steps') return viewToggle + renderFunnelSteps(route, state, days);
    const funnel = state.remote.funnel[`${businessId}|${days}`];
    const status = FUNNEL.some(f => f.id === route.fstatus) ? route.fstatus : 'waiting_human';
    const list = state.remote.funnelLists[`${businessId}|${days}|${status}`];
    const counts = (funnel && funnel.counts) || {};
    return `
      ${viewToggle}
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
      <div class="text-[10px] text-faint px-1 leading-snug">«Есть возражения» — клиент ответил на оффер или засомневался, но ещё не купил. «Купили» и «Отказ» отмечаете вы или помощник в карточке клиента; SI сам замечает оффер, возражения и отказ в переписке.</div>
      ${SF.sectionTitle('', funnelOf(status).label)}
      ${!list ? '<div class="text-xs text-muted">Загружаю…</div>' : ''}
      ${list && !list.clients.length ? '<div class="text-xs text-muted px-1">Здесь пока никого нет.</div>' : ''}
      <div class="space-y-1.5">
        ${(list ? list.clients : []).map(cl => `
          <button onclick="SF.push('office-client', { id: '${SF.js(cl.id)}', projectId: '${SF.js(cl.project_id)}' })" class="w-full p-2.5 rounded-xl bg-card border border-line flex items-center gap-2.5 text-left">
            ${SF.avatar(cl.avatar_url, { size: 32 })}
            <span class="flex-1 min-w-0">
              <span class="block text-xs font-bold text-ink truncate">${SF.esc(cl.name)}</span>
              <span class="block text-[10px] text-muted truncate">${cl.last_objection ? `«${SF.esc(cl.last_objection)}» · ` : ''}${SF.esc(cl.project_name)}</span>
            </span>
            <span class="text-[10px] text-faint whitespace-nowrap">${timeLabel(cl.last_activity)}</span>
          </button>`).join('')}
      </div>
      ${list && !list.done ? `<button onclick="SF.actions.moreFunnel('${SF.js(businessId)}', '${days}', '${status}')" class="w-full py-2.5 rounded-xl btn-3d-dark text-xs">Показать ещё</button>` : ''}
    `;
  }

  // «По шагам»: one SI-seller — how many reached each step, are on it now, refused on it; where they stop
  function funnelStepsProject(route) {
    const list = store().data.office.consultants;
    // By default — the first SI-seller that already has steps
    return list.find(c => c.id === route.fproject) || list.find(c => (c.steps || []).length) || list[0] || null;
  }

  function renderFunnelSteps(route, state, days) {
    const consultants = store().data.office.consultants;
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
          ${c.assisting ? '<p class="text-faint">Шаги добавляет владелец бизнеса.</p>' : `<button onclick="SF.push('office-consultant', { id: '${SF.js(c.id)}', tab: 'methodology' })" class="w-full py-2.5 rounded-xl btn-3d-tiffany">Добавить шаги</button>`}
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

  function renderCalendar(state) {
    const key = calendarKey(state);
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

  function renderBrain(state) {
    const materials = state.remote.brain;
    const consultants = store().ownConsultants();
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
    const materials = state.remote.brain;
    return `
      <div class="glass-card-3d p-4 space-y-3 text-xs">
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
        <div class="text-[10px] text-faint">Новый материал отсюда сразу откроется этому SI. Все материалы — в Офисе, раздел «SI-мозг».</div>
      </div>
    `;
  }

  // ---------------- "Мне написали" ----------------
  function renderInbox(state) {
    const all = state.office.consultants.flatMap(c =>
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
  function renderCreate() {
    return `
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

  // ---------------- One consultant ----------------
  function renderConsultant(route, state) {
    const c = store().findOfficeConsultant(route.id);
    if (!c) return SF.emptyState('assistant', 'SI-продавец не найден', 'Вернитесь в Офис и выберите другого.');
    if (c.assisting) return renderAssistedConsultant(c, state);
    const tab = route.tab || 'methodology';
    let body = '';
    if (tab === 'methodology') body = renderMethodology(c, route) + renderConsultantBrain(c, state);
    if (tab === 'analytics') body = renderAnalytics(c, state);
    if (tab === 'income') body = renderClients(c, state);
    if (tab === 'broadcasts') body = renderBroadcasts();

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
      </div>

      <div class="grid grid-cols-4 gap-1 bg-raised p-1 rounded-2xl border border-line">
        ${CONSULTANT_TABS.map(t => `
          <button onclick="SF.patch({ tab: '${t.id}' })" class="py-2 px-1 rounded-xl text-[10px] font-semibold leading-tight flex flex-col items-center gap-1 ${tab === t.id ? 'bg-[#81D8D0] text-[#08302c] shadow' : 'text-muted'}">
            <i data-lucide="${t.icon}" class="w-4 h-4"></i>${t.label}
          </button>`).join('')}
      </div>

      ${body}
    `;
  }

  // The assistant: the SI-seller's clients only
  function renderAssistedConsultant(c, state) {
    return `
      <div class="glass-card-3d p-4 flex items-center gap-3 border-[var(--si-bubble-line)]">
        ${SF.avatar(c.photoUrl, { size: 56, kind: 'si' })}
        <div class="flex-1 min-w-0">
          <div class="text-base font-extrabold text-ink truncate">${SF.esc(c.name)}</div>
          <div class="text-xs">${SF.siLabel(c.roleTitle)}</div>
          <div class="text-[10px] text-brand mt-0.5">Бизнес: ${SF.esc(c.ownerName)} · вы помощник</div>
        </div>
      </div>
      ${renderClients(c, state)}
    `;
  }

  function renderMethodology(c, route = {}) {
    return `
      <form onsubmit="SF.actions.saveConsultant(event, '${SF.js(c.id)}')" class="space-y-3 text-xs">
        <div class="glass-card-3d p-4 space-y-3">
          ${SF.sectionTitle('store', 'Карточка в Маркетплейсе')}
          ${field('offer', 'Оффер — что получит клиент', c.offer, { placeholder: 'Например: выйти из операционки за 8 недель', max: 200 })}
          ${field('description', 'Описание', c.description, { placeholder: 'Коротко: для кого, как проходит, что внутри', rows: 3, max: 1000 })}
          ${field('priceLabel', 'Цена', c.priceLabel, { placeholder: 'Например: 25 000 ₽ или Бесплатно', max: 80 })}
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
      <div class="glass-card-3d p-4 space-y-3 text-xs">
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
      <div class="text-[10px] text-faint px-1">Только настоящие цифры этого SI-продавца. Оплаты идут вам напрямую, поэтому продажи здесь пока не считаются. Советы SI по воронке появятся позже.</div>
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

  function renderBroadcasts() {
    return `
      <div class="glass-card-3d p-4 space-y-2">
        <div class="flex items-center gap-2"><span class="si-dot"></span><span class="text-sm font-bold text-ink">Рассылки</span>${SF.soonBadge()}</div>
        <p class="text-xs text-muted leading-relaxed">Анонсы для ваших клиентов: мероприятие, новость, акция. Напишете обычными словами, кому и что отправить — SI подберёт клиентов и подготовит текст, отправка только после вашего подтверждения.</p>
        <p class="text-[11px] text-faint leading-snug">Догоняющие сообщения, если клиент замолчал, настраиваются в методологии: «Карточка и методология» → сценарии «если…, то…».</p>
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
    const profile = { ...s.data.me.profile, businessAgreedAt: new Date().toISOString() };
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
    showToast('Офис открыт! Заполните карточку своего SI-продавца');
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

  SF.actions.createConsultant = async (e) => {
    e.preventDefault();
    if (needServer()) return;
    const f = e.target;
    const name = f.name.value.trim();
    const roleTitle = roleWithSi(f.role.value);
    const goal = f.goal.value.trim();
    try {
      const project = await api().createProject({ name, customAiSettings: { goal, clientLimit: 40 } });
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
        price_label: f.priceLabel.value.trim(),
        payment_url: paymentUrl,
        access_url: accessUrl,
        category: f.category.value,
        trial_days: parseInt(f.trialDays.value, 10) || 0,
        is_listed: f.isListed.checked,
        custom_ai_settings: { ...(project.custom_ai_settings || {}), goal, instructions, clientLimit }
      });
      SF.data.invalidate('consultants');
      SF.data.invalidate('marketplace');
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
      await api().addAssistant(code);
      SF.data.invalidate('business');
      await SF.data.business();
      showToast('Помощник добавлен. Бот сообщит ему об этом в Telegram');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не удалось пригласить', err));
    }
  };

  SF.actions.removeAssistant = async (userId, name) => {
    if (needServer()) return;
    if (!window.confirm(`Убрать помощника ${name}? Его диалоги вернутся к вам.`)) return;
    try {
      await api().removeAssistant(userId);
      SF.data.invalidate('business');
      await SF.data.business();
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

  SF.actions.moreFunnel = async (businessId, days, status) => {
    if (needServer()) return;
    const key = `${businessId}|${days}|${status}`;
    const list = store().data.remote.funnelLists[key];
    if (!list) return;
    try {
      const res = await api().getFunnel({ businessId, days: days === 'all' ? '' : days, status, offset: list.clients.length });
      const more = res.clients || [];
      const seen = new Set(list.clients.map(c => c.id));
      store().setRemote(`funnelLists.${key}`, {
        clients: list.clients.concat(more.filter(c => !seen.has(c.id))),
        done: more.length < (res.pageSize || 30)
      });
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
    const consultantIds = consultantId ? [consultantId] : store().ownConsultants().map(c => c.id);
    brainBusy = title || name;
    store().notify();
    try {
      const res = await api().uploadBrainMaterial(file, { name, title, consultantIds });
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
    'office-consultant': 'SI-продавец',
    'office-client': 'Клиент'
  };

  SF.office = {
    thenHints: THEN_HINTS,
    title(route) {
      return TITLES[route.screen] || 'Офис';
    },
    render(route, state) {
      if (route.screen === 'office') return renderOffice(route, state);
      if (route.screen === 'office-create' && !store().isBusinessActive()) return renderTerms();
      if (!store().isBusinessActive() && !store().isAssistant()) return renderTerms();
      if (route.screen === 'office-create') return renderCreate();
      if (route.screen === 'office-consultant') return renderConsultant(route, state);
      if (route.screen === 'office-client') return renderClient(route, state);
      return renderOffice(route, state);
    },
    afterRender(route, state) {
      // New or removed assistant roles show up without reopening the app
      SF.data.officeLists();
      if (!store().isBusinessActive() && !store().isAssistant()) return;
      if (route.screen === 'office') {
        SF.data.allInquiries();
        if (route.section === 'brain') SF.data.brain();
        if (route.section === 'team') SF.data.business();
        if (route.section === 'calendar') {
          SF.data.business();
          const key = calendarKey(state);
          if (key) SF.data.calendar(key);
        }
        if (route.section === 'funnel') {
          SF.data.business();
          const businessId = funnelBusinessId(state);
          if (businessId) {
            const days = FUNNEL_DAYS.some(d => d.id === route.days) ? route.days : '30';
            const status = FUNNEL.some(f => f.id === route.fstatus) ? route.fstatus : 'waiting_human';
            if (route.fview === 'steps') {
              const c = funnelStepsProject(route);
              const report = c && state.remote.funnelSteps[`${c.id}|${days}`];
              if (c) SF.data.funnelSteps(c.id, days);
              const steps = (report && report.steps) || [];
              const stepId = steps.some(st => st.id === route.fstep) ? route.fstep : (steps[0] && steps[0].id);
              if (c && stepId) SF.data.funnelStepList(c.id, days, stepId);
            } else {
              SF.data.funnel(businessId, days);
              SF.data.funnelList(businessId, days, status);
            }
          }
        }
      } else if (route.screen === 'office-consultant') {
        const c = store().findOfficeConsultant(route.id);
        if (c && c.assisting) {
          SF.data.clients(route.id);
          return;
        }
        if (!route.tab || route.tab === 'methodology') SF.data.brain();
        if (route.tab === 'analytics') SF.data.analytics(route.id);
        if (route.tab === 'income') SF.data.clients(route.id);
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
