// screens/office.js - Office (business profile) inside the Marketplace tab. Real data only.
// Sections: Мои SI-продавцы · Воронка · Мой SI-мозг (материалы, по которым отвечает SI) · Мне написали · Помощник.
// Each SI-consultant has four tabs: Карточка и методология · Аналитика · Клиенты · Рассылки.
// The assistant of a business sees its SI-sellers with clients, the funnel and "Мне написали" only: no money,
// payment links, SI-brain or settings (the server checks this too).

(function (window) {
  const SF = window.SF;
  const showToast = SF.showToast;

  const SECTIONS = [
    { id: 'consultants', label: 'Мои SI', icon: 'bot' },
    { id: 'funnel', label: 'Воронка', icon: 'filter' },
    { id: 'brain', label: 'SI-мозг', icon: 'brain' },
    { id: 'inbox', label: 'Мне написали', icon: 'user-check' },
    { id: 'team', label: 'Помощник', icon: 'user-plus' }
  ];
  const ASSISTANT_SECTIONS = ['consultants', 'funnel', 'inbox'];

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
    silent: 'Клиент замолчал (через N часов)',
    custom: 'Своё условие (напишу словами)'
  };
  const MAX_SCENARIOS = 20;
  const SCENARIO_THEN = {
    si_says: 'SI отвечает так',
    handover: 'Передать человеку (SI на паузу)',
    notify: 'Сообщить мне в Telegram'
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
      ['payments', 'Оплата напрямую', 'Клиенты платят мне по моей ссылке. SmartFlow не принимает платежи.']
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
    if (section === 'brain') body = renderBrain(state);
    if (section === 'inbox') body = renderInbox(state);
    if (section === 'team') body = renderTeam(state);
    return `
      <div class="grid ${sections.length === 5 ? 'grid-cols-5' : 'grid-cols-3'} gap-1 bg-raised p-1.5 rounded-2xl border border-line">
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
    const funnel = state.remote.funnel[`${businessId}|${days}`];
    const status = FUNNEL.some(f => f.id === route.fstatus) ? route.fstatus : 'waiting_human';
    const list = state.remote.funnelLists[`${businessId}|${days}|${status}`];
    const counts = (funnel && funnel.counts) || {};
    return `
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
    if (tab === 'methodology') body = renderMethodology(c) + renderConsultantBrain(c, state);
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

  function renderMethodology(c) {
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
      ${renderScenarios(c)}
    `;
  }

  // Methodology: "если…, то…" — SI answers by them, hands the client over or tells the owner
  function renderScenarios(c) {
    const list = c.scenarios || [];
    const whenText = (sc) => {
      if (sc.when === 'custom') return SF.esc(sc.condition);
      if (sc.when === 'silent') return `Клиент молчит ${Number(sc.hours) || 24} ч`;
      return `${SCENARIO_WHEN[sc.when] || ''}${sc.when === 'objection' && sc.words ? ` («${SF.esc(sc.words)}»)` : ''}`;
    };
    return `
      <div class="glass-card-3d p-4 space-y-3 text-xs">
        ${SF.sectionTitle('git-branch', 'Методология: сценарии «если…, то…»')}
        <div class="text-[11px] text-muted leading-snug">Своя воронка у каждого SI-продавца: по умолчанию сценариев нет, вы пишете их сами — до ${MAX_SCENARIOS}. SI замечает в переписке оффер, возражения, отказ и ваши условия.</div>
        ${list.map((sc, i) => `
          <div class="p-2.5 rounded-xl bg-sunken border border-line flex items-start gap-2">
            <div class="flex-1 min-w-0 space-y-0.5">
              <div><span class="text-faint">Если</span> <span class="font-semibold text-ink">${whenText(sc)}</span></div>
              <div><span class="text-faint">то</span> <span class="font-semibold text-ink">${SCENARIO_THEN[sc.then] || ''}</span>${sc.text ? `<span class="text-ink-2">: ${SF.esc(sc.text)}</span>` : ''}</div>
            </div>
            <button onclick="SF.actions.removeScenario('${SF.js(c.id)}', ${i})" class="p-1.5 rounded-lg btn-3d-dark" aria-label="Удалить сценарий"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
          </div>`).join('')}
        ${!list.length ? '<div class="text-faint">Сценариев пока нет. Например: если клиент возразил «дорого» → SI рассказывает про рассрочку.</div>' : ''}
        ${list.length >= MAX_SCENARIOS ? `<div class="text-faint">Добавлено ${MAX_SCENARIOS} сценариев — это максимум. Удалите ненужный, чтобы добавить новый.</div>` : `
        <form onsubmit="SF.actions.addScenario(event, '${SF.js(c.id)}')" class="space-y-2 pt-2 border-t border-line">
          <label class="block space-y-1">
            <span class="font-semibold text-ink-2">Если</span>
            <select name="when" onchange="this.form.words.parentElement.style.display = this.value === 'objection' ? '' : 'none'; this.form.condition.parentElement.style.display = this.value === 'custom' ? '' : 'none'; this.form.hours.parentElement.parentElement.style.display = this.value === 'silent' ? '' : 'none'" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink">
              ${Object.entries(SCENARIO_WHEN).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}
            </select>
          </label>
          ${field('words', 'Про что возражение (необязательно, через запятую)', '', { placeholder: 'дорого, нет денег', max: 120 })}
          <div style="display:none">${field('condition', 'Условие словами', '', { placeholder: 'Например: клиент спрашивает, можно ли платить частями', max: 200 })}</div>
          <div style="display:none">${field('hours', 'Через сколько часов молчания', 24, { type: 'number', max: 3, hint: 'Сработает один раз, пока клиент снова не напишет. Тем, кто купил или отказался, SI не пишет.' })}</div>
          <label class="block space-y-1">
            <span class="font-semibold text-ink-2">То</span>
            <select name="then" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink">
              ${Object.entries(SCENARIO_THEN).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}
            </select>
          </label>
          ${field('text', 'Что сказать или сделать', '', { placeholder: 'Например: мягко рассказать про рассрочку на 3 месяца', rows: 2, max: 500 })}
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
        <p class="text-xs text-muted leading-relaxed">Напишете обычными словами, кому и что отправить. SI подберёт клиентов по меткам и подготовит текст, а отправка будет только после вашего подтверждения.</p>
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
              <div class="${m.sender === 'client' ? 'chat-bubble-human' : (m.sender === 'expert_human' ? 'chat-bubble-expert' : 'chat-bubble-si')} text-xs">${SF.formatChatMarkdown(m.text)}</div>
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
    const RECEIPT_STATUS = { new: ['Ждёт проверки', 'text-amber-500'], confirmed: ['Оплата подтверждена', 'text-emerald-500'], rejected: ['Не подтверждён', 'text-faint'] };
    const button = (outcome, label) => `<button onclick="SF.actions.markOutcome('${SF.js(route.projectId)}', '${SF.js(client.id)}', '${outcome}')" class="flex-1 py-2 rounded-xl btn-3d-dark text-[11px] font-bold">${label}</button>`;
    return `
      <div class="glass-card-3d p-3 space-y-2">
        <div class="flex items-center justify-between gap-2">
          <span class="px-2 py-1 rounded-lg border text-[11px] font-bold ${f.cls}">${f.label}</span>
          ${objection ? `<span class="text-[10px] text-muted truncate">Возражение: «${SF.esc(objection)}»</span>` : ''}
        </div>
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
  async function saveScenarios(id, scenarios) {
    const project = await api().getProject(id);
    const res = await api().updateProject(id, {
      custom_ai_settings: { ...(project.custom_ai_settings || {}), scenarios }
    });
    store().updateOfficeConsultant(id, { scenarios: (res.custom_ai_settings || {}).scenarios || scenarios });
  }

  SF.actions.addScenario = async (e, id) => {
    e.preventDefault();
    if (needServer()) return;
    const f = e.target;
    const c = store().findOfficeConsultant(id);
    if (!c) return;
    const scenario = {
      when: f.when.value,
      words: f.when.value === 'objection' ? f.words.value.trim() : '',
      condition: f.when.value === 'custom' ? f.condition.value.trim() : '',
      hours: f.when.value === 'silent' ? Math.max(1, Math.min(720, parseInt(f.hours.value, 10) || 24)) : undefined,
      then: f.then.value,
      text: f.text.value.trim()
    };
    if (scenario.when === 'custom' && !scenario.condition) {
      showToast('Напишите условие словами');
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
    if (!c || !confirm('Удалить этот сценарий?')) return;
    try {
      await saveScenarios(id, (c.scenarios || []).filter((_, i) => i !== index));
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
        if (route.section === 'funnel') {
          SF.data.business();
          const businessId = funnelBusinessId(state);
          if (businessId) {
            const days = FUNNEL_DAYS.some(d => d.id === route.days) ? route.days : '30';
            const status = FUNNEL.some(f => f.id === route.fstatus) ? route.fstatus : 'waiting_human';
            SF.data.funnel(businessId, days);
            SF.data.funnelList(businessId, days, status);
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
