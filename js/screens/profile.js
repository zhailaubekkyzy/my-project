// screens/profile.js - Personal profile and the expert's profile-landing.
// Shows the trust percent and what raises it. Photo and texts are saved on the server
// (PUT /api/me/profile, POST /api/me/photo); offline they stay on this device.

(function (window) {
  const SF = window.SF;
  const showToast = SF.showToast;

  function store() {
    return window.funnelStore;
  }

  function api() {
    return window.smartFlowApi;
  }

  function block(title, text) {
    if (!text) return '';
    return `
      <div class="glass-card-3d p-3.5 space-y-1">
        <div class="text-[11px] font-bold uppercase tracking-wider text-brand">${title}</div>
        <div class="text-xs text-ink-2 leading-relaxed whitespace-pre-line">${SF.esc(text)}</div>
      </div>`;
  }

  // ---------------- Settings (owner's decision 23 Nov.: «Профиль» became «Настройки») ----------------
  // One short list: me (→ my profile) · personal / business mode · my businesses (each opens its Office here) ·
  // notifications · language · invite · support panel · clear the phone · my support number.
  function row({ icon, label, right = '', onclick = '', tone = 'text-ink', info = '' }) {
    // A div with role="button": an «i» inside must not be a button inside a button
    return `
      <div ${onclick ? `role="button" tabindex="0" onclick="${onclick}"` : ''} class="w-full px-3.5 py-3 flex items-center gap-3 text-left text-sm ${onclick ? 'cursor-pointer' : ''}">
        ${icon ? `<i data-lucide="${icon}" class="w-5 h-5 text-brand flex-shrink-0"></i>` : ''}
        <span class="flex-1 min-w-0 font-semibold ${tone} flex items-center gap-1">${label}${info ? SF.info(info) : ''}</span>
        ${right}${onclick && !right ? '<i data-lucide="chevron-right" class="w-4 h-4 text-faint"></i>' : ''}
      </div>`;
  }
  const group = (rows) => `<div class="glass-card-3d divide-y divide-line overflow-hidden">${rows.filter(Boolean).join('')}</div>`;

  const BUSINESS_INFO = 'Бизнес-профиль бесплатный. В нём — Офис: ваши бизнесы (до 3), SI-продавцы, шаблоны и сообщества. Переключение на «Личный» только прячет Офис: SI-продавцы продолжают работать.';

  function renderSettings(state) {
    const s = store();
    const me = state.me;
    const businessOn = s.isBusinessActive() || s.isAssistant();
    const business = s.isBusinessView();
    const mode = businessOn ? row({
      icon: 'briefcase', label: 'Режим', info: BUSINESS_INFO,
      right: `<span class="flex gap-1 p-0.5 rounded-lg bg-sunken text-xs">
        <button onclick="SF.actions.setPersonalMode(true)" class="px-2.5 py-1 rounded-md font-semibold ${business ? 'text-muted' : 'bg-card text-ink shadow'}">Личный</button>
        <button onclick="SF.actions.setPersonalMode(false)" class="px-2.5 py-1 rounded-md font-semibold ${business ? 'bg-card text-ink shadow' : 'text-muted'}">Бизнес</button>
      </span>`
    }) : row({ icon: 'briefcase', label: 'Включить бизнес-профиль', info: BUSINESS_INFO, onclick: "SF.push('office')" });
    return `
      <button onclick="SF.push('me')" class="w-full glass-card-3d p-3.5 flex items-center gap-3 text-left">
        ${SF.avatar(me.photoUrl, { size: 52, kind: 'human' })}
        <span class="flex-1 min-w-0">
          <span class="flex items-center gap-1 text-base font-extrabold text-ink truncate">${SF.esc(me.displayName || 'Мой профиль')}${SF.partnerBadge(me.id, 16)}</span>
          <span class="block text-xs text-brand font-semibold">Мой профиль</span>
        </span>
        <i data-lucide="chevron-right" class="w-4 h-4 text-faint"></i>
      </button>
      ${group([mode])}
      ${business ? renderMyBusinesses(state) : ''}
      ${group([
        SF.botCanWrite() !== null ? row({ icon: 'bell', label: 'Уведомления в Telegram', right: SF.botCanWrite()
          ? '<span class="text-xs text-brand font-semibold">Включены ✓</span>'
          : '<button onclick="SF.actions.enableNotifications()" class="px-3 py-1.5 rounded-xl btn-3d-tiffany text-xs">Включить</button>' }) : '',
        row({ icon: 'languages', label: 'Язык', right: `<span class="flex gap-1" data-no-tr>${[['ru', 'RU'], ['en', 'EN']].map(([code, label]) => `
          <button onclick="SF.actions.setLanguage('${code}')" class="px-2.5 py-1 rounded-lg border text-[11px] font-semibold ${SF.lang() === code ? 'bg-[#81D8D0] text-[#08302c] border-[#81D8D0]' : 'bg-sunken text-muted border-line'}">${label}</button>`).join('')}</span>` })
      ])}
      ${group([
        SF.data.signedIn() ? row({ icon: 'gift', label: 'Пригласить друзей', onclick: "SF.push('invite')" }) : '',
        row({ icon: 'life-buoy', label: 'Поддержка', onclick: 'SF.actions.openSupport()' }),
        me.staffRole ? row({ icon: 'shield', label: 'Панель поддержки', onclick: "SF.push('admin')" }) : ''
      ])}
      ${SF.inTelegram && !SF.inTelegram() ? group([
        SF.canInstall() ? row({ icon: 'smartphone', label: 'Установить на экран', onclick: 'SF.actions.installApp()' }) : '',
        row({ icon: 'log-out', label: 'Выйти', tone: 'text-si', onclick: 'SF.actions.logout()' })
      ]) : ''}
      <button onclick="SF.actions.resetDemo()" class="w-full py-2 text-[11px] text-faint hover:text-rose-400">Очистить данные на этом устройстве</button>
      ${me.supportCode ? `
        <button onclick="SF.copyText('${SF.js(me.supportCode)}', 'Номер скопирован')" class="w-full text-center text-[10px] text-faint">
          Ваш номер для поддержки: <span class="font-semibold text-muted">${SF.esc(me.supportCode)}</span>
        </button>` : ''}`;
  }

  // «Мои бизнесы» (owner's decisions 22–23 Nov.): up to 3; a business opens its Office right here, in Settings
  let businessForm = null; // { id?: string } — the open form (new business or renaming one)
  function renderMyBusinesses(state) {
    const s = store();
    if (!s.isBusinessActive()) {
      // An assistant in someone else's business without one's own: just the way into the Office
      return group([row({ icon: 'briefcase', label: 'Офис', onclick: "SF.push('office')" })]);
    }
    const data = state.remote.businesses;
    if (!data) return '<div class="text-[11px] text-muted px-1">Загружаю бизнесы…</div>';
    const list = data.businesses || [];
    const field = 'w-full bg-card border border-line-2 rounded-xl px-3 py-2 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]';
    const editing = businessForm && businessForm.id ? list.find(b => b.id === businessForm.id) : null;
    const form = businessForm ? `
      <form onsubmit="SF.actions.saveBusiness(event)" class="p-3 space-y-1.5">
        <input name="name" required maxlength="80" value="${SF.esc(editing ? editing.name : '')}" placeholder="Название бизнеса, например «Йога-студия»" class="${field}" />
        <input name="niche" maxlength="120" value="${SF.esc(editing ? editing.niche : '')}" placeholder="Ниша (необязательно)" class="${field}" />
        <textarea name="about" rows="2" maxlength="2000" placeholder="О бизнесе: что делаете и для кого (SI будет знать)" class="${field}">${SF.esc(editing ? editing.about : '')}</textarea>
        <div class="grid grid-cols-2 gap-1.5">
          <button type="button" onclick="SF.actions.closeBusinessForm()" class="py-2 rounded-xl bg-card border border-line text-xs text-ink-2">Отмена</button>
          <button type="submit" class="py-2 rounded-xl btn-3d-tiffany text-xs">${editing ? 'Сохранить' : 'Открыть бизнес'}</button>
        </div>
      </form>` : '';
    return `
      <div class="space-y-1.5">
        <div class="flex items-center justify-between px-1 text-[11px] font-bold text-muted uppercase tracking-wider"><span>Мои бизнесы</span><span class="normal-case font-normal">${list.length} из ${data.max || 3}</span></div>
        <div class="glass-card-3d divide-y divide-line overflow-hidden">
          ${list.map(b => `
            <div class="flex items-center">
              <button onclick="SF.actions.openBusiness('${SF.js(b.id)}')" class="flex-1 min-w-0 px-3.5 py-3 flex items-center gap-3 text-left">
                <i data-lucide="building-2" class="w-5 h-5 text-brand flex-shrink-0"></i>
                <span class="flex-1 min-w-0 text-sm font-semibold text-ink truncate">${SF.esc(b.name || 'Мой бизнес')}</span>
                <i data-lucide="chevron-right" class="w-4 h-4 text-faint"></i>
              </button>
              <button onclick="SF.actions.editBusiness('${SF.js(b.id)}')" class="px-3 py-3 text-faint" aria-label="Изменить"><i data-lucide="pencil" class="w-4 h-4"></i></button>
            </div>`).join('')}
          ${form}
          ${!businessForm && list.length < (data.max || 3) ? `<button onclick="SF.actions.newBusiness()" class="w-full px-3.5 py-3 flex items-center gap-3 text-sm text-ink-2"><i data-lucide="plus" class="w-5 h-5 text-brand"></i>${list.length ? 'Открыть ещё бизнес' : 'Открыть бизнес'}</button>` : ''}
        </div>
      </div>`;
  }

  SF.actions.newBusiness = () => { businessForm = {}; store().notify(); };
  SF.actions.editBusiness = (id) => { businessForm = { id }; store().notify(); };
  SF.actions.closeBusinessForm = () => { businessForm = null; store().notify(); };

  // A business opens its Office right here, in Settings
  SF.actions.openBusiness = (id) => {
    store().setCurrentBusiness(id);
    SF.data.invalidate('business:');
    SF.openIn('profile', 'office', { section: 'consultants' });
  };

  SF.actions.saveBusiness = async (e) => {
    e.preventDefault();
    const f = e.target;
    const data = { name: f.name.value.trim(), niche: f.niche.value.trim(), about: f.about.value.trim() };
    try {
      const res = businessForm && businessForm.id
        ? await api().updateBusiness(businessForm.id, data)
        : await api().createBusiness(data);
      const created = !(businessForm && businessForm.id);
      businessForm = null;
      SF.data.invalidate('businesses');
      await SF.data.businesses(0);
      if (created && res.business) store().setCurrentBusiness(res.business.id);
      showToast(created ? 'Бизнес открыт' : 'Сохранено');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не получилось', err));
    }
  };

  SF.actions.setPersonalMode = async (personal) => {
    const s = store();
    if (Boolean(s.data.me.profile.personalMode) === personal) return;
    const before = s.data.me.profile.personalMode;
    s.updateProfile({ personalMode: personal });
    s.notify();
    try {
      if (api() && api().isSignedIn()) {
        const res = await api().updateMyProfile({ ...s.data.me.profile, personalMode: personal });
        if (res.user) s.applyServerUser(res.user);
        s.saveData();
      }
      showToast(personal ? 'Личный профиль' : 'Бизнес-профиль');
    } catch (err) {
      s.updateProfile({ personalMode: before });
      s.notify();
      showToast(SF.withErrorCode('Не удалось переключить профиль. Попробуйте ещё раз', err));
    }
  };

  // ---------------- «Мой профиль»: the landing as visitors see it ----------------
  function renderView(state) {
    const me = state.me;
    const p = me.profile;
    const trust = SF.trustScore(me);
    const consultants = state.office.consultants.filter(c => c.isListed);
    const offer = p.offerButton;

    return `
      <div class="glass-card-3d p-4 text-center space-y-2">
        <button onclick="SF.actions.changeMyPhoto()" class="relative inline-block" aria-label="Изменить фото">
          ${SF.avatar(me.photoUrl, { size: 96, kind: 'human' })}
          <span class="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-card border border-line-2 flex items-center justify-center text-ink-2 shadow">
            <i data-lucide="camera" class="w-4 h-4"></i>
          </span>
        </button>
        <div class="text-lg font-extrabold text-ink flex items-center justify-center gap-1.5">${SF.esc(me.displayName)}${SF.partnerBadge(me.id, 22)}</div>
        ${p.headline ? `<div class="text-xs text-brand font-semibold">${SF.esc(p.headline)}</div>` : ''}
        ${me.username ? `<div class="text-[11px] text-faint">@${SF.esc(me.username)}</div>` : ''}
        <div class="max-w-[220px] mx-auto pt-1">
          <div class="text-[11px] text-muted mb-1">Доверие ${trust.score}%</div>
          ${SF.progressBar(trust.score)}
        </div>
        ${offer ? `
          <button onclick="SF.actions.openOffer()" class="mt-2 w-full py-2.5 rounded-2xl btn-3d-tiffany text-sm">${SF.esc(offer.label)}</button>
        ` : ''}
      </div>

      ${trust.tips.length ? `
        <div class="p-3.5 rounded-2xl bg-[var(--human-bubble)] border border-[var(--human-bubble-line)] space-y-1.5">
          <div class="flex items-center gap-2 text-xs font-bold text-ink">
            <img src="${SF.MASCOTS.buddy}" alt="" class="w-7 h-7" /> Что поднимет доверие
          </div>
          ${trust.tips.slice(0, 3).map(t => `<div class="text-xs text-ink-2">• ${t}</div>`).join('')}
          <button onclick="SF.push('edit')" class="mt-1 px-3 py-1.5 rounded-xl btn-3d-tiffany text-xs">Заполнить профиль</button>
        </div>
      ` : ''}

      ${block('О себе', p.bio)}
      ${block('Регалии и сертификаты', p.regalia)}
      ${block('Результаты и кейсы', p.results)}

      ${(p.links || []).length ? `
        <div class="flex flex-wrap gap-2">
          ${p.links.map(l => `
            <button onclick="SF.openLink('${SF.js(l.url)}')" class="px-3 py-1.5 rounded-xl btn-3d-dark text-xs flex items-center gap-1.5">
              <i data-lucide="external-link" class="w-3.5 h-3.5"></i>${SF.esc(l.label || l.url.replace(/^https?:\/\//, ''))}
            </button>`).join('')}
        </div>` : ''}

      ${consultants.length ? `
        <div class="space-y-2">
          ${SF.sectionTitle('bot', 'Мои SI-продавцы')}
          ${consultants.map(c => `
            <div class="p-3 rounded-2xl bg-[var(--si-bubble)] border border-[var(--si-bubble-line)] flex items-center gap-2.5">
              ${SF.avatar(c.photoUrl, { size: 36, kind: 'si' })}
              <div class="min-w-0">
                <div class="text-xs font-bold text-ink truncate">${SF.esc(c.name)}</div>
                <div class="text-[10px]">${SF.siLabel(c.roleTitle)}</div>
              </div>
            </div>`).join('')}
        </div>` : ''}

      <button onclick="SF.push('edit')" class="w-full py-2.5 rounded-xl btn-3d-tiffany text-xs flex items-center justify-center gap-1.5"><i data-lucide="pencil" class="w-3.5 h-3.5"></i>Редактировать</button>

      ${me.id ? `
        <button onclick="SF.copyText(SF.appLink('P_${SF.js(me.id)}'), 'Ссылка на профиль скопирована')" class="w-full py-2.5 rounded-xl btn-3d-dark text-xs flex items-center justify-center gap-1.5">
          <i data-lucide="share-2" class="w-3.5 h-3.5"></i> Поделиться профилем
        </button>` : ''}

    `;
  }

  // Invitation to SmartFlow and the partner programme: people who come by my links are counted
  function renderInvite(state) {
    if (!SF.data.signedIn()) return '';
    const r = state.remote.referral;
    return `
      <div class="glass-card-3d p-3.5 space-y-2 text-xs">
        ${r && r.partner ? SF.partnerMedal(r.brought, { size: 72 }) : ''}
        <div class="font-bold text-ink flex items-center gap-1">Пригласить в SmartFlow${SF.info('Ваша личная ссылка. Кто впервые придёт в SmartFlow по ней или по ссылкам ваших SI-продавцов — засчитается вам. Отправьте в любое приложение: WhatsApp, Instagram, Telegram. Друг попадёт сразу к своему Бадди.')}</div>
        <div class="p-2.5 rounded-xl bg-sunken border border-line space-y-1">
          <div class="text-[11px] font-semibold text-ink-2">Что вы получаете</div>
          <div class="text-[11px] text-ink-2">• ${r ? r.partnerMin : 10} человек перешли по ссылке — вы получаете знак «SMARTFLOW PARTNER»: он виден рядом с вашим фото и именем везде в SmartFlow</div>
          <div class="text-[11px] text-ink-2">• Ваши SI-продавцы — в верхних строках Маркетплейса, а знак повышает доверие клиентов</div>
          <div class="text-[11px] text-ink-2">• +10 сообщений Бадди в день за каждого пришедшего</div>
        </div>
        ${r ? `
          <div class="space-y-1">
            <div class="text-[11px] font-semibold text-ink-2">Текст приглашения — можно изменить</div>
            <textarea id="invite-text" data-keep="invite-text" rows="9" maxlength="1000" data-no-tr
              class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink text-xs leading-relaxed resize-y">${SF.esc(r.inviteText || inviteText())}</textarea>
            <div class="flex items-center gap-3">
              <button onclick="SF.actions.saveInviteText()" class="px-3 py-1.5 rounded-lg btn-3d-tiffany text-[11px] font-bold">Сохранить текст</button>
              ${r.inviteText ? '<button onclick="SF.actions.resetInviteText()" class="text-[11px] text-muted underline">Вернуть исходный</button>' : ''}
            </div>
          </div>
          <div class="flex items-center gap-2 p-2 rounded-xl bg-sunken border border-line">
            <span class="text-[11px] font-mono text-brand truncate flex-1 min-w-0">${SF.esc(r.url)}</span>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <button onclick="SF.actions.shareInvite()" class="py-2.5 rounded-xl btn-3d-tiffany text-xs font-bold flex items-center justify-center gap-1.5"><i data-lucide="share-2" class="w-3.5 h-3.5"></i>Отправить</button>
            <button onclick="SF.actions.copyInvite()" class="py-2.5 rounded-xl bg-card border border-line text-ink text-xs font-bold flex items-center justify-center gap-1.5"><i data-lucide="copy" class="w-3.5 h-3.5"></i>Скопировать</button>
          </div>
          <div class="text-[11px] text-ink-2">Пришло по вашим ссылкам: <b>${r.brought}</b>${r.partner ? '' : ` · знак партнёра — с ${r.partnerMin}`}</div>
          ${r.brought ? `<div class="text-[11px] text-ink-2">Сообщений Бадди в день: <b>${30 + 10 * r.brought}</b></div>` : ''}` : '<div class="text-muted">Загружаю…</div>'}
      </div>`;
  }

  // The standard invitation text (owner's text; "ИИ" here on purpose — owner's decision 15 Oct., friends outside SmartFlow know this word). The person can change it.
  function inviteText() {
    return SF.lang() === 'en'
      ? 'Hi! I use SmartFlow — try it too 😉\n\nYou will have your own AI-Buddy: plan your day and get reminders; and AI-sellers: they will sell your online products for you.\n\nEverything is free for now and there is nothing to install — don\u2019t miss the best terms, only for beta members 🤩'
      : 'Привет! Я пользуюсь SmartFlow — попробуй и ты 😉\n\nУ тебя будет свой ИИ-Бадди: сможешь планировать день и получать напоминания; ИИ-продавцы: будут за тебя продавать твои онлайн-продукты.\n\nПока всё бесплатно и ничего не нужно устанавливать — советую не пропустить самые выгодные условия только для участников бета-версии 🤩';
  }
  // What goes out: the text in the field (even if not saved yet), then the link
  const inviteMessage = (r) => {
    const field = document.getElementById('invite-text');
    const text = (field && field.value.trim()) || r.inviteText || inviteText();
    return `${text}\n\n${r.url}`;
  };

  SF.actions.saveInviteText = async () => {
    const field = document.getElementById('invite-text');
    if (!field) return;
    // The standard text unchanged = nothing personal to keep
    const value = field.value.trim() === inviteText().trim() ? '' : field.value;
    try {
      const res = await window.smartFlowApi.setInviteText(value);
      const r = window.funnelStore.data.remote.referral;
      window.funnelStore.setRemote('referral', { ...r, inviteText: res.inviteText });
      SF.showToast('Текст приглашения сохранён');
    } catch (err) {
      SF.showToast(SF.withErrorCode(err.message || 'Не сохранилось', err));
    }
  };

  SF.actions.resetInviteText = async () => {
    const field = document.getElementById('invite-text');
    if (field) field.value = inviteText();
    await SF.actions.saveInviteText();
  };

  // "Отправить": the phone's own share sheet (WhatsApp, Instagram, Telegram, mail…); where there is none
  // (some Android Telegram versions) — the text is copied to paste anywhere
  SF.actions.shareInvite = async () => {
    const r = window.funnelStore.data.remote.referral;
    if (!r) return;
    const message = inviteMessage(r);
    if (navigator.share) {
      try {
        await navigator.share({ text: message });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return; // the person closed the sheet
      }
    }
    SF.copyText(message, 'Приглашение скопировано — вставьте его в любое приложение');
  };

  SF.actions.copyInvite = () => {
    const r = window.funnelStore.data.remote.referral;
    if (r) SF.copyText(inviteMessage(r), 'Приглашение со ссылкой скопировано');
  };

  // Russian / English for the client screens; the server keeps it for notifications too
  SF.actions.setLanguage = async (lang) => {
    if (lang === SF.lang()) return;
    SF.setLang(lang);
    window.funnelStore.notify();
    if (!SF.data.signedIn()) return;
    try {
      await window.smartFlowApi.setLanguage(lang);
    } catch (err) {
      SF.showToast(SF.withErrorCode(err.message || 'Не сохранилось', err));
    }
  };

  SF.actions.setSearchVisibility = async (visible) => {
    try {
      await window.smartFlowApi.setSearchVisibility(!visible);
      window.funnelStore.data.me.hiddenFromSearch = !visible;
      window.funnelStore.saveData();
      SF.showToast(visible ? 'Вас снова можно найти в поиске' : 'Вы скрыты из поиска');
    } catch (err) {
      SF.showToast(SF.withErrorCode(err.message || 'Не сохранилось', err));
    }
    window.funnelStore.notify();
  };

  // ---------------- Edit ----------------
  function renderEdit(state) {
    const me = state.me;
    const p = me.profile;
    const links = [...(p.links || [])];
    while (links.length < 3) links.push({ label: '', url: '' });
    const offer = p.offerButton || {};
    const consultants = state.office.consultants.filter(c => c.isListed);
    const field = (name, label, value, placeholder, rows = 0, max = 800) => `
      <label class="block space-y-1">
        <span class="font-semibold text-ink-2">${label}</span>
        ${rows
          ? `<textarea name="${name}" rows="${rows}" maxlength="${max}" placeholder="${placeholder}" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink">${SF.esc(value)}</textarea>`
          : `<input name="${name}" maxlength="${max}" value="${SF.esc(value)}" placeholder="${placeholder}" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink" />`}
      </label>`;

    return `
      <form onsubmit="SF.actions.saveProfile(event)" class="space-y-3 text-xs">
        <div class="glass-card-3d p-4 space-y-3">
          <div class="flex items-center gap-3">
            <button type="button" onclick="SF.actions.changeMyPhoto()" class="relative" aria-label="Изменить фото">
              ${SF.avatar(me.photoUrl, { size: 64, kind: 'human' })}
              <span class="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-card border border-line-2 flex items-center justify-center text-ink-2 shadow"><i data-lucide="camera" class="w-3.5 h-3.5"></i></span>
            </button>
          </div>
          ${field('displayName', 'Имя', p.displayName || me.displayName, 'Как вас называть', 0, 80)}
          ${field('headline', 'Чем вы занимаетесь (одна строка)', p.headline, 'Например: нутрициолог, 8 лет практики', 0, 120)}
        </div>

        <div class="glass-card-3d p-4 space-y-3">
          ${field('bio', 'О себе', p.bio, 'Коротко: кто вы, опыт, для кого работаете', 3)}
          ${field('regalia', 'Регалии и сертификаты', p.regalia, 'Образование, сертификаты, награды', 3)}
          ${field('results', 'Результаты и кейсы', p.results, 'Цифры и истории клиентов', 3)}
        </div>

        <div class="glass-card-3d p-4 space-y-2">
          <div class="font-semibold text-ink-2">Ссылки на соцсети</div>
          ${links.slice(0, 5).map((l, i) => `
            <div class="flex gap-2">
              <input name="linkLabel${i}" value="${SF.esc(l.label)}" maxlength="40" placeholder="Instagram" class="w-1/3 p-2.5 rounded-xl bg-sunken border border-line-2 text-ink" />
              <input name="linkUrl${i}" value="${SF.esc(l.url)}" maxlength="300" placeholder="https://..." inputmode="url" class="flex-1 p-2.5 rounded-xl bg-sunken border border-line-2 text-ink" />
            </div>`).join('')}
          <div class="text-[10px] text-faint">Только ссылки, начинающиеся с https://</div>
        </div>

        <div class="glass-card-3d p-4 space-y-2">
          <div class="font-semibold text-ink-2">Кнопка с оффером</div>
          <input name="offerLabel" value="${SF.esc(offer.label || '')}" maxlength="40" placeholder="Например: Записаться на разбор" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink" />
          ${consultants.length ? `
            <select name="offerConsultant" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink">
              <option value="">Ведёт на ссылку ниже</option>
              ${consultants.map(c => `<option value="${SF.esc(c.slug)}" ${offer.consultantId === c.slug ? 'selected' : ''}>Ведёт в чат с моим SI: ${SF.esc(c.name)}</option>`).join('')}
            </select>` : ''}
          <input name="offerUrl" value="${SF.esc(offer.url || '')}" maxlength="300" placeholder="https://... (ссылка на оплату или запись)" inputmode="url" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink" />
        </div>

        <button type="submit" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm">Сохранить</button>
      </form>
    `;
  }

  // Same rules as the server (server/services/profile-service.js)
  const isWebUrl = (url) => /^https?:\/\/[^\s<>"']+$/i.test(url);

  // ---------------- Actions ----------------
  SF.actions.changeMyPhoto = async () => {
    if (!window.sfMedia) return;
    try {
      const result = await window.sfMedia.choosePhoto((blob) => api().uploadMyPhoto(blob));
      if (!result) return;
      store().setMyPhoto(result.url);
      showToast(result.savedOnServer ? 'Фото сохранено' : 'Фото сохранено на этом устройстве');
    } catch (err) {
      showToast(err.message || 'Не удалось загрузить фото');
    }
  };

  SF.actions.saveProfile = async (e) => {
    e.preventDefault();
    const f = e.target;
    const links = [];
    for (let i = 0; i < 5; i++) {
      const url = (f[`linkUrl${i}`]?.value || '').trim();
      const label = (f[`linkLabel${i}`]?.value || '').trim();
      if (!url) continue;
      if (!isWebUrl(url)) {
        showToast(`Ссылка «${label || url}» должна начинаться с https://`);
        return;
      }
      links.push({ label, url });
    }
    const offerUrl = (f.offerUrl.value || '').trim();
    const offerConsultant = f.offerConsultant ? f.offerConsultant.value : '';
    if (offerUrl && !isWebUrl(offerUrl)) {
      showToast('Ссылка кнопки оффера должна начинаться с https://');
      return;
    }
    const profile = {
      displayName: f.displayName.value.trim(),
      headline: f.headline.value.trim(),
      bio: f.bio.value.trim(),
      regalia: f.regalia.value.trim(),
      results: f.results.value.trim(),
      links,
      offerButton: offerUrl || offerConsultant
        ? { label: f.offerLabel.value.trim() || 'Мой оффер', url: offerUrl || null, consultantId: offerConsultant || null }
        : null,
      language: store().data.me.profile.language || 'ru',
      // PUT replaces the whole profile: keep the Office consent and the personal / business view
      businessAgreedAt: store().data.me.profile.businessAgreedAt || null,
      personalMode: Boolean(store().data.me.profile.personalMode)
    };

    store().updateProfile(profile);
    let savedOnServer = false;
    if (api() && api().isSignedIn()) {
      try {
        const res = await api().updateMyProfile(profile);
        if (res.user) store().applyServerUser(res.user);
        savedOnServer = true;
      } catch (err) {}
    }
    store().popRoute();
    showToast(savedOnServer ? 'Профиль сохранён' : 'Профиль сохранён на этом устройстве');
  };

  // For people who declined before: Telegram asks again, one tap "Разрешить"
  SF.actions.enableNotifications = () => {
    SF.askWriteAccess((allowed) => {
      showToast(allowed ? 'Готово! Уведомления будут приходить в Telegram' : 'Без разрешения бот не сможет писать вам. Можно включить позже');
      store().notify();
    });
  };

  SF.actions.openOffer = () => {
    const offer = store().data.me.profile.offerButton;
    if (!offer) return;
    if (offer.consultantId) {
      SF.actions.openChat(offer.consultantId); // consultantId holds the consultant's slug
    } else if (offer.url) {
      SF.openLink(offer.url);
    }
  };

  SF.actions.resetDemo = () => {
    if (confirm('Очистить данные на этом устройстве? Всё сохранённое на сервере останется.')) {
      store().resetToDefault();
      showToast('Данные на устройстве очищены');
      if (typeof window.reconnectTelegramAuth === 'function') window.reconnectTelegramAuth();
    }
  };

  // ---------------- Screen ----------------
  // Support panel screens (route.screen 'admin…') are in js/screens/admin.js
  const isAdmin = (route) => route.screen.startsWith('admin');
  // The Office opens inside Settings (owner's decision 23 Nov.): its screens are in js/screens/office.js
  const isOffice = (route) => route.screen.startsWith('office');
  const TITLES = { view: 'Настройки', me: 'Мой профиль', edit: 'Редактировать профиль', invite: 'Пригласить друзей' };
  SF.screens.profile = {
    title(route, state) {
      if (isAdmin(route)) return SF.admin.title(route, state);
      if (isOffice(route)) return SF.office.title(route, state);
      return TITLES[route.screen] || 'Настройки';
    },
    render(route, state) {
      if (isAdmin(route)) return SF.admin.render(route, state);
      if (isOffice(route)) return SF.office.render(route, state);
      if (route.screen === 'edit') return renderEdit(state);
      if (route.screen === 'me') return renderView(state);
      if (route.screen === 'invite') return renderInvite(state);
      return renderSettings(state);
    },
    afterRender(route, state) {
      if (isAdmin(route)) return SF.admin.afterRender(route, state);
      if (isOffice(route)) return SF.office.afterRender && SF.office.afterRender(route, state);
      if (route.screen === 'invite' || route.screen === 'me') SF.data.referral();
      if (route.screen === 'view' && store().isBusinessView() && store().isBusinessActive()) SF.data.businesses();
    }
  };
})(window);
