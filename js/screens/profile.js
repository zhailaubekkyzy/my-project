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

  // ---------------- View: the landing as visitors see it ----------------
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
        <div class="text-lg font-extrabold text-ink">${SF.esc(me.displayName)}</div>
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
          ${SF.sectionTitle('bot', 'Мои SI-консультанты')}
          ${consultants.map(c => `
            <div class="p-3 rounded-2xl bg-[var(--si-bubble)] border border-[var(--si-bubble-line)] flex items-center gap-2.5">
              ${SF.avatar(c.photoUrl, { size: 36, kind: 'si' })}
              <div class="min-w-0">
                <div class="text-xs font-bold text-ink truncate">${SF.esc(c.name)}</div>
                <div class="text-[10px]">${SF.siLabel(c.roleTitle)}</div>
              </div>
            </div>`).join('')}
        </div>` : ''}

      <div class="grid grid-cols-2 gap-2">
        <button onclick="SF.push('edit')" class="py-2.5 rounded-xl btn-3d-tiffany text-xs flex items-center justify-center gap-1.5"><i data-lucide="pencil" class="w-3.5 h-3.5"></i>Редактировать</button>
        <button onclick="SF.showToast('SI-брендолог проведёт короткое интервью и соберёт профиль сам — на следующем шаге')" class="py-2.5 rounded-xl btn-3d-dark text-xs flex items-center justify-center gap-1.5"><span class="si-dot"></span>SI-брендолог ${SF.soonBadge()}</button>
      </div>

      ${SF.botCanWrite() !== null ? `
        <div class="glass-card-3d p-3 flex items-center justify-between gap-2 text-xs">
          <span class="text-muted">Уведомления в Telegram</span>
          ${SF.botCanWrite()
            ? '<span class="text-brand font-semibold">Включены ✓</span>'
            : '<button onclick="SF.actions.enableNotifications()" class="px-3 py-1.5 rounded-xl btn-3d-tiffany text-xs">Включить</button>'}
        </div>` : ''}

      <div class="glass-card-3d p-3 flex items-center justify-between text-xs">
        <span class="text-muted">Язык интерфейса</span>
        <span class="text-ink-2 font-semibold">Русский ${SF.soonBadge('EN скоро')}</span>
      </div>

      ${me.id ? `
        <button onclick="SF.copyText('https://t.me/smartflow_ai_support_bot/app?startapp=P_${SF.js(me.id)}', 'Ссылка на профиль скопирована')" class="w-full py-2.5 rounded-xl btn-3d-dark text-xs flex items-center justify-center gap-1.5">
          <i data-lucide="share-2" class="w-3.5 h-3.5"></i> Поделиться профилем
        </button>` : ''}

      ${me.staffRole ? `
        <button onclick="SF.push('admin')" class="w-full py-2.5 rounded-xl btn-3d-dark text-xs flex items-center justify-center gap-1.5">
          <i data-lucide="life-buoy" class="w-3.5 h-3.5"></i> Панель поддержки
        </button>` : ''}

      <button onclick="SF.actions.resetDemo()" class="w-full py-2 text-[11px] text-faint hover:text-rose-400">Очистить данные на этом устройстве</button>

      ${me.supportCode ? `
        <button onclick="SF.copyText('${SF.js(me.supportCode)}', 'Номер скопирован')" class="w-full text-center text-[10px] text-faint">
          Ваш номер для поддержки: <span class="font-semibold text-muted">${SF.esc(me.supportCode)}</span>
        </button>` : ''}
    `;
  }

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
            <div class="text-[11px] text-muted leading-snug">Своё фото поднимает доверие сильнее всего. Его увидят клиенты в профиле и в Маркетплейсе.</div>
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
      // PUT replaces the whole profile: keep the Office consent
      businessAgreedAt: store().data.me.profile.businessAgreedAt || null
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
  SF.screens.profile = {
    title(route, state) {
      if (isAdmin(route)) return SF.admin.title(route, state);
      return route.screen === 'edit' ? 'Редактировать профиль' : 'Профиль';
    },
    render(route, state) {
      if (isAdmin(route)) return SF.admin.render(route, state);
      return route.screen === 'edit' ? renderEdit(state) : renderView(state);
    },
    afterRender(route, state) {
      if (isAdmin(route)) SF.admin.afterRender(route, state);
    }
  };
})(window);
