// screens/office.js - Office (business profile) inside the Marketplace tab. Real data only.
// Sections: Мои смарт-консультанты · Мой SI-мозг (материалы, по которым отвечает SI) · Мне написали.
// Each SI-consultant has four tabs: Карточка и методология · Аналитика · Клиенты · Рассылки.

(function (window) {
  const SF = window.SF;
  const showToast = SF.showToast;

  const SECTIONS = [
    { id: 'consultants', label: 'Мои SI', icon: 'bot' },
    { id: 'brain', label: 'SI-мозг', icon: 'brain' },
    { id: 'inbox', label: 'Мне написали', icon: 'user-check' }
  ];

  const CONSULTANT_TABS = [
    { id: 'methodology', label: 'Карточка и методология', icon: 'git-branch' },
    { id: 'analytics', label: 'Аналитика', icon: 'trending-up' },
    { id: 'income', label: 'Клиенты', icon: 'users' },
    { id: 'broadcasts', label: 'Рассылки', icon: 'send-horizontal' }
  ];

  const ROLE_SUGGESTIONS = ['SI-консультант', 'SI-помощник', 'SI-ассистент', 'SI-менеджер'];

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

  function needServer() {
    if (SF.data.signedIn()) return false;
    showToast('Нет связи с сервером. Откройте приложение в Telegram');
    return true;
  }

  // ---------------- Terms before the Office opens ----------------
  function renderTerms() {
    const terms = [
      ['terms', 'Правила платформы SmartFlow', 'SI-консультанты отвечают только по моим данным и не обещают того, чего нет в методологии.'],
      ['data', 'Данные моих клиентов', 'Переписки хранятся в SmartFlow; рассылки — только после моего подтверждения.'],
      ['payments', 'Оплата напрямую', 'Клиенты платят мне по моей ссылке. SmartFlow не принимает платежи.']
    ];
    return `
      <div class="glass-card-3d p-4 space-y-3">
        <div class="flex items-center gap-3">
          <img src="${SF.MASCOTS.consultant}" alt="" class="w-14 h-14" />
          <div>
            <div class="text-base font-extrabold text-ink">Бизнес-профиль</div>
            <div class="text-xs text-muted">Офис: ваши SI-консультанты и личные обращения клиентов.</div>
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
    if (!store().isBusinessActive()) return renderTerms();
    const section = route.section || 'consultants';
    const waiting = SF.data.waitingInquiries(state).length;
    let body = '';
    if (section === 'consultants') body = renderConsultantList(state);
    if (section === 'brain') body = renderBrain(state);
    if (section === 'inbox') body = renderInbox(state);
    return `
      <div class="grid grid-cols-3 gap-1.5 bg-raised p-1.5 rounded-2xl border border-line">
        ${SECTIONS.map(s => `
          <button onclick="SF.patch({ section: '${s.id}' })" class="relative py-2 rounded-xl text-[11px] font-semibold flex flex-col items-center gap-1 ${section === s.id ? 'bg-[#81D8D0] text-[#08302c] shadow' : 'text-muted'}">
            <i data-lucide="${s.icon}" class="w-4 h-4"></i>${s.label}
            ${s.id === 'inbox' && waiting ? `<span class="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">${waiting}</span>` : ''}
          </button>`).join('')}
      </div>
      ${body}
    `;
  }

  function renderConsultantList(state) {
    const list = state.office.consultants;
    return `
      <button onclick="SF.push('office-create')" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm flex items-center justify-center gap-1.5">
        <i data-lucide="plus" class="w-4 h-4"></i> Создать SI-консультанта
      </button>
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
        ${!list.length ? `<div class="text-xs text-muted px-1">${SF.data.signedIn() ? 'Пока нет консультантов — создайте первого.' : 'Откройте приложение в Telegram, чтобы увидеть своих консультантов.'}</div>` : ''}
      </div>
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
    const consultants = state.office.consultants;
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
          : '<div class="text-[10px] text-faint">Создайте SI-консультанта, чтобы открыть ему этот материал.</div>'}
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

  // ---------------- Create a consultant ----------------
  function renderCreate() {
    return `
      <form onsubmit="SF.actions.createConsultant(event)" class="glass-card-3d p-4 space-y-3 text-xs">
        <div class="text-[11px] text-muted leading-snug">У каждого SI-консультанта есть цель, чёткие инструкции и лимит на клиента — он работает сам, без вашего участия.</div>
        ${field('name', 'Имя для клиентов', '', { placeholder: 'Например: Елена · менторство', max: 60 })}
        <label class="block space-y-1">
          <span class="font-semibold text-ink-2">Роль (всегда начинается с SI)</span>
          <input name="role" list="role-suggestions" value="SI-консультант" maxlength="40" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink" />
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
    if (!c) return SF.emptyState('assistant', 'Консультант не найден', 'Вернитесь в Офис и выберите другого.');
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
          <div class="text-[10px] text-muted">Ссылка для клиентов — открывает чат с этим консультантом:</div>
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

  function renderMethodology(c) {
    return `
      <form onsubmit="SF.actions.saveConsultant(event, '${SF.js(c.id)}')" class="space-y-3 text-xs">
        <div class="glass-card-3d p-4 space-y-3">
          ${SF.sectionTitle('store', 'Карточка в Маркетплейсе')}
          ${field('offer', 'Оффер — что получит клиент', c.offer, { placeholder: 'Например: выйти из операционки за 8 недель', max: 200 })}
          ${field('description', 'Описание', c.description, { placeholder: 'Коротко: для кого, как проходит, что внутри', rows: 3, max: 1000 })}
          ${field('priceLabel', 'Цена', c.priceLabel, { placeholder: 'Например: 25 000 ₽ или Бесплатно', max: 80 })}
          ${field('paymentUrl', 'Ваша ссылка на оплату', c.paymentUrl, { type: 'url', placeholder: 'https://...', max: 300, hint: 'Своя у каждого консультанта. Кнопка «Купить» ведёт сюда, деньги приходят вам напрямую.' })}
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
      <div class="text-[10px] text-faint px-1">Только настоящие цифры этого консультанта. Оплаты идут вам напрямую, поэтому продажи здесь пока не считаются. Советы SI по воронке появятся позже.</div>
    `;
  }

  function renderClients(c, state) {
    const clients = state.remote.clients[c.id];
    if (!clients) return '<div class="text-xs text-muted">Загружаю…</div>';
    if (!clients.length) {
      return SF.emptyState('consultant', 'Клиентов пока нет', 'Отправьте ссылку консультанта в свой канал, сторис или рассылку — клиенты появятся здесь.');
    }
    return `
      <div class="flex gap-2 overflow-x-auto snap-x snap-mandatory pb-1 -mx-1 px-1">
        ${clients.map(cl => `
          <button onclick="SF.push('office-client', { id: '${SF.js(cl.id)}', projectId: '${SF.js(c.id)}' })" class="snap-start flex-shrink-0 w-[31%] min-w-[104px] p-2.5 rounded-2xl bg-card border border-line text-left space-y-1">
            ${SF.avatar(cl.avatar_url, { size: 32 })}
            <div class="text-[11px] font-bold text-ink truncate">${SF.esc(cl.name)}</div>
            <div class="text-[10px] font-semibold truncate ${cl.status === 'human_needed' ? 'text-amber-400' : 'text-muted'}">${cl.status === 'human_needed' ? 'Ждёт вас' : 'Говорит с SI'}</div>
          </button>`).join('')}
      </div>
      <div class="space-y-1.5">
        ${clients.map(cl => `
          <button onclick="SF.push('office-client', { id: '${SF.js(cl.id)}', projectId: '${SF.js(c.id)}' })" class="w-full p-2.5 rounded-xl bg-card border border-line flex items-center gap-2.5 text-left">
            ${SF.avatar(cl.avatar_url, { size: 32 })}
            <span class="flex-1 min-w-0">
              <span class="block text-xs font-bold text-ink truncate">${SF.esc(cl.name)}</span>
              <span class="block text-[10px] text-muted truncate">${SF.esc(String(cl.last_message || '').replace(/^\[(SI|Эксперт)\]:\s*/, ''))}</span>
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
    const paused = client.status === 'human_needed';
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
          ${paused ? '👤 SI на паузе — отвечаете вы' : '<span class="si-dot"></span> SI отвечает этому клиенту'}
        </span>
        <button onclick="SF.actions.setClientSi('${SF.js(route.projectId)}', '${SF.js(client.id)}', ${paused})" class="px-2 py-1 rounded-lg btn-3d-dark text-[10px] font-bold">${paused ? 'Включить SI' : 'Поставить на паузу'}</button>
      </div>

      <div class="glass-card-3d p-3 space-y-2">
        <div class="space-y-2 max-h-96 overflow-y-auto py-1 pr-1" id="client-chat-scroll">
          ${!messages ? '<div class="text-xs text-muted">Загружаю…</div>' : ''}
          ${(messages || []).map(m => `
            <div class="flex flex-col ${m.sender === 'client' ? 'items-start' : 'items-end'}">
              <div class="text-[9px] text-faint mb-0.5 px-1">
                ${m.sender === 'client' ? SF.esc(client.name) : (m.sender === 'expert_human' ? '👤 Вы лично' : SF.siLabel('SI'))} · ${timeLabel(m.createdAt || m.created_at)}
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
    showToast('Офис открыт! Заполните карточку своего SI-консультанта');
    SF.patch({ section: 'consultants' });
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
      showToast('SI-консультант создан. Добавьте фото, оффер и ссылку на оплату');
    } catch (err) {
      showToast(err.message || 'Не удалось создать консультанта');
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
        category: f.category.value,
        trial_days: parseInt(f.trialDays.value, 10) || 0,
        is_listed: f.isListed.checked,
        custom_ai_settings: { ...(project.custom_ai_settings || {}), goal, instructions, clientLimit }
      });
      SF.data.invalidate('consultants');
      SF.data.invalidate('marketplace');
      await SF.data.myConsultants();
      showToast(f.isListed.checked ? 'Сохранено. Консультант виден в Маркетплейсе' : 'Сохранено');
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
      showToast('Фото SI-консультанта сохранено');
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
        <div class="text-[10px] text-faint">Внутри платформы все они — смарт-консультанты; клиенты видят это имя и роль.</div>
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
    const consultantIds = consultantId ? [consultantId] : store().data.office.consultants.map(c => c.id);
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
    'office-create': 'Новый SI-консультант',
    'office-consultant': 'SI-консультант',
    'office-client': 'Клиент'
  };

  SF.office = {
    title(route) {
      return TITLES[route.screen] || 'Офис';
    },
    render(route, state) {
      if (route.screen === 'office') return renderOffice(route, state);
      if (!store().isBusinessActive()) return renderTerms();
      if (route.screen === 'office-create') return renderCreate();
      if (route.screen === 'office-consultant') return renderConsultant(route, state);
      if (route.screen === 'office-client') return renderClient(route, state);
      return renderOffice(route, state);
    },
    afterRender(route, state) {
      if (!store().isBusinessActive()) return;
      if (route.screen === 'office') {
        SF.data.allInquiries();
        if (route.section === 'brain') SF.data.brain();
      } else if (route.screen === 'office-consultant') {
        if (!route.tab || route.tab === 'methodology') SF.data.brain();
        if (route.tab === 'analytics') SF.data.analytics(route.id);
        if (route.tab === 'income') SF.data.clients(route.id);
      } else if (route.screen === 'office-client') {
        SF.data.clients(route.projectId);
        SF.data.clientMessages(route.projectId, route.id);
        SF.scrollToBottom('client-chat-scroll');
        SF.data.poll(`client:${route.id}`, () => SF.data.clientMessages(route.projectId, route.id));
      }
    }
  };
})(window);
