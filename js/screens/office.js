// screens/office.js - Office (business profile) inside the Marketplace tab.
// Sections: Мои смарт-консультанты · Мой SI-мозг · Мне написали.
// Each SI-consultant has four tabs: Методология · Аналитика · Подписки и доход · Рассылки.
// Data on these tabs is demo (js/store.js `expert`) until it comes from the server;
// name, role, photo and link of real consultants are already saved on the server.

(function (window) {
  const SF = window.SF;
  const formatMoney = SF.formatMoney;
  const showToast = SF.showToast;
  const scrollToBottom = SF.scrollToBottom;
  let activeVoicePlaybackId = null;

  const SECTIONS = [
    { id: 'consultants', label: 'Мои SI', icon: 'bot' },
    { id: 'brain', label: 'SI-мозг', icon: 'brain' },
    { id: 'inbox', label: 'Мне написали', icon: 'user-check' }
  ];

  const CONSULTANT_TABS = [
    { id: 'methodology', label: 'Методология', icon: 'git-branch' },
    { id: 'analytics', label: 'Аналитика', icon: 'trending-up' },
    { id: 'income', label: 'Подписки и доход', icon: 'wallet' },
    { id: 'broadcasts', label: 'Рассылки', icon: 'send-horizontal' }
  ];

  const ROLE_SUGGESTIONS = ['SI-консультант', 'SI-помощник', 'SI-ассистент', 'SI-менеджер'];

  // Funnel stages for the visual funnel of a client (passed = colored, not yet = gray)
  const STAGES = ['Первый диалог', 'Квалификация', 'Оффер', 'Возражения', 'Оплата / созвон'];
  const STAGE_BY_STATUS = { new: 1, objection: 3, hot: 4, closed: 5 };

  function store() {
    return window.funnelStore;
  }

  function roleWithSi(value) {
    const title = String(value || '').trim();
    if (!title) return 'SI-консультант';
    if (/^SI(\b|-)/i.test(title)) return 'SI' + title.slice(2);
    return `SI-${title.charAt(0).toLowerCase()}${title.slice(1)}`;
  }

  // ---------------- Terms before the Office opens ----------------
  function renderTerms() {
    const terms = [
      ['terms', 'Правила платформы SmartFlow', 'SI-консультанты не обещают того, чего нет в методологии, и не выдумывают факты.'],
      ['data', 'Данные моих клиентов', 'Храню переписки в SmartFlow; рассылки — только после моего подтверждения.'],
      ['payments', 'Оплата напрямую', 'Клиенты платят мне по моей ссылке. SmartFlow пока не принимает платежи.']
    ];
    return `
      <div class="glass-card-3d p-4 space-y-3">
        <div class="flex items-center gap-3">
          <img src="${SF.MASCOTS.consultant}" alt="" class="w-14 h-14" />
          <div>
            <div class="text-base font-extrabold text-ink">Бизнес-профиль</div>
            <div class="text-xs text-muted">Офис: ваши SI-консультанты, SI-мозг и личные обращения клиентов.</div>
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
    if (!state.me.business.active) return renderTerms();
    const section = route.section || 'consultants';
    const waiting = state.expert.directHumanInquiries.filter(i => i.status === 'waiting').length;
    let body = '';
    if (section === 'consultants') body = renderConsultantList(state);
    if (section === 'brain') body = renderBrain(state);
    if (section === 'inbox') body = renderExpertDirectInquiriesWindow(state);
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
      <div class="text-[11px] text-muted px-1">Или купите готового в Маркетплейсе — он тоже появится здесь.</div>
      <div class="space-y-2.5">
        ${list.map(c => `
          <button onclick="SF.push('office-consultant', { id: '${SF.js(c.id)}', tab: 'methodology' })" class="w-full glass-card-3d p-3.5 text-left flex items-center gap-3">
            ${SF.avatar(c.photoUrl, { size: 48, kind: 'si' })}
            <span class="flex-1 min-w-0">
              <span class="block text-sm font-bold text-ink truncate">${SF.esc(c.name)}</span>
              <span class="block text-[11px]">${SF.siLabel(c.roleTitle)}</span>
              <span class="block text-[10px] text-faint mt-0.5">${c.source === 'bought' ? `Куплен · автор ${SF.esc(c.author || '')}` : 'Создан вами'}${c.serverProjectId ? '' : ' · только на этом устройстве'}</span>
            </span>
            <i data-lucide="chevron-right" class="w-4 h-4 text-faint"></i>
          </button>`).join('')}
      </div>
    `;
  }

  // ---------------- SI-brain ----------------
  function renderBrain(state) {
    const materials = state.office.brain.materials;
    const topics = [...new Set(materials.map(m => m.topic))];
    return `
      <div class="glass-card-3d p-4 space-y-2">
        <div class="flex items-center gap-2">
          <span class="si-dot"></span>
          <span class="text-sm font-bold text-ink">Мой SI-мозг</span>
        </div>
        <p class="text-xs text-muted leading-relaxed">Все ваши материалы в одном месте. Каждый SI-консультант знает только то, что вы ему откроете во вкладке «Методология». Если SI чего-то не знает — он так и скажет и спросит вас.</p>
        <button onclick="SF.showToast('Загрузка материалов появится на следующем шаге: PDF, тексты, аудио и видео с расшифровкой')" class="w-full py-2.5 rounded-xl btn-3d-dark text-xs flex items-center justify-center gap-1.5">
          <i data-lucide="upload" class="w-4 h-4"></i> Загрузить материал ${SF.soonBadge()}
        </button>
      </div>
      ${topics.map(topic => `
        <div class="space-y-1.5">
          <div class="text-[11px] font-bold text-muted uppercase tracking-wider px-1">${SF.esc(topic)}</div>
          ${materials.filter(m => m.topic === topic).map(m => `
            <div class="p-3 rounded-xl bg-card border border-line flex items-center gap-2.5">
              <span class="w-9 h-9 rounded-xl bg-raised flex items-center justify-center text-[10px] font-bold text-ink-2">${SF.esc(m.type)}</span>
              <span class="flex-1 min-w-0">
                <span class="block text-xs font-semibold text-ink truncate">${SF.esc(m.title)}</span>
                <span class="block text-[10px] text-faint">${SF.esc(m.size)} · доступ: ${state.office.consultants.filter(c => (c.brainAccess || []).includes(m.id)).length} SI</span>
              </span>
            </div>`).join('')}
        </div>`).join('')}
    `;
  }

  // ---------------- Create a consultant ----------------
  function renderCreate() {
    return `
      <form onsubmit="SF.actions.createConsultant(event)" class="glass-card-3d p-4 space-y-3 text-xs">
        <div class="text-[11px] text-muted leading-snug">У каждого SI-консультанта есть цель, чёткие инструкции и лимит на клиента — он автономный, а не болталка.</div>
        <label class="block space-y-1">
          <span class="font-semibold text-ink-2">Имя для клиентов</span>
          <input name="name" required maxlength="60" placeholder="Например: Елена · менторство" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink" />
        </label>
        <label class="block space-y-1">
          <span class="font-semibold text-ink-2">Роль (всегда начинается с SI)</span>
          <input name="role" list="role-suggestions" value="SI-консультант" maxlength="40" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink" />
          <datalist id="role-suggestions">${ROLE_SUGGESTIONS.map(r => `<option value="${r}"></option>`).join('')}</datalist>
        </label>
        <label class="block space-y-1">
          <span class="font-semibold text-ink-2">Тип</span>
          <select name="category" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink">
            <option value="sales">Продажи — ведёт до покупки</option>
            <option value="warmup">Прогрев и заявки — польза и конкретная цель</option>
          </select>
        </label>
        <label class="block space-y-1">
          <span class="font-semibold text-ink-2">Цель</span>
          <input name="goal" required maxlength="160" placeholder="Например: записать на разбор за 25 000 ₽" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink" />
        </label>
        <label class="block space-y-1">
          <span class="font-semibold text-ink-2">Инструкции</span>
          <textarea name="instructions" rows="3" maxlength="800" placeholder="Что можно и чего нельзя: не обещать результат в цифрах, передавать мне вопросы про договор..." class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink"></textarea>
        </label>
        <label class="block space-y-1">
          <span class="font-semibold text-ink-2">Лимит сообщений SI на одного клиента</span>
          <input name="limit" type="number" min="5" max="500" value="40" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink" />
        </label>
        <button type="submit" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm">Создать</button>
      </form>
    `;
  }

  // ---------------- One consultant ----------------
  function renderConsultant(route, state) {
    const c = store().findOfficeConsultant(route.id);
    if (!c) return SF.emptyState('assistant', 'Консультант не найден', 'Вернитесь в Офис и выберите другого.');
    const tab = route.tab || 'methodology';
    let body = '';
    if (tab === 'methodology') body = renderMethodology(c, state);
    if (tab === 'analytics') body = renderExpertAnalyticsWindow(state) + renderExpertRecommendationsWindow(state) +
      '<div class="text-[10px] text-faint text-center">SI может ошибаться — проверяйте рекомендации перед применением.</div>';
    if (tab === 'income') body = renderIncome(c, state);
    if (tab === 'broadcasts') body = renderExpertBroadcastWindow(state);

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
            <div class="text-[10px] text-faint">${c.source === 'bought' ? `Хост — вы · автор ${SF.esc(c.author || '')}` : 'Автор — вы'}</div>
          </div>
          <button onclick="SF.actions.editConsultant('${SF.js(c.id)}')" class="p-2 rounded-xl btn-3d-dark" aria-label="Изменить имя и роль">
            <i data-lucide="pencil" class="w-4 h-4"></i>
          </button>
        </div>
        ${c.link ? `
          <div class="p-2.5 rounded-xl bg-sunken border border-line flex items-center gap-2">
            <i data-lucide="link-2" class="w-4 h-4 text-brand flex-shrink-0"></i>
            <span class="text-xs font-mono text-brand truncate flex-1">${SF.esc(c.link)}</span>
            <button onclick="window.copySellerLink('${SF.js(c.link)}')" class="px-2 py-1 rounded-lg btn-3d-tiffany text-[11px] flex items-center gap-1"><i data-lucide="copy" class="w-3 h-3"></i>Копировать</button>
            <button onclick="window.openQrModal('${SF.js(c.link)}')" class="p-1 rounded-lg btn-3d-dark" aria-label="QR-код"><i data-lucide="qr-code" class="w-4 h-4 text-brand"></i></button>
          </div>` : `<div class="text-[11px] text-muted">Ссылка появится после распаковки.</div>`}
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

  function renderMethodology(c, state) {
    const materials = state.office.brain.materials;
    return `
      <form onsubmit="SF.actions.saveMethodology(event, '${SF.js(c.id)}')" class="glass-card-3d p-4 space-y-3 text-xs">
        ${SF.sectionTitle('target', 'Цель, инструкции, лимит')}
        <label class="block space-y-1">
          <span class="font-semibold text-ink-2">Цель</span>
          <input name="goal" value="${SF.esc(c.goal)}" maxlength="160" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink" />
        </label>
        <label class="block space-y-1">
          <span class="font-semibold text-ink-2">Инструкции</span>
          <textarea name="instructions" rows="3" maxlength="800" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink">${SF.esc(c.instructions)}</textarea>
        </label>
        <label class="block space-y-1">
          <span class="font-semibold text-ink-2">Лимит сообщений SI на клиента</span>
          <input name="limit" type="number" min="5" max="500" value="${Number(c.clientLimit) || 40}" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink" />
        </label>
        <button type="submit" class="w-full py-2.5 rounded-xl btn-3d-tiffany text-xs">Сохранить</button>
      </form>

      <div class="glass-card-3d p-4 space-y-2">
        ${SF.sectionTitle('git-branch', 'Сценарии «если…, то…»')}
        ${(c.scenarios || []).map(s => `
          <div class="p-2.5 rounded-xl bg-sunken border border-line text-xs">
            <span class="text-muted">Если</span> <span class="font-semibold text-ink">${SF.esc(s.when)}</span>
            <span class="text-muted">→ то</span> <span class="text-ink-2">${SF.esc(s.then)}</span>
          </div>`).join('')}
        <div class="text-[10px] text-faint">Редактор сценариев — на следующем шаге, вместе с подключением OpenAI.</div>
      </div>

      <div class="glass-card-3d p-4 space-y-2">
        ${SF.sectionTitle('brain', 'Что ему можно знать из SI-мозга')}
        ${materials.map(m => `
          <label class="flex items-center gap-2.5 p-2.5 rounded-xl bg-sunken border border-line cursor-pointer">
            <input type="checkbox" ${(c.brainAccess || []).includes(m.id) ? 'checked' : ''} onchange="SF.actions.toggleBrain('${SF.js(c.id)}', '${SF.js(m.id)}')" class="w-4 h-4 accent-[#0d9488]" />
            <span class="flex-1 text-xs text-ink">${SF.esc(m.title)}</span>
            <span class="text-[10px] text-faint">${SF.esc(m.topic)}</span>
          </label>`).join('')}
      </div>

      ${renderExpertPmfWindow(state)}
    `;
  }

  function renderIncome(c, state) {
    const chats = state.expert.chats;
    const an = state.expert.analytics;
    return `
      <div class="grid grid-cols-3 gap-2 text-center">
        <div class="p-2.5 rounded-xl bg-card border border-line"><div class="text-[10px] text-muted">Выручка</div><div class="text-sm font-extrabold text-brand">${an.revenue}</div></div>
        <div class="p-2.5 rounded-xl bg-card border border-line"><div class="text-[10px] text-muted">Удержание 30 дн.</div><div class="text-sm font-extrabold text-ink">62%</div></div>
        <div class="p-2.5 rounded-xl bg-card border border-line"><div class="text-[10px] text-muted">Сделок</div><div class="text-sm font-extrabold text-ink">${an.dealsClosed}</div></div>
      </div>
      <div class="text-[10px] text-faint px-1">Результативность именно этого SI. Деньги клиенты платят вам напрямую.</div>

      <div class="space-y-2">
        ${SF.sectionTitle('users', 'Клиенты', `<button onclick="SF.patch({ showAllClients: true })" class="text-[11px] font-semibold text-brand">Все (${chats.length})</button>`)}
        <div class="flex gap-2 overflow-x-auto snap-x snap-mandatory pb-1 -mx-1 px-1">
          ${chats.map(chat => clientCard(chat, 'w-[31%] min-w-[104px]')).join('')}
        </div>
      </div>

      ${window.funnelStore.currentRoute().showAllClients ? `
        <div class="space-y-1.5">
          ${chats.map(chat => clientRow(chat)).join('')}
        </div>` : ''}
    `;
  }

  function clientCard(chat, sizeClass) {
    return `
      <button onclick="SF.push('office-client', { id: '${SF.js(chat.id)}' })" class="snap-start flex-shrink-0 ${sizeClass} p-2.5 rounded-2xl bg-card border border-line text-left space-y-1">
        ${SF.avatar(chat.leadAvatar, { size: 32 })}
        <div class="text-[11px] font-bold text-ink truncate">${SF.esc(chat.leadName)}</div>
        <div class="text-[10px] font-semibold ${chat.status === 'hot' ? 'text-rose-400' : (chat.status === 'closed' ? 'text-emerald-400' : 'text-amber-400')} truncate">${SF.esc(chat.statusLabel)}</div>
      </button>`;
  }

  function clientRow(chat) {
    return `
      <button onclick="SF.push('office-client', { id: '${SF.js(chat.id)}' })" class="w-full p-2.5 rounded-xl bg-card border border-line flex items-center gap-2.5 text-left">
        ${SF.avatar(chat.leadAvatar, { size: 32 })}
        <span class="flex-1 min-w-0">
          <span class="block text-xs font-bold text-ink truncate">${SF.esc(chat.leadName)}</span>
          <span class="block text-[10px] text-muted truncate">${SF.esc(chat.summary)}</span>
        </span>
        <span class="text-[11px] font-bold text-brand">${SF.esc(chat.dealValue)}</span>
      </button>`;
  }

  // ---------------- One client: conversation + business data ----------------
  function renderClient(route, state) {
    const chat = state.expert.chats.find(c => c.id === route.id);
    if (!chat) return SF.emptyState('assistant', 'Клиент не найден', 'Вернитесь к списку клиентов.');
    const stage = STAGE_BY_STATUS[chat.status] || 2;
    const inquiry = state.expert.directHumanInquiries.find(i => i.leadUsername === chat.leadUsername);
    const tags = inquiry?.tags || [];
    return `
      <div class="glass-card-3d p-3.5 flex items-center gap-3">
        ${SF.avatar(chat.leadAvatar, { size: 44 })}
        <div class="flex-1 min-w-0">
          <div class="text-sm font-bold text-ink">${SF.esc(chat.leadName)} <span class="text-[10px] font-mono text-brand">${SF.esc(chat.leadUsername)}</span></div>
          <div class="text-[11px] text-muted leading-snug">${SF.esc(chat.summary)}</div>
        </div>
        <div class="text-right text-xs font-extrabold text-brand">${SF.esc(chat.dealValue)}</div>
      </div>

      <div class="glass-card-3d p-3.5 space-y-2">
        ${SF.sectionTitle('filter', 'Этап воронки')}
        <div class="space-y-1">
          ${STAGES.map((s, i) => `
            <div class="flex items-center gap-2 text-[11px]">
              <span class="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${i < stage ? 'bg-[#81D8D0] text-[#08302c]' : 'bg-raised text-faint'}">${i + 1}</span>
              <span class="${i < stage ? 'text-ink font-semibold' : 'text-faint'}">${s}</span>
            </div>`).join('')}
        </div>
        <div class="flex flex-wrap gap-1 pt-1">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold ${chat.status === 'objection' ? 'bg-amber-500/20 text-amber-300' : 'bg-raised text-ink-2'}">${SF.esc(chat.statusLabel)}</span>
          ${tags.map(t => `<span class="px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 text-[10px] font-semibold">${SF.esc(t)}</span>`).join('')}
        </div>
      </div>

      <div class="glass-card-3d p-3 space-y-2">
        <div class="space-y-2 max-h-80 overflow-y-auto py-1 pr-1" id="expert-chat-scroll">
          ${chat.messages.map(msg => `
            <div class="flex flex-col ${msg.sender === 'lead' ? 'items-start' : 'items-end'}">
              <div class="text-[9px] text-faint mb-0.5 px-1">
                ${msg.sender === 'lead' ? SF.esc(chat.leadName) : (msg.sender === 'expert_human' ? '👤 Вы (лично)' : SF.siLabel('SI-консультант'))} • ${msg.time}
              </div>
              <div class="${msg.sender === 'lead' ? 'chat-bubble-human' : (msg.sender === 'expert_human' ? 'chat-bubble-expert' : 'chat-bubble-si')} text-xs">
                ${msg.isVoice ? `<div class="flex items-center gap-1.5 font-semibold text-brand"><i data-lucide="mic" class="w-3.5 h-3.5"></i>Голосовое (${msg.duration})</div>` : ''}
                ${SF.formatChatMarkdown(msg.text)}
              </div>
            </div>`).join('')}
        </div>
        <form onsubmit="window.handleExpertTakeover(event, '${SF.js(chat.id)}')" class="flex gap-2 pt-2 border-t border-line">
          <input type="text" id="expert-takeover-input" placeholder="Ответить лично (SI встанет на паузу)..." class="flex-1 bg-sunken border border-line-2 rounded-xl px-3 py-2 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]" />
          <button type="submit" class="px-3 py-2 rounded-xl btn-3d-tiffany text-xs flex items-center gap-1"><i data-lucide="send" class="w-3.5 h-3.5"></i></button>
        </form>
      </div>
    `;
  }


  // ---------------- Actions ----------------
  const api = () => window.smartFlowApi;
  const signedIn = () => api() && api().isSignedIn();

  SF.actions.activateBusiness = (e) => {
    e.preventDefault();
    store().activateBusiness();
    SF.confetti();
    showToast('Офис открыт! Создайте своего SI-консультанта');
    SF.patch({ section: 'consultants' });
  };

  SF.actions.createConsultant = async (e) => {
    e.preventDefault();
    const f = e.target;
    const data = {
      name: f.name.value.trim(),
      roleTitle: roleWithSi(f.role.value),
      category: f.category.value,
      goal: f.goal.value.trim(),
      instructions: f.instructions.value.trim(),
      clientLimit: Math.max(5, Math.min(500, parseInt(f.limit.value, 10) || 40))
    };
    let consultant = {
      ...JSON.parse(JSON.stringify(store().data.office.consultants[0] || {})),
      ...data,
      id: `oc-${Date.now()}`,
      serverProjectId: null,
      photoUrl: null,
      source: 'created',
      author: null,
      link: '',
      scenarios: [],
      brainAccess: []
    };

    if (signedIn()) {
      try {
        const project = await api().createProject({
          name: data.name,
          customAiSettings: { goal: data.goal, instructions: data.instructions, clientLimit: data.clientLimit, category: data.category }
        });
        await api().updateProject(project.id, { role_title: data.roleTitle });
        consultant = {
          ...consultant,
          id: project.id,
          serverProjectId: project.id,
          link: `https://t.me/smartflow_ai_support_bot/app?startapp=${project.slug}`
        };
      } catch (err) {
        showToast('Сервер недоступен — сохранил на этом устройстве');
      }
    }
    store().addOfficeConsultant(consultant);
    store().data.ui.routes.marketplace.pop(); // replace the form with the new consultant
    SF.push('office-consultant', { id: consultant.id, tab: 'methodology' });
    showToast('SI-консультант создан. Добавьте фото и откройте ему материалы');
  };

  SF.actions.saveMethodology = async (e, id) => {
    e.preventDefault();
    const f = e.target;
    const patch = {
      goal: f.goal.value.trim(),
      instructions: f.instructions.value.trim(),
      clientLimit: Math.max(5, Math.min(500, parseInt(f.limit.value, 10) || 40))
    };
    const c = store().updateOfficeConsultant(id, patch);
    if (c && c.serverProjectId && signedIn()) {
      try {
        // custom_ai_settings is replaced as a whole, so merge with what the server has
        const project = await api().getProject(c.serverProjectId);
        await api().updateProject(c.serverProjectId, {
          custom_ai_settings: { ...(project.custom_ai_settings || {}), ...patch }
        });
        showToast('Методология сохранена');
      } catch (err) {
        showToast('Сохранил на этом устройстве, сервер недоступен');
      }
    } else {
      showToast('Методология сохранена');
    }
  };

  SF.actions.toggleBrain = (consultantId, materialId) => {
    store().toggleBrainAccess(consultantId, materialId);
  };

  SF.actions.changeConsultantPhoto = async (id) => {
    const c = store().findOfficeConsultant(id);
    if (!c || !window.sfMedia) return;
    try {
      const upload = c.serverProjectId ? (blob) => api().uploadConsultantPhoto(c.serverProjectId, blob) : null;
      const result = await window.sfMedia.choosePhoto(upload);
      if (!result) return;
      store().updateOfficeConsultant(id, { photoUrl: result.url });
      showToast(result.savedOnServer ? 'Фото SI-консультанта сохранено' : 'Фото сохранено на этом устройстве');
    } catch (err) {
      showToast(err.message || 'Не удалось загрузить фото');
    }
  };

  SF.actions.editConsultant = (id) => {
    const c = store().findOfficeConsultant(id);
    if (!c) return;
    SF.openModal(`
      <form onsubmit="SF.actions.saveConsultantEdit(event, '${SF.js(c.id)}')" class="space-y-3 text-xs">
        <h3 class="text-sm font-bold text-ink">Имя и роль для клиентов</h3>
        <label class="block space-y-1">
          <span class="font-semibold text-ink-2">Имя</span>
          <input name="name" required maxlength="60" value="${SF.esc(c.name)}" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink" />
        </label>
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

  SF.actions.saveConsultantEdit = async (e, id) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    const roleTitle = roleWithSi(e.target.role.value);
    SF.closeModal();
    const c = store().updateOfficeConsultant(id, { name, roleTitle });
    if (c && c.serverProjectId && signedIn()) {
      try {
        await api().updateProject(c.serverProjectId, { name, role_title: roleTitle });
      } catch (err) {
        showToast('Сохранил на этом устройстве, сервер недоступен');
        return;
      }
    }
    showToast('Сохранено');
  };


  // ---------------- Parts moved from the former expert cabinet ----------------
  function renderExpertDirectInquiriesWindow(state) {
    const inquiries = state.expert.directHumanInquiries;
    const allTags = state.expert.allTags || [];
  
    return `
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <span class="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
              <i data-lucide="user-plus" class="w-4 h-4 text-brand"></i>
              Мне написали
            </span>
            <div class="text-[10px] text-muted">Клиенты, которым нужен живой человек. SI для них на паузе, рассылки не приходят</div>
          </div>
          <span class="text-[10px] px-2 py-0.5 rounded-full bg-[#81D8D0]/20 text-brand font-bold border border-[#81D8D0]/40">
            ${inquiries.length} обращений
          </span>
        </div>
  
        <div class="space-y-3">
          ${inquiries.map(inq => `
            <div class="glass-card-3d p-3.5 ${inq.status === 'waiting' ? 'border-[#81D8D0]' : 'border-line'}">
              <!-- Header -->
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                  <img src="${SF.photoSrc(inq.leadAvatar, 'images/avatar-person.svg')}" class="w-9 h-9 rounded-full object-cover border border-line-2" />
                  <div>
                    <div class="text-xs font-bold text-ink flex items-center gap-1.5">
                      ${SF.esc(inq.leadName)}
                      <span class="text-[10px] font-mono text-brand">${SF.esc(inq.leadUsername)}</span>
                    </div>
                    <div class="text-[10px] text-muted">${SF.esc(inq.sourceStep)} • ${SF.esc(inq.timeAgo)}</div>
                  </div>
                </div>
                <div class="text-right">
                  <span class="text-xs font-extrabold text-brand">${SF.esc(inq.dealValue)}</span>
                  <div class="text-[9px] font-bold ${inq.status === 'waiting' ? 'text-rose-400 animate-pulse' : 'text-emerald-400'}">
                    ${inq.status === 'waiting' ? SF.esc(inq.urgency) : 'Отвечено ✅'}
                  </div>
                </div>
              </div>
  
              <!-- Bot State Toggle -->
              <div class="flex items-center justify-between mb-2 p-2 rounded-xl border ${(inq.botState || 'paused') === 'standby' ? 'bg-[var(--si-bubble)] border-[var(--si-bubble-line)]' : 'bg-[var(--human-bubble)] border-[var(--human-bubble-line)]'}">
                <div class="flex items-center gap-1.5 text-[11px] font-semibold ${(inq.botState || 'paused') === 'standby' ? 'text-si' : 'text-brand'}">
                  ${(inq.botState || 'paused') === 'standby' ? '<span class="si-dot"></span>' : '<span>👤</span>'}
                  <span>${(inq.botState || 'paused') === 'standby' ? 'SI на Standby — ждёт сигнала' : 'SI на паузе — вы ведёте диалог'}</span>
                </div>
                <button onclick="window.toggleBotState('${SF.js(inq.id)}')" class="px-2 py-1 rounded-lg text-[10px] font-bold btn-3d-dark">
                  ${(inq.botState || 'paused') === 'standby' ? 'Приостановить SI' : 'Включить SI'}
                </button>
              </div>
  
              <!-- Tags -->
              <div class="mb-2">
                <div class="flex items-center flex-wrap gap-1">
                  ${(inq.tags || []).map(tag => `
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/20 border border-violet-500/30 text-[10px] text-violet-300 font-semibold">
                      ${SF.esc(tag)}
                      <button onclick="window.removeLeadTag('${SF.js(inq.id)}', '${SF.js(tag)}')" class="text-violet-400 hover:text-ink leading-none">&times;</button>
                    </span>
                  `).join('')}
                  <select onchange="window.addLeadTag('${SF.js(inq.id)}', this.value); this.value=''" class="text-[10px] px-2 py-0.5 rounded-full bg-sunken border border-dashed border-line-2 text-muted cursor-pointer">
                    <option value="">＋ Тег</option>
                    ${allTags.map(t => `<option value="${SF.esc(t)}">${SF.esc(t)}</option>`).join('')}
                  </select>
                </div>
              </div>
  
              <!-- Summary / Query -->
              <p class="text-xs text-ink-2 mb-2 leading-relaxed">${SF.esc(inq.summary)}</p>
  
              <!-- Audio Voice Message with Whisper AI Transcript if present -->
              ${inq.hasAudio ? `
                <div class="audio-voice-box mb-2">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <button onclick="window.toggleVoicePlay('${SF.js(inq.id)}')" class="w-7 h-7 rounded-full bg-[#81D8D0] text-[#090e17] flex items-center justify-center font-bold text-xs shadow">
                        <i data-lucide="play" class="w-3.5 h-3.5"></i>
                      </button>
                      <span class="text-[11px] font-semibold text-ink">Голосовое от клиента</span>
                    </div>
                    <span class="text-[10px] text-brand font-mono">${SF.esc(inq.audioDuration)}</span>
                  </div>
                  
                  <!-- Audio Waveform visualizer -->
                  <div class="audio-waveform px-1" id="waveform-${SF.esc(inq.id)}">
                    <span class="waveform-bar h-2"></span>
                    <span class="waveform-bar h-4"></span>
                    <span class="waveform-bar h-5"></span>
                    <span class="waveform-bar h-3"></span>
                    <span class="waveform-bar h-6"></span>
                    <span class="waveform-bar h-4"></span>
                    <span class="waveform-bar h-2"></span>
                    <span class="waveform-bar h-5"></span>
                    <span class="waveform-bar h-3"></span>
                  </div>
  
                  <!-- Whisper AI Transcription -->
                  <div class="text-[11px] text-brand bg-sunken p-2 rounded-xl border border-[#81D8D0]/20 flex items-start gap-1.5">
                    <i data-lucide="sparkles" class="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5"></i>
                    <div>
                      <div class="text-[9px] uppercase font-bold text-muted">SI-расшифровка:</div>
                      <div class="italic text-ink-2">${SF.esc(inq.audioTranscription)}</div>
                    </div>
                  </div>
                </div>
              ` : `
                <div class="text-[11px] text-ink-2 bg-sunken p-2 rounded-xl border border-line mb-2">
                  💬 <strong>Сообщение:</strong> ${SF.esc(inq.lastDirectMessage)}
                </div>
              `}
  
              <!-- Action buttons -->
              <div class="flex items-center gap-2 pt-1 border-t border-line">
                <button onclick="window.replyDirectInquiry('${SF.js(inq.id)}', '${SF.js(inq.leadName)}')" class="flex-1 py-2 rounded-xl btn-3d-tiffany text-xs flex items-center justify-center gap-1.5 shadow">
                  <i data-lucide="send" class="w-3.5 h-3.5"></i>
                  <span>Ответить лично</span>
                </button>
                <button onclick="window.openLeadTelegram('${SF.js(inq.leadUsername)}')" class="px-3 py-2 rounded-xl btn-3d-dark text-xs flex items-center gap-1">
                  <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
                  <span>В Telegram</span>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
  

  function renderExpertAnalyticsWindow(state) {
    const an = state.expert.analytics;
  
    return `
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
            <i data-lucide="pie-chart" class="w-4 h-4 text-brand"></i>
            Главная аналитика & Конверсии
          </span>
          <span class="text-[10px] text-muted">${an.period}</span>
        </div>
  
        <div class="grid grid-cols-2 gap-2">
          <div class="glass-card-3d p-3 border-[#81D8D0]/40">
            <div class="text-[10px] text-muted">Выручка через SI-консультанта</div>
            <div class="text-base font-extrabold text-brand">${an.revenue}</div>
            <div class="text-[9px] text-muted mt-0.5">Средний чек: ${an.avgCheck}</div>
          </div>
  
          <div class="glass-card-3d p-3 border-rose-500/40">
            <div class="text-[10px] text-muted">Конверсия в оплату / созвон</div>
            <div class="text-base font-extrabold text-rose-400">${an.overallConversion}</div>
            <div class="text-[9px] text-muted mt-0.5">Сделок: ${an.dealsClosed} шт.</div>
          </div>
        </div>
  
        <div class="grid grid-cols-3 gap-2 text-center">
          <div class="p-2 rounded-xl bg-sunken border border-line">
            <div class="text-[10px] text-muted">Трафик / Гости</div>
            <div class="text-xs font-bold text-ink">${an.trafficVisitors} чел.</div>
          </div>
          <div class="p-2 rounded-xl bg-sunken border border-line">
            <div class="text-[10px] text-muted">Квалифицированы</div>
            <div class="text-xs font-bold text-brand">${an.qualifiedLeads} чел.</div>
          </div>
          <div class="p-2 rounded-xl bg-sunken border border-line">
            <div class="text-[10px] text-muted">Сэкономлено часов</div>
            <div class="text-xs font-bold text-amber-400">${an.aiSellerSavedHours} ч.</div>
          </div>
        </div>
  
        <!-- Funnel Progress Stages -->
        <div class="glass-card-3d p-3 space-y-2">
          <div class="text-[11px] font-bold text-ink-2">Доходимость по шагам воронки:</div>
          <div class="space-y-1.5">
            ${an.steps.map((st, i) => `
              <div>
                <div class="flex justify-between text-xs mb-1">
                  <span class="text-ink-2 font-medium">${i + 1}. ${st.title}</span>
                  <span class="text-brand font-bold">${st.count} (${st.percent})</span>
                </div>
                <div class="w-full bg-sunken rounded-full h-2 overflow-hidden border border-line">
                  <div class="bg-gradient-to-r from-[#0d9488] to-[#81D8D0] h-2 rounded-full" style="width: ${st.percent}"></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }
  

  function renderExpertRecommendationsWindow(state) {
    const recs = state.expert.aiMarketerRecommendations;
  
    return `
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
            <span class="si-dot"></span>
            Рекомендации SI-маркетолога
          </span>
          <span class="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold">
            На основе отчетов
          </span>
        </div>
  
        <div class="space-y-2.5">
          ${recs.map(rec => `
            <div class="p-3.5 rounded-2xl glass-card-3d ${rec.applied ? 'border-emerald-500/30' : 'border-line'}">
              <div class="flex items-start justify-between gap-2 mb-1.5">
                <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-[#81D8D0]/20 text-brand border border-[#81D8D0]/30">
                  ${rec.tag} • ${rec.impact}
                </span>
                ${rec.applied ? `
                  <span class="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                    <i data-lucide="check-circle" class="w-3.5 h-3.5"></i> Внедрено
                  </span>
                ` : ''}
              </div>
  
              <h3 class="text-xs font-bold text-ink mb-1">${rec.title}</h3>
              <p class="text-xs text-ink-2 leading-relaxed mb-3">${rec.reason}</p>
  
              ${!rec.applied ? `
                <button onclick="window.applyExpertRecommendation('${rec.id}')" class="w-full py-2 rounded-xl btn-3d-tiffany text-xs font-bold flex items-center justify-center gap-1.5 shadow-md">
                  <i data-lucide="zap" class="w-3.5 h-3.5"></i>
                  <span>Применить в аргументы SI-консультанта</span>
                </button>
              ` : `
                <div class="text-[11px] text-emerald-400 bg-emerald-950/40 p-2 rounded-xl border border-emerald-800/40 flex items-center gap-1.5">
                  <i data-lucide="check" class="w-3.5 h-3.5"></i>
                  <span>Инструкции SI-консультанта обновлены. Аргумент активен в чатах!</span>
                </div>
              `}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
  

  function renderExpertPmfWindow(state) {
    const pmf = state.expert.pmfInterview;
    const customButtons = state.expert.customButtons;
  
    return `
      <div class="space-y-3">
        <!-- PMF Score Header -->
        <div class="glass-card-3d p-4 border-[#81D8D0]/40">
          <div class="flex items-center justify-between mb-2">
            <div>
              <div class="text-[10px] text-brand uppercase tracking-wider font-extrabold">Распаковка · Product-Market Fit</div>
              <div class="text-lg font-extrabold text-ink flex items-center gap-2">
                <span>${pmf.pmfScore}%</span>
                <span class="text-xs font-bold text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30">PMF Достигнут</span>
              </div>
            </div>
            <div class="w-12 h-12 rounded-2xl bg-[#81D8D0]/20 border border-[#81D8D0]/40 flex items-center justify-center text-brand font-bold text-lg shadow">
              ⚡
            </div>
          </div>
          <p class="text-xs text-ink-2 leading-relaxed">
            SI-маркетолог задал вопросы эксперту, упаковал ценность, гарантии и кейсы, чтобы SI-консультант закрывал любые возражения лида.
          </p>
        </div>
  
        <!-- Question & Answer list -->
        <div class="glass-card-3d p-3 space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-ink uppercase tracking-wider">Распакованные материалы</span>
            <span class="text-[10px] text-muted">Обновлено: ${pmf.lastUpdated}</span>
          </div>
  
          <div class="space-y-2.5">
            ${pmf.questionsAndAnswers.map(qa => `
              <div class="p-3 rounded-xl bg-sunken border border-line space-y-1.5">
                <div class="flex items-center justify-between">
                  <span class="text-[10px] font-bold text-brand uppercase">${qa.category}</span>
                  <button onclick="window.editPmfAnswer('${SF.js(qa.id)}')" class="text-[10px] text-sky-400 hover:text-sky-300 flex items-center gap-1">
                    <i data-lucide="edit-3" class="w-3 h-3"></i> Изменить
                  </button>
                </div>
                <div class="text-xs font-bold text-ink">${qa.question}</div>
                <div class="text-xs text-ink-2 bg-raised p-2.5 rounded-lg border border-line leading-relaxed">
                  ${SF.esc(qa.answer)}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
  
        <!-- Payment Link Settings -->
        <div class="glass-card-3d p-3 space-y-2 border-[#81D8D0]/30">
          <div class="flex items-center gap-2 mb-1">
            <i data-lucide="credit-card" class="w-4 h-4 text-brand"></i>
            <span class="text-xs font-bold text-ink uppercase tracking-wider">Оплата от клиентов</span>
          </div>
          <div class="space-y-1.5">
            <label class="text-[10px] text-muted block">Ваша ссылка на оплату (Prodamus, ЮKassa, Tribute и др.):</label>
            <div class="flex gap-2">
              <input type="text" id="expert-payment-link-input" value="${SF.esc(state.expert.expertPaymentLink || '')}" placeholder="https://pay.prodamus.ru/elena_coaching" class="flex-1 text-xs p-2 rounded-lg bg-sunken border border-line-2 text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]" />
              <button onclick="window.saveExpertPaymentLink()" class="px-2.5 py-1.5 rounded-lg btn-3d-tiffany text-[10px] font-bold whitespace-nowrap">Сохранить</button>
            </div>
            <div class="text-[10px] text-muted bg-sunken p-2 rounded-lg border border-line space-y-0.5">
              <div class="flex items-center gap-1 text-emerald-400 font-semibold"><span>✅</span> Лид оплачивает напрямую вам</div>
              <div class="flex items-center gap-1 text-muted"><span>👁️</span> Автор купленного SI видит только факт оплаты — без суммы и данных клиента</div>
            </div>
          </div>
        </div>
  
        <!-- Custom Buttons Configuration -->
        <div class="glass-card-3d p-3 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-ink uppercase tracking-wider">Кнопки действий для клиентов</span>
            <span class="text-[10px] text-muted">Отображаются у лида</span>
          </div>
          <div class="space-y-1.5">
            ${customButtons.map(btn => `
              <div class="flex items-center justify-between p-2 rounded-xl bg-sunken border border-line text-xs">
                <span class="text-ink-2 font-medium">${btn.label}</span>
                <span class="text-[10px] font-mono text-brand px-2 py-0.5 bg-raised rounded">${btn.action}</span>
              </div>
            `).join('')}
          </div>
        </div>
  
      </div>
    `;
  }
  

  function renderExpertBroadcastWindow(state) {
    const bc = state.expert.aiBroadcast || {};
    const history = bc.history || [];
  
    return `
      <div class="space-y-3">
        <!-- Header -->
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
            <i data-lucide="send-horizontal" class="w-4 h-4 text-violet-400"></i>
            SI-рассылки по базе лидов
          </span>
          <span class="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30 font-semibold">
            SI-копирайтер
          </span>
        </div>
  
        <!-- Broadcast Composer -->
        <div class="glass-card-3d p-3.5 space-y-3">
          <div class="text-[11px] text-ink-2 leading-relaxed">
            <span class="text-violet-400 font-bold">Скажите своими словами</span> кого и куда пригласить — SI подберёт сегмент, напишет сообщение и уточнит детали если нужно.
          </div>
  
          <!-- Prompt Input -->
          <div class="space-y-2">
            <textarea id="broadcast-prompt-input" rows="3" placeholder='Например: "Пригласи на мастер-класс в 16:00 в кофейне Раф всех тех кто не купил мини-курс «дыхание маткой»"' class="w-full text-xs p-2.5 rounded-xl bg-sunken border border-line-2 text-ink placeholder-faint focus:outline-none focus:border-violet-500 resize-none leading-relaxed">${SF.esc(bc.prompt || '')}</textarea>
            <button onclick="window.generateAiBroadcast()" class="w-full py-2.5 rounded-xl btn-3d-tiffany text-xs font-bold flex items-center justify-center gap-2 shadow-lg">
              <i data-lucide="sparkles" class="w-4 h-4"></i>
              <span>Анализировать и составить рассылку</span>
            </button>
          </div>
  
          <!-- Clarification Step -->
          ${bc.clarificationStep ? `
            <div class="p-3 rounded-xl bg-violet-900/20 border border-violet-500/30 space-y-2">
              <div class="flex items-start gap-2">
                <img src="images/mascots/si-consultant.webp" alt="" class="mascot-avatar" />
                <div class="text-xs text-violet-200 leading-relaxed">${bc.clarificationQuestion}</div>
              </div>
              <div class="flex gap-2">
                <input type="text" id="broadcast-clarify-input" placeholder="Напр: В эту субботу, вход бесплатный по брони..." class="flex-1 text-xs p-2 rounded-lg bg-sunken border border-violet-600/40 text-ink placeholder-faint focus:outline-none focus:border-violet-400" />
                <button onclick="window.confirmBroadcastDetails()" class="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-bold whitespace-nowrap">Подтвердить</button>
              </div>
            </div>
          ` : ''}
  
          <!-- Ready Post Preview -->
          ${bc.readyPost ? `
            <div class="space-y-2">
              <div class="text-[11px] font-bold text-ink flex items-center gap-1.5">
                <i data-lucide="check-circle" class="w-3.5 h-3.5 text-emerald-400"></i>
                Рассылка готова к отправке:
              </div>
              <div class="p-3 rounded-xl bg-sunken border border-emerald-500/30 space-y-2">
                <div class="text-[10px] font-bold text-emerald-400 flex items-center gap-1.5">
                  <span>🎯 Сегмент: <span class="text-violet-300">${bc.readyPost.segment}</span></span>
                  <span class="text-faint">•</span>
                  <span>${bc.readyPost.count} лидов</span>
                </div>
                <div class="text-xs text-ink-2 leading-relaxed bg-sunken p-2.5 rounded-lg border border-line">${SF.esc(bc.readyPost.text)}</div>
                <div class="p-2 rounded-lg bg-[#81D8D0]/10 border border-[#81D8D0]/20 text-center">
                  <span class="text-[10px] font-bold text-brand">${bc.readyPost.buttonLabel}</span>
                </div>
              </div>
              <button onclick="window.sendBroadcastNow()" class="w-full py-2.5 rounded-xl btn-3d-tiffany text-xs font-bold flex items-center justify-center gap-2 shadow-lg">
                <i data-lucide="send" class="w-4 h-4"></i>
                <span>✉️ Отправить ${bc.readyPost.count} лидам</span>
              </button>
            </div>
          ` : ''}
        </div>
  
        <!-- Broadcast History -->
        <div class="glass-card-3d p-3 space-y-2">
          <span class="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
            <i data-lucide="history" class="w-4 h-4 text-muted"></i>
            История рассылок
          </span>
          ${history.length === 0 ? `
            <div class="text-center py-4 text-faint text-xs">Рассылок пока нет. Отправьте первую выше! 🚀</div>
          ` : `
            <div class="space-y-2">
              ${history.map(item => `
                <div class="p-2.5 rounded-xl bg-sunken border border-line space-y-1.5">
                  <div class="flex items-center justify-between">
                    <span class="text-xs font-bold text-ink">${item.title}</span>
                    <span class="text-[9px] text-faint">${item.date}</span>
                  </div>
                  <div class="flex items-center gap-3 text-[10px]">
                    <span class="text-violet-300">${item.targetTag}</span>
                    <span class="text-muted">${item.sentCount} отправлено</span>
                    <span class="text-emerald-400">Open rate: ${item.openRate}</span>
                  </div>
                  <div class="text-[10px] font-bold text-emerald-400">${item.status}</div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    `;
  }
  

  // Handlers used by inline onclick="window.xxx(...)" in the parts above
  window.closeModal = SF.closeModal;
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
      <div class="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4" onclick="window.closeModal()">
        <div class="glass-card-3d max-w-xs w-full p-6 text-center space-y-4 border-[#81D8D0]/40" onclick="event.stopPropagation()">
          <h3 class="text-sm font-bold text-ink">QR-код SI-консультанта</h3>
          <div class="bg-white p-4 rounded-2xl mx-auto w-48 h-48 flex items-center justify-center shadow-lg">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(link)}" alt="QR Code" class="w-full h-full" />
          </div>
          <p class="text-xs text-ink-2">Распространяйте в Telegram-канале, Instagram Stories и рекламе</p>
          <button onclick="window.closeModal()" class="w-full py-2 rounded-xl btn-3d-dark text-xs font-semibold">Закрыть</button>
        </div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  };

  window.replyDirectInquiry = (inquiryId, leadName) => {
    const reply = prompt(`Введите ответ для ${leadName}:`, 'Здравствуйте! С удовольствием отвечу на ваши вопросы лично. Когда вам удобно созвониться на 15 минут?');
    if (reply) {
      window.funnelStore.resolveDirectInquiry(inquiryId, reply);
      showToast(`Ответ отправлен ${leadName} от имени эксперта!`);
    }
  };

  window.openLeadTelegram = (username) => {
    showToast(`Открываем Telegram профиль ${username}...`);
    window.open(`https://t.me/${username.replace('@', '')}`, '_blank');
  };
  window.toggleVoicePlay = (id) => {
    const waveform = document.getElementById('waveform-' + id);
    if (!waveform) return;

    if (activeVoicePlaybackId === id) {
      waveform.classList.remove('waveform-playing');
      activeVoicePlaybackId = null;
    } else {
      document.querySelectorAll('.waveform-playing').forEach(el => el.classList.remove('waveform-playing'));
      waveform.classList.add('waveform-playing');
      activeVoicePlaybackId = id;
      setTimeout(() => {
        waveform.classList.remove('waveform-playing');
        activeVoicePlaybackId = null;
      }, 4000);
    }
  };

  window.handleExpertTakeover = (e, chatId) => {
    e.preventDefault();
    const input = document.getElementById('expert-takeover-input');
    if (!input || !input.value.trim()) return;
    const val = input.value.trim();
    window.funnelStore.sendExpertMessageToLead(chatId, val);
    input.value = '';
    showToast('Сообщение отправлено лиду лично от эксперта 👤');
    scrollToBottom('expert-chat-scroll');
  };

  window.applyExpertRecommendation = (recId) => {
    window.funnelStore.applyExpertRecommendation(recId);
    showToast('Рекомендация внедрена в базу знаний SI-консультанта 🚀');
    if (window.confetti) {
      window.confetti({ particleCount: 70, spread: 60 });
    }
  };

  window.toggleBotState = (inqId) => {
    const newState = window.funnelStore.toggleInquiryBotState(inqId);
    if (newState === 'standby') {
      showToast('SI включён: режим Standby — ждёт сигнала рассылки');
    } else {
      showToast('SI на паузе — вы ведёте диалог лично');
    }
  };

  window.addLeadTag = (inqId, tag) => {
    if (!tag) return;
    window.funnelStore.addTagToInquiry(inqId, tag);
    showToast(`Тег ${tag} добавлен лиду`);
  };

  window.removeLeadTag = (inqId, tag) => {
    window.funnelStore.removeTagFromInquiry(inqId, tag);
    showToast(`Тег ${tag} удалён`);
  };

  window.generateAiBroadcast = () => {
    const textarea = document.getElementById('broadcast-prompt-input');
    const text = textarea ? textarea.value.trim() : '';
    if (!text) {
      showToast('Опишите кого и куда пригласить 👆');
      return;
    }
    window.funnelStore.generateAiBroadcast(text);
    showToast('SI анализирует вашу базу лидов... 🧠');
  };

  window.confirmBroadcastDetails = () => {
    const input = document.getElementById('broadcast-clarify-input');
    const text = input ? input.value.trim() : '';
    if (!text) {
      showToast('Уточните детали для SI 👆');
      return;
    }
    window.funnelStore.confirmBroadcastDetails(text);
    showToast('Детали приняты — рассылка сформирована ✅');
  };

  window.sendBroadcastNow = () => {
    const camp = window.funnelStore.sendBroadcastNow();
    if (camp) {
      showToast(`Рассылка отправлена ${camp.sentCount} лидам! 🚀`);
      if (window.confetti) {
        window.confetti({ particleCount: 80, spread: 70 });
      }
    }
  };

  window.saveExpertPaymentLink = () => {
    const input = document.getElementById('expert-payment-link-input');
    const val = input ? input.value.trim() : '';
    if (val) {
      window.funnelStore.data.expert.expertPaymentLink = val;
      window.funnelStore.saveData();
      showToast('Ссылка оплаты сохранена! Клиенты будут переходить по ней 💳');
    } else {
      showToast('Введите ссылку на оплату');
    }
  };

  window.editPmfAnswer = (qaId) => {
    const state = window.funnelStore.data;
    const qa = state.expert.pmfInterview.questionsAndAnswers.find(q => q.id === qaId);
    if (!qa) return;
    const newAnswer = prompt(qa.question, qa.answer);
    if (newAnswer !== null && newAnswer.trim()) {
      window.funnelStore.updatePmfAnswer(qaId, newAnswer.trim());
      showToast('Ответ обновлён в базе знаний SI-консультанта ✅');
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
      if (!state.me.business.active) return renderTerms();
      if (route.screen === 'office-create') return renderCreate();
      if (route.screen === 'office-consultant') return renderConsultant(route, state);
      if (route.screen === 'office-client') {
        scrollToBottom('expert-chat-scroll');
        return renderClient(route, state);
      }
      return renderOffice(route, state);
    }
  };
})(window);
