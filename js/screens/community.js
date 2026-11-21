// screens/community.js - «Комьюнити»: communities of experts, part 1 (owner's decisions 21 Nov., like Skool).
// Only a business profile creates them (as many as it wants); anyone joins. A plain group conversation is a
// different thing: it lives in «Чаты». Server: server/services/community-service.js.
// Screens of the tab:
//   list                      my communities + the catalog (public ones) with a search; «Создать сообщество»
//   community-edit { id? }    a new community / its settings (the owner)
//   community { id, view }    «О сообществе» and joining (free / request / paid), or inside: feed · members ·
//                             about · waiting (the owner and moderators)
//   community-post { postId } a post with its comments (replies under their comment)
// Entry by payment: the expert's own link → «Я оплатил(а)» → the owner confirms (no payment through SmartFlow).
// No made-up communities or numbers: real ones from the server or an honest empty screen.

(function (window) {
  const SF = window.SF;
  const showToast = SF.showToast;
  const store = () => window.funnelStore;
  const api = () => window.smartFlowApi;
  const remote = () => store().data.remote.communities || {};
  let busy = false;

  const ROLE = { owner: 'автор', moderator: 'модератор' };
  const n = (v) => `<span data-no-tr>${Number(v) || 0}</span>`;
  const when = (iso) => (iso ? new Date(iso).toLocaleString(SF.locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  const dateOnly = (iso) => (iso ? new Date(iso).toLocaleDateString(SF.locale(), { day: 'numeric', month: 'long' }) : '');

  function cover(url, cls = 'h-24') {
    return url
      ? `<img src="${SF.photoSrc(url, '')}" alt="" class="w-full ${cls} object-cover rounded-2xl bg-sunken" />`
      : `<div class="w-full ${cls} rounded-2xl bg-[#81D8D0]/15 border border-line flex items-center justify-center text-brand"><i data-lucide="users" class="w-7 h-7"></i></div>`;
  }

  function priceText(c) {
    if (c.joinMode === 'paid') return `${SF.esc(c.priceLabel || '')}${c.priceType === 'monthly' ? '' : ''}`;
    if (c.joinMode === 'request') return '<span>По заявке</span>';
    return '<span>Бесплатно</span>';
  }

  async function call(method, path, body, okToast) {
    try {
      const res = await api().communityCall(method, path, body);
      if (okToast) showToast(okToast);
      return res || {};
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не получилось', err));
      return null;
    }
  }

  function reloadCommunity(id) {
    SF.data.invalidate('com:');
    SF.data.community(id, 0);
    SF.data.communityMine(0);
  }

  // ---------------- List: mine + catalog ----------------
  let search = '';
  let searchTimer = null;
  SF.actions.searchCommunities = (value) => {
    search = String(value || '').trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => SF.data.communityCatalog(search, 0), 350);
  };

  SF.actions.openCommunity = (id) => SF.openIn('community', 'community', { id, view: 'feed' });

  function catalogCard(c) {
    return `
      <button onclick="SF.actions.openCommunity('${SF.js(c.id)}')" class="w-full glass-card-3d p-3 text-left space-y-2">
        ${cover(c.coverUrl, 'h-24')}
        <div class="flex items-start justify-between gap-2">
          <span class="min-w-0">
            <span class="block text-sm font-bold text-ink truncate" data-no-tr>${SF.esc(c.name)}</span>
            ${c.owner ? `<span class="block text-[11px] text-muted truncate" data-no-tr>${SF.esc(c.owner.displayName)}</span>` : ''}
          </span>
          <span class="text-[11px] font-bold text-brand whitespace-nowrap">${priceText(c)}</span>
        </div>
        ${c.about ? `<div class="text-xs text-ink-2 leading-snug line-clamp-2" data-no-tr>${SF.esc(c.about)}</div>` : ''}
        <div class="text-[10px] text-faint">${n(c.memberCount)} <span>участн.</span> · ${n(c.postCount)} <span>постов</span></div>
      </button>`;
  }

  function mineRow(c) {
    const status = c.status === 'requested' ? '<span>Заявка отправлена</span>'
      : c.status === 'paying' ? '<span>Ждём подтверждения оплаты</span>'
      : !c.access ? '<span>Нужно продлить</span>'
      : ROLE[c.role] ? `<span>${ROLE[c.role]}</span>` : `${n(c.memberCount)} <span>участн.</span>`;
    return `
      <button onclick="SF.actions.openCommunity('${SF.js(c.id)}')" class="w-full p-3 rounded-2xl flex items-center gap-3 text-left bg-card border border-line">
        <span class="w-11 h-11 rounded-xl overflow-hidden flex-shrink-0">${c.coverUrl ? `<img src="${SF.photoSrc(c.coverUrl, '')}" alt="" class="w-full h-full object-cover" />` : '<span class="w-full h-full bg-[#81D8D0]/20 text-brand flex items-center justify-center"><i data-lucide="users" class="w-5 h-5"></i></span>'}</span>
        <span class="flex-1 min-w-0">
          <span class="block text-sm font-bold text-ink truncate" data-no-tr>${SF.esc(c.name)}</span>
          <span class="block text-[11px] text-muted truncate">${status}</span>
        </span>
        ${c.waiting ? `<span class="px-1.5 py-0.5 rounded-full bg-[#81D8D0] text-[#08302c] text-[10px] font-bold" title="Ждут ответа">${n(c.waiting)}</span>` : ''}
        ${c.newPosts ? '<span class="w-2.5 h-2.5 rounded-full bg-[#81D8D0]"></span>' : ''}
      </button>`;
  }

  function renderList(state) {
    if (!SF.data.signedIn()) return SF.emptyState('buddy', 'Сообщества экспертов', 'Откройте приложение в Telegram, чтобы увидеть сообщества.');
    const business = store().isBusinessView();
    const mine = remote().mine;
    const catalog = remote().catalog;
    const mineIds = new Set((mine || []).map(c => c.id));
    const others = (catalog || []).filter(c => !mineIds.has(c.id));
    return `
      ${business ? `
        <button onclick="SF.push('community-edit', {})" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm flex items-center justify-center gap-1.5"><i data-lucide="plus" class="w-4 h-4"></i>Создать сообщество</button>` : ''}

      ${mine && mine.length ? `
        <div class="space-y-2">
          ${SF.sectionTitle('users', 'Мои сообщества')}
          ${mine.map(mineRow).join('')}
        </div>` : ''}

      <div class="space-y-2">
        ${SF.sectionTitle('search', 'Сообщества в SmartFlow')}
        <div class="relative">
          <i data-lucide="search" class="w-4 h-4 text-faint absolute left-3 top-1/2 -translate-y-1/2"></i>
          <input type="search" data-keep="community-search" value="${SF.esc(search)}" oninput="SF.actions.searchCommunities(this.value)" placeholder="Найти сообщество: тема, название" autocomplete="off"
            class="w-full bg-card border border-line-2 rounded-xl pl-9 pr-3 py-2.5 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]" />
        </div>
        ${catalog === null ? '<div class="text-xs text-muted px-1">Загружаю…</div>' : ''}
        ${others.map(catalogCard).join('')}
        ${catalog && !others.length && search ? '<div class="text-xs text-muted px-1">Ничего не нашли. Попробуйте другое слово.</div>' : ''}
        ${catalog && !others.length && !search && mine && mine.length ? '<div class="text-xs text-muted px-1">Других открытых сообществ пока нет.</div>' : ''}
        ${catalog && !others.length && !search && !(mine && mine.length) ? SF.emptyState('buddy', 'Сообщества только появляются', business
          ? 'Создайте первое — с лентой, участниками и входом бесплатно или по вашей ссылке оплаты.'
          : 'Здесь появятся сообщества экспертов: лента, обсуждения, участники.') : ''}
      </div>
    `;
  }

  // ---------------- New community / settings ----------------
  function renderEdit(route) {
    const c = route.id ? (remote().view || {})[route.id] : null;
    if (route.id && !c) return '<div class="text-xs text-muted">Загружаю…</div>';
    const v = c || { name: '', about: '', rules: '', visibility: 'public', joinMode: 'free', priceType: 'once', priceLabel: '', questions: [], posting: 'all', categories: [] };
    const radio = (name, value, current, label, hint = '') => `
      <label class="flex items-start gap-2 p-2.5 rounded-xl border ${current === value ? 'border-[#81D8D0] bg-[#81D8D0]/10' : 'border-line bg-card'} cursor-pointer">
        <input type="radio" name="${name}" value="${value}" ${current === value ? 'checked' : ''} onchange="SF.actions.communityFormMode()" class="mt-0.5 accent-[#0d9488]" />
        <span><span class="block text-xs font-semibold text-ink">${label}</span>${hint ? `<span class="block text-[10px] text-faint leading-snug">${hint}</span>` : ''}</span>
      </label>`;
    const field = 'w-full bg-card border border-line-2 rounded-xl px-3 py-2.5 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]';
    const qs = [0, 1, 2].map(i => v.questions[i] || '');
    return `
      <form id="community-form" onsubmit="SF.actions.saveCommunity(event, '${SF.js(route.id || '')}')" class="space-y-3 text-xs">
        <div class="glass-card-3d p-3.5 space-y-2.5">
          <label class="block font-bold text-muted uppercase tracking-wider text-[11px]">Название</label>
          <input name="name" maxlength="60" required value="${SF.esc(v.name)}" placeholder="Например: Йога по утрам" class="${field} text-sm" />
          <label class="block font-bold text-muted uppercase tracking-wider text-[11px]">Для кого и что внутри</label>
          <textarea name="about" rows="4" maxlength="2000" placeholder="Кому подойдёт, что получат участники, как часто вы пишете" class="${field}">${SF.esc(v.about)}</textarea>
          <label class="block font-bold text-muted uppercase tracking-wider text-[11px]">Правила</label>
          <textarea name="rules" rows="3" maxlength="2000" placeholder="Например: без рекламы, уважительно, по теме" class="${field}">${SF.esc(v.rules)}</textarea>
          <label class="block font-bold text-muted uppercase tracking-wider text-[11px]">Темы ленты (через запятую, до 8)</label>
          <input name="categories" value="${SF.esc(v.categories.join(', '))}" placeholder="Вопросы, Победы, Анонсы" class="${field}" />
          ${route.id ? `<button type="button" onclick="SF.actions.changeCommunityCover('${SF.js(route.id)}')" class="w-full py-2.5 rounded-xl btn-3d-dark text-xs flex items-center justify-center gap-1.5"><i data-lucide="image" class="w-3.5 h-3.5"></i>Обложка сообщества</button>` : '<div class="text-[10px] text-faint">Обложку можно добавить после создания.</div>'}
        </div>

        <div class="glass-card-3d p-3.5 space-y-2">
          <div class="font-bold text-ink">Кто видит</div>
          ${radio('visibility', 'public', v.visibility, 'Открытое', 'В каталоге «Комьюнити», его найдут все')}
          ${radio('visibility', 'hidden', v.visibility, 'Скрытое', 'Только по вашей ссылке')}
        </div>

        <div class="glass-card-3d p-3.5 space-y-2">
          <div class="font-bold text-ink">Как вступить</div>
          ${radio('joinMode', 'free', v.joinMode, 'Бесплатно', 'Человек нажимает «Вступить» и сразу внутри')}
          ${radio('joinMode', 'request', v.joinMode, 'По заявке', 'Человек отвечает на ваши вопросы, вы принимаете')}
          ${radio('joinMode', 'paid', v.joinMode, 'Платно', 'По вашей ссылке оплаты, вы подтверждаете оплату')}
          <div data-mode="request" class="space-y-1.5 ${v.joinMode === 'request' ? '' : 'hidden'}">
            ${qs.map((q, i) => `<input name="q${i}" maxlength="200" value="${SF.esc(q)}" placeholder="Вопрос ${i + 1}${i ? ' (необязательно)' : ''}" class="${field}" />`).join('')}
          </div>
          <div data-mode="paid" class="space-y-1.5 ${v.joinMode === 'paid' ? '' : 'hidden'}">
            <div class="grid grid-cols-2 gap-1.5">
              <label class="flex items-center gap-1.5 p-2 rounded-xl border border-line bg-card"><input type="radio" name="priceType" value="once" ${v.priceType !== 'monthly' ? 'checked' : ''} class="accent-[#0d9488]" />Разово</label>
              <label class="flex items-center gap-1.5 p-2 rounded-xl border border-line bg-card"><input type="radio" name="priceType" value="monthly" ${v.priceType === 'monthly' ? 'checked' : ''} class="accent-[#0d9488]" />Каждый месяц</label>
            </div>
            <input name="priceLabel" maxlength="60" value="${SF.esc(v.priceLabel || '')}" placeholder="Цена, например «5 000 ₸ в месяц»" class="${field}" />
            <input name="paymentUrl" maxlength="300" value="${SF.esc(v.paymentUrl || '')}" placeholder="Ссылка на оплату (https://…)" class="${field}" />
            <div class="text-[10px] text-faint leading-snug">Деньги идут вам напрямую. Человек пишет, как оплатил, вы подтверждаете — и он внутри. «Каждый месяц»: доступ на 30 дней, продление так же.</div>
          </div>
        </div>

        <div class="glass-card-3d p-3.5 space-y-2">
          <div class="font-bold text-ink">Кто пишет посты</div>
          ${radio('posting', 'all', v.posting, 'Все участники')}
          ${radio('posting', 'staff', v.posting, 'Только я и модераторы', 'Остальные комментируют')}
        </div>

        <button type="submit" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm">${route.id ? 'Сохранить' : 'Создать сообщество'}</button>
      </form>
    `;
  }

  // Show the questions / price fields for the chosen way to join
  SF.actions.communityFormMode = () => {
    const f = document.getElementById('community-form');
    if (!f) return;
    const mode = f.joinMode.value;
    f.querySelectorAll('[data-mode]').forEach(el => el.classList.toggle('hidden', el.dataset.mode !== mode));
    // The chosen option is highlighted (the highlight follows the tick)
    f.querySelectorAll('input[type=radio][name=visibility], input[type=radio][name=joinMode], input[type=radio][name=posting]').forEach(r => {
      const label = r.closest('label');
      if (!label) return;
      label.classList.toggle('border-[#81D8D0]', r.checked);
      label.classList.toggle('bg-[#81D8D0]/10', r.checked);
      label.classList.toggle('border-line', !r.checked);
      label.classList.toggle('bg-card', !r.checked);
    });
  };

  SF.actions.saveCommunity = async (e, id) => {
    e.preventDefault();
    if (busy) return;
    const f = e.target;
    const data = {
      name: f.name.value,
      about: f.about.value,
      rules: f.rules.value,
      categories: f.categories.value.split(',').map(t => t.trim()).filter(Boolean),
      visibility: f.visibility.value,
      joinMode: f.joinMode.value,
      questions: [f.q0.value, f.q1.value, f.q2.value].map(q => q.trim()).filter(Boolean),
      priceType: f.priceType.value,
      priceLabel: f.priceLabel.value,
      paymentUrl: f.paymentUrl.value.trim(),
      posting: f.posting.value
    };
    busy = true;
    const res = await call(id ? 'PUT' : 'POST', id ? `/${encodeURIComponent(id)}` : '', data, id ? 'Сохранено' : 'Сообщество создано 🎉');
    busy = false;
    if (!res) return;
    SF.data.invalidate('com:');
    SF.data.communityMine(0);
    if (id) {
      store().setRemote(`communities.view.${id}`, res);
      SF.back();
    } else {
      SF.openIn('community', 'community', { id: res.communityId, view: 'feed' });
    }
  };

  SF.actions.changeCommunityCover = async (id) => {
    if (!window.sfMedia) return;
    try {
      const res = await window.sfMedia.choosePhoto((blob) => api().uploadCommunityCover(id, blob));
      if (!res) return;
      if (!res.savedOnServer) return showToast('Не сохранилось. Попробуйте ещё раз');
      showToast('Обложка обновлена');
      reloadCommunity(id);
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не сохранилось', err));
    }
  };

  // ---------------- «О сообществе» and joining ----------------
  function aboutBlock(c) {
    return `
      ${c.about ? `<div class="glass-card-3d p-3.5 space-y-1"><div class="text-[11px] font-bold uppercase tracking-wider text-brand">О сообществе</div><div class="text-xs text-ink-2 leading-relaxed whitespace-pre-line" data-no-tr>${SF.esc(c.about)}</div></div>` : ''}
      ${c.rules ? `<div class="glass-card-3d p-3.5 space-y-1"><div class="text-[11px] font-bold uppercase tracking-wider text-brand">Правила</div><div class="text-xs text-ink-2 leading-relaxed whitespace-pre-line" data-no-tr>${SF.esc(c.rules)}</div></div>` : ''}
      ${c.owner ? `
        <button onclick="SF.actions.openPersonProfile('${SF.js(c.owner.id)}')" class="w-full glass-card-3d p-3 flex items-center gap-2.5 text-left">
          ${SF.avatar(c.owner.photoUrl, { size: 36, kind: 'human', userId: c.owner.id })}
          <span class="min-w-0"><span class="block text-[10px] text-faint">Автор</span><span class="block text-xs font-bold text-ink truncate" data-no-tr>${SF.esc(c.owner.displayName)}</span></span>
        </button>` : ''}`;
  }

  function joinPanel(c) {
    const me = c.me || {};
    if (c.hiddenByStaff && !me.access) return '<div class="p-3 rounded-2xl bg-sunken border border-line text-xs text-ink-2">Сообщество сейчас закрыто для новых участников.</div>';
    if (me.status === 'banned') return '<div class="p-3 rounded-2xl bg-sunken border border-line text-xs text-ink-2">Автор закрыл вам доступ к этому сообществу.</div>';
    const declined = me.status === 'removed' && me.declineReason ? `<div class="text-[11px] text-muted"><span>Причина:</span> <span data-no-tr>${SF.esc(me.declineReason)}</span></div>` : '';
    const field = 'w-full bg-card border border-line-2 rounded-xl px-3 py-2.5 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]';
    if (c.joinMode === 'free') {
      return `<button onclick="SF.actions.joinCommunity('${SF.js(c.id)}')" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm">Вступить бесплатно</button>`;
    }
    if (c.joinMode === 'request') {
      if (me.status === 'requested') return '<div class="p-3 rounded-2xl bg-card border border-[#81D8D0] text-xs text-ink-2">Заявка отправлена — автор ответит, и мы сообщим вам.</div>';
      return `
        <form onsubmit="SF.actions.requestCommunity(event, '${SF.js(c.id)}')" class="glass-card-3d p-3.5 space-y-2 text-xs">
          <div class="font-bold text-ink">Вступление по заявке</div>
          ${me.status === 'removed' ? '<div class="text-[11px] text-muted">Прошлую заявку не приняли — можно отправить снова.</div>' : ''}
          ${declined}
          ${c.questions.map((q, i) => `
            <label class="block text-ink-2 font-semibold" data-no-tr>${SF.esc(q)}</label>
            <textarea name="a${i}" rows="2" maxlength="1000" required class="${field}"></textarea>`).join('')}
          <button type="submit" class="w-full py-2.5 rounded-xl btn-3d-tiffany text-xs">Отправить заявку</button>
        </form>`;
    }
    // Paid
    if (me.status === 'paying') return '<div class="p-3 rounded-2xl bg-card border border-[#81D8D0] text-xs text-ink-2">Ждём, когда автор подтвердит оплату — мы сообщим вам.</div>';
    const ended = me.status === 'active' && !me.access;
    if (ended && me.renewalRequested) return '<div class="p-3 rounded-2xl bg-card border border-[#81D8D0] text-xs text-ink-2">Оплата за следующий месяц у автора на подтверждении.</div>';
    return `
      <form onsubmit="SF.actions.payCommunity(event, '${SF.js(c.id)}')" class="glass-card-3d p-3.5 space-y-2 text-xs">
        <div class="flex items-center justify-between gap-2"><span class="font-bold text-ink">${ended ? 'Месяц закончился' : 'Платное сообщество'}</span><span class="font-bold text-brand" data-no-tr>${SF.esc(c.priceLabel || '')}</span></div>
        ${c.priceType === 'monthly' ? '<div class="text-[11px] text-muted">Доступ на 30 дней, потом — продление так же.</div>' : ''}
        ${declined}
        ${c.paymentUrl ? `<button type="button" onclick="SF.openLink('${SF.js(c.paymentUrl)}')" class="w-full py-2.5 rounded-xl btn-3d-dark text-xs flex items-center justify-center gap-1.5"><i data-lucide="external-link" class="w-3.5 h-3.5"></i>1. Оплатить по ссылке автора</button>` : ''}
        <input name="note" maxlength="300" required placeholder="2. Как и когда оплатили (например: Kaspi, 21 ноября)" class="${field}" />
        <button type="submit" class="w-full py-2.5 rounded-xl btn-3d-tiffany text-xs">Я оплатил(а)</button>
        <div class="text-[10px] text-faint">Деньги идут автору напрямую. Он сверит оплату и откроет доступ.</div>
      </form>`;
  }

  async function afterJoin(id, res) {
    if (!res) return;
    store().setRemote(`communities.view.${id}`, res);
    SF.data.invalidate('com:');
    SF.data.communityMine(0);
    SF.askWriteAccess(null, { auto: true }); // so the bot can tell when the author answers
  }

  SF.actions.joinCommunity = async (id) => afterJoin(id, await call('POST', `/${encodeURIComponent(id)}/join`, {}, 'Вы в сообществе 🙂'));
  SF.actions.requestCommunity = async (e, id) => {
    e.preventDefault();
    const c = (remote().view || {})[id];
    const answers = (c ? c.questions : []).map((q, i) => (e.target[`a${i}`] ? e.target[`a${i}`].value : ''));
    afterJoin(id, await call('POST', `/${encodeURIComponent(id)}/join`, { answers }, 'Заявка отправлена'));
  };
  SF.actions.payCommunity = async (e, id) => {
    e.preventDefault();
    const c = (remote().view || {})[id];
    const path = c && c.me && c.me.status === 'active' && c.me.access ? '/renew' : '/join';
    afterJoin(id, await call('POST', `/${encodeURIComponent(id)}${path}`, { note: e.target.note.value }, 'Отправили автору на подтверждение'));
  };

  function renderAbout(c) {
    return `
      ${cover(c.coverUrl, 'h-32')}
      <div class="glass-card-3d p-3.5 space-y-1">
        <div class="text-base font-extrabold text-ink" data-no-tr>${SF.esc(c.name)}</div>
        <div class="text-[11px] text-muted">${n(c.memberCount)} <span>участн.</span> · ${n(c.postCount)} <span>постов</span> · ${priceText(c)}</div>
      </div>
      ${joinPanel(c)}
      ${aboutBlock(c)}
    `;
  }

  // ---------------- Inside ----------------
  function tabs(c, view) {
    const staff = ['owner', 'moderator'].includes(c.me.role);
    const items = [['feed', 'Лента'], ['members', 'Участники'], ['about', 'О сообществе']];
    if (staff) items.push(['waiting', `Заявки${c.waiting ? ` · ${c.waiting}` : ''}`]);
    return `
      <div class="flex gap-1.5 overflow-x-auto pb-1">
        ${items.map(([id, label]) => `
          <button onclick="SF.patch({ view: '${id}' })" class="px-3 py-1.5 rounded-xl text-xs whitespace-nowrap border font-semibold ${view === id ? 'bg-[#81D8D0]/20 border-[#81D8D0] text-brand' : 'bg-card border-line text-muted'}">${label}</button>`).join('')}
      </div>`;
  }

  function header(c) {
    return `
      <div class="glass-card-3d p-3 space-y-2">
        ${c.coverUrl ? cover(c.coverUrl, 'h-24') : ''}
        <div class="flex items-center justify-between gap-2">
          <span class="min-w-0">
            <span class="block text-sm font-extrabold text-ink truncate" data-no-tr>${SF.esc(c.name)}</span>
            <span class="block text-[11px] text-muted">${n(c.memberCount)} <span>участн.</span>${c.me.role && ROLE[c.me.role] ? ` · <span>${ROLE[c.me.role]}</span>` : ''}</span>
          </span>
          ${c.me.role === 'owner' ? `<button onclick="SF.push('community-edit', { id: '${SF.js(c.id)}' })" class="p-2 rounded-xl btn-3d-dark" aria-label="Настройки"><i data-lucide="pencil" class="w-4 h-4"></i></button>` : ''}
        </div>
        ${c.me.paidUntil ? `<div class="text-[10px] text-faint"><span>Оплачено до</span> <span data-no-tr>${dateOnly(c.me.paidUntil)}</span></div>` : ''}
      </div>`;
  }

  // Photos of posts are for members only: loaded with the session, kept while the app is open
  const fileUrls = new Map();
  function loadFiles() {
    document.querySelectorAll('[data-com-file]:not([src])').forEach(async (el) => {
      const id = el.dataset.fileId;
      if (el.dataset.loading) return;
      el.dataset.loading = '1';
      try {
        if (!fileUrls.has(id)) fileUrls.set(id, URL.createObjectURL(await api().getPrivateBlob(el.dataset.comFile)));
        el.src = fileUrls.get(id);
      } catch (err) {
        el.dataset.loading = '';
      }
    });
  }
  function photo(communityId, fileId) {
    if (!fileId) return '';
    const src = fileUrls.get(fileId) ? `src="${fileUrls.get(fileId)}"` : '';
    return `<img data-com-file="/api/communities/${encodeURIComponent(communityId)}/files/${encodeURIComponent(fileId)}" data-file-id="${SF.esc(fileId)}" ${src} alt="Фото" onclick="event.stopPropagation(); SF.actions.openPhoto(this)" class="w-full max-h-80 object-cover rounded-xl bg-sunken min-h-[120px]" />`;
  }

  function postCard(c, p, { full = false } = {}) {
    const staff = ['owner', 'moderator'].includes(c.me ? c.me.role : '') || full === 'staff';
    const open = full ? '' : `onclick="SF.push('community-post', { postId: '${SF.js(p.id)}' })"`;
    return `
      <div class="glass-card-3d p-3.5 space-y-2 ${full ? '' : 'cursor-pointer'}" ${open}>
        <div class="flex items-center gap-2.5">
          <button onclick="event.stopPropagation(); SF.actions.openPersonProfile('${SF.js(p.author.id)}')" class="flex items-center gap-2.5 min-w-0 text-left flex-1">
            ${SF.avatar(p.author.photoUrl, { size: 34, kind: 'human', userId: p.author.id })}
            <span class="min-w-0">
              <span class="block text-xs font-bold text-ink truncate" data-no-tr>${SF.esc(p.author.displayName)}</span>
              <span class="block text-[10px] text-faint">${when(p.createdAt)}${p.category ? ` · <span data-no-tr>${SF.esc(p.category)}</span>` : ''}</span>
            </span>
          </button>
          ${p.pinned ? '<span class="text-[10px] font-bold text-brand">📌 <span>Закреплено</span></span>' : ''}
          ${p.announcement ? '<span class="text-[10px] font-bold text-brand">📣 <span>Анонс</span></span>' : ''}
          <button onclick="event.stopPropagation(); SF.actions.postMenu('${SF.js(c.id)}', '${SF.js(p.id)}', ${p.mine ? 'true' : 'false'}, ${staff ? 'true' : 'false'}, ${p.pinned ? 'true' : 'false'})" class="p-1.5 rounded-lg text-faint" aria-label="Ещё"><i data-lucide="more-horizontal" class="w-4 h-4"></i></button>
        </div>
        ${p.text ? `<div class="text-[13px] text-ink leading-relaxed ${full ? '' : 'line-clamp-6'}" data-no-tr>${SF.formatChatMarkdown(p.text)}</div>` : ''}
        ${photo(c.id, p.fileId)}
        <div class="flex items-center gap-3 text-xs">
          <button onclick="event.stopPropagation(); SF.actions.likeCommunity('${SF.js(p.id)}', '${SF.js(c.id)}')" class="flex items-center gap-1 ${p.liked ? 'text-rose-500' : 'text-muted'}">${p.liked ? '❤️' : '🤍'} ${n(p.likes)}</button>
          <span class="flex items-center gap-1 text-muted">💬 ${n(p.comments)}</span>
        </div>
      </div>`;
  }

  // The composer: text, a topic, a photo; an announcement for the owner / moderators
  let draftPhoto = null;
  function composer(c) {
    if (!c.me.canPost) return c.posting === 'staff' ? '<div class="text-[11px] text-faint px-1">Посты здесь пишут автор и модераторы. Вы можете комментировать.</div>' : '';
    const staff = ['owner', 'moderator'].includes(c.me.role);
    return `
      <form onsubmit="SF.actions.createPost(event, '${SF.js(c.id)}')" class="glass-card-3d p-3 space-y-2 text-xs">
        <textarea name="text" data-keep="community-post-${SF.esc(c.id)}" rows="2" maxlength="5000" placeholder="Поделитесь мыслью, вопросом или победой…" class="w-full bg-card border border-line-2 rounded-xl px-3 py-2.5 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]"></textarea>
        ${draftPhoto && draftPhoto.communityId === c.id ? `<div class="flex items-center gap-2 text-[11px] text-ink-2">📷 <span>Фото прикреплено</span> <button type="button" onclick="SF.actions.dropPostPhoto()" class="text-rose-500">✕</button></div>` : ''}
        <div class="flex items-center gap-1.5 flex-wrap">
          ${c.categories.length ? `
            <select name="category" class="bg-card border border-line-2 rounded-xl px-2 py-2 text-xs text-ink">
              <option value="">Без темы</option>
              ${c.categories.map(t => `<option value="${SF.esc(t)}" data-no-tr>${SF.esc(t)}</option>`).join('')}
            </select>` : ''}
          <button type="button" onclick="SF.actions.pickPostPhoto('${SF.js(c.id)}')" class="p-2 rounded-xl btn-3d-dark" aria-label="Фото"><i data-lucide="image" class="w-4 h-4"></i></button>
          ${staff ? '<label class="flex items-center gap-1 text-[11px] text-ink-2"><input type="checkbox" name="announcement" class="accent-[#0d9488]" />📣 <span>Анонс всем</span></label>' : ''}
          <button type="submit" class="ml-auto px-3 py-2 rounded-xl btn-3d-tiffany text-xs">Опубликовать</button>
        </div>
      </form>`;
  }

  SF.actions.pickPostPhoto = async (id) => {
    if (!window.sfMedia) return;
    try {
      const blob = await window.sfMedia.pickChatPhoto();
      if (!blob) return;
      draftPhoto = { communityId: id, blob };
      store().notify();
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не получилось', err));
    }
  };
  SF.actions.dropPostPhoto = () => { draftPhoto = null; store().notify(); };

  SF.actions.createPost = async (e, id) => {
    e.preventDefault();
    if (busy) return;
    const f = e.target;
    const text = f.text.value.trim();
    const withPhoto = draftPhoto && draftPhoto.communityId === id ? draftPhoto.blob : null;
    if (!text && !withPhoto) return showToast('Напишите текст поста');
    const data = { text, category: f.category ? f.category.value : '', announcement: Boolean(f.announcement && f.announcement.checked) };
    busy = true;
    try {
      if (withPhoto) await api().createCommunityPhotoPost(id, data, withPhoto);
      else await api().communityCall('POST', `/${encodeURIComponent(id)}/posts`, data);
      f.text.value = '';
      draftPhoto = null;
      showToast('Опубликовано');
      SF.askWriteAccess(null, { auto: true });
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не опубликовалось', err));
    } finally {
      busy = false;
      SF.data.invalidate(`com:feed:${id}`);
      SF.data.communityFeed(id, (remote().feed[id] || {}).category || '', 0);
    }
  };

  SF.actions.likeCommunity = async (targetId, communityId, postId) => {
    const res = await call('POST', `/like/${encodeURIComponent(targetId)}`);
    if (!res) return;
    SF.data.invalidate('com:feed:');
    SF.data.invalidate('com:post:');
    SF.data.communityFeed(communityId, (remote().feed[communityId] || {}).category || '', 0);
    if (postId) SF.data.communityPost(postId, 0);
  };

  SF.actions.postMenu = (communityId, postId, mine, staff, pinned) => {
    const item = (onclick, icon, label, cls = 'text-ink-2') => `
      <button onclick="SF.closeModal(); ${onclick}" class="w-full text-left px-3 py-2.5 rounded-xl text-sm ${cls} hover:bg-sunken flex items-center gap-2"><span class="w-5 text-center">${icon}</span>${label}</button>`;
    SF.openModal(`
      <div class="space-y-0.5">
        ${staff ? item(`SF.actions.pinPost('${SF.js(communityId)}', '${SF.js(postId)}', ${pinned ? 'false' : 'true'})`, '📌', pinned ? 'Открепить' : 'Закрепить') : ''}
        ${mine || staff ? item(`SF.actions.deletePost('${SF.js(communityId)}', '${SF.js(postId)}')`, '🗑', 'Удалить', 'text-rose-500') : ''}
        ${!mine ? item(`SF.actions.reportCommunity('${SF.js(communityId)}', '${SF.js(postId)}')`, '⚠️', 'Пожаловаться', 'text-rose-500') : ''}
        ${item('', '✕', 'Закрыть')}
      </div>`);
  };

  SF.actions.pinPost = async (communityId, postId, pinned) => {
    if (await call('PUT', `/posts/${encodeURIComponent(postId)}/pin`, { pinned }, pinned ? 'Закреплено' : 'Откреплено')) {
      SF.data.invalidate('com:');
      SF.data.communityFeed(communityId, (remote().feed[communityId] || {}).category || '', 0);
    }
  };

  SF.actions.deletePost = async (communityId, postId) => {
    if (!window.confirm('Удалить пост вместе с комментариями?')) return;
    if (!await call('DELETE', `/posts/${encodeURIComponent(postId)}`, undefined, 'Удалено')) return;
    SF.data.invalidate('com:');
    SF.data.communityFeed(communityId, (remote().feed[communityId] || {}).category || '', 0);
    if (store().currentRoute('community').screen === 'community-post') SF.back();
  };

  SF.actions.reportCommunity = async (communityId, postId) => {
    const reason = window.prompt(postId ? 'Что не так с этим постом? Жалоба уйдёт команде SmartFlow.' : 'Что случилось? Жалоба на сообщество уйдёт команде SmartFlow.');
    if (reason === null) return;
    await call('POST', `/${encodeURIComponent(communityId)}/report`, { postId: postId || null, reason }, 'Жалоба отправлена команде. Спасибо!');
  };

  SF.actions.feedTopic = (communityId, topic) => {
    SF.data.invalidate(`com:feed:${communityId}`);
    store().setRemote(`communities.feed.${communityId}`, { ...(remote().feed[communityId] || {}), category: topic, loading: true });
    SF.data.communityFeed(communityId, topic, 0);
  };

  function renderFeed(c) {
    const f = remote().feed[c.id];
    const topic = (f && f.category) || '';
    return `
      ${composer(c)}
      ${c.categories.length ? `
        <div class="flex gap-1.5 overflow-x-auto pb-1">
          ${['', ...c.categories].map(t => `<button onclick="SF.actions.feedTopic('${SF.js(c.id)}', '${SF.js(t)}')" class="px-2.5 py-1 rounded-xl text-[11px] whitespace-nowrap border font-semibold ${topic === t ? 'bg-[#81D8D0]/20 border-[#81D8D0] text-brand' : 'bg-card border-line text-muted'}" ${t ? 'data-no-tr' : ''}>${t ? SF.esc(t) : 'Все'}</button>`).join('')}
        </div>` : ''}
      ${!f || f.loading ? '<div class="text-xs text-muted px-1">Загружаю…</div>' : ''}
      ${f && !f.loading ? f.posts.map(p => postCard(c, p)).join('') : ''}
      ${f && !f.loading && !f.posts.length ? SF.emptyState('buddy', 'Пока тихо', c.me.canPost ? 'Напишите первый пост — поздоровайтесь и расскажите, зачем вы здесь.' : 'Скоро здесь появятся посты автора.') : ''}
    `;
  }

  function renderMembers(c) {
    const list = remote().members[c.id];
    if (!list) return '<div class="text-xs text-muted px-1">Загружаю…</div>';
    const meId = store().data.me.id;
    const owner = c.me.role === 'owner';
    const staff = owner || c.me.role === 'moderator';
    return `
      <div class="space-y-2">
        ${list.map(m => {
          const canAct = staff && m.id !== meId && m.role !== 'owner' && (owner || m.role === 'member');
          return `
            <div class="p-2.5 rounded-2xl bg-card border border-line flex items-center gap-2.5">
              <button onclick="SF.actions.openPersonProfile('${SF.js(m.id)}')" class="flex-1 min-w-0 flex items-center gap-2.5 text-left">
                ${SF.avatar(m.photoUrl, { size: 36, kind: 'human', userId: m.id })}
                <span class="min-w-0">
                  <span class="block text-xs font-bold text-ink truncate"><span data-no-tr>${SF.esc(m.displayName)}</span>${m.id === meId ? ' <span>(вы)</span>' : ''}</span>
                  <span class="block text-[10px] text-muted truncate">${ROLE[m.role] ? `<span>${ROLE[m.role]}</span>` : `<span data-no-tr>${SF.esc(m.headline || '')}</span>`}${m.paidUntil ? ` · <span>оплачено до</span> <span data-no-tr>${dateOnly(m.paidUntil)}</span>` : ''}</span>
                </span>
              </button>
              ${canAct ? `
                <details class="relative flex-shrink-0">
                  <summary class="list-none p-1.5 rounded-lg btn-3d-dark cursor-pointer" aria-label="Ещё"><i data-lucide="more-horizontal" class="w-3.5 h-3.5"></i></summary>
                  <div class="absolute right-0 mt-1 z-20 w-48 p-1.5 rounded-xl bg-card border border-line shadow-lg space-y-1">
                    ${owner ? `<button onclick="SF.actions.communityRole('${SF.js(c.id)}', '${SF.js(m.id)}', '${m.role === 'moderator' ? 'member' : 'moderator'}')" class="w-full text-left px-2.5 py-2 rounded-lg text-xs text-ink-2 hover:bg-sunken">${m.role === 'moderator' ? 'Снять модератора' : 'Сделать модератором'}</button>` : ''}
                    <button onclick="SF.actions.communityRemove('${SF.js(c.id)}', '${SF.js(m.id)}', false)" class="w-full text-left px-2.5 py-2 rounded-lg text-xs text-ink-2 hover:bg-sunken">Удалить из сообщества</button>
                    <button onclick="SF.actions.communityRemove('${SF.js(c.id)}', '${SF.js(m.id)}', true)" class="w-full text-left px-2.5 py-2 rounded-lg text-xs text-rose-500 hover:bg-sunken">Заблокировать</button>
                  </div>
                </details>` : ''}
            </div>`;
        }).join('')}
      </div>`;
  }

  SF.actions.communityRole = async (id, userId, role) => {
    const res = await call('PUT', `/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { role }, role === 'moderator' ? 'Теперь модератор' : 'Больше не модератор');
    if (res) store().setRemote(`communities.members.${id}`, res.members || []);
  };
  SF.actions.communityRemove = async (id, userId, ban) => {
    if (!window.confirm(ban ? 'Заблокировать? Человек больше не сможет вступить.' : 'Удалить из сообщества? Человек сможет вступить снова.')) return;
    const res = await call('DELETE', `/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}${ban ? '?ban=1' : ''}`, undefined, 'Готово');
    if (res) { store().setRemote(`communities.members.${id}`, res.members || []); reloadCommunity(id); }
  };

  function renderInsideAbout(c) {
    const s = c.stats;
    const stat = (label, v) => `<div class="p-2.5 rounded-xl bg-card border border-line"><div class="text-base font-extrabold text-ink">${n(v)}</div><div class="text-[10px] text-muted">${label}</div></div>`;
    return `
      ${s ? `
        <div class="glass-card-3d p-3.5 space-y-2">
          <div class="text-[11px] font-bold uppercase tracking-wider text-brand">Цифры сообщества</div>
          <div class="grid grid-cols-3 gap-1.5">
            ${stat('участников', s.members)}${stat('новых за 7 дней', s.new7)}${stat('новых за 30 дней', s.new30)}
            ${stat('постов всего', s.posts)}${stat('постов за 30 дней', s.posts30)}${stat('активных за 30 дней', s.active30)}
          </div>
          ${s.requests || s.payments ? `<div class="text-[11px] text-ink-2">Ждут ответа: заявки — ${n(s.requests)}, оплаты — ${n(s.payments)}</div>` : ''}
        </div>` : ''}
      ${aboutBlock(c)}
      <div class="glass-card-3d p-3 text-xs flex items-center justify-between gap-2">
        <span class="text-muted">${c.visibility === 'hidden' ? 'Скрытое — по ссылке' : 'Открытое — в каталоге'} · ${priceText(c)}</span>
        <button onclick="SF.actions.shareCommunity('${SF.js(c.id)}')" class="px-3 py-1.5 rounded-xl btn-3d-dark text-[11px] flex items-center gap-1"><i data-lucide="share-2" class="w-3.5 h-3.5"></i>Ссылка</button>
      </div>
      ${c.joinMode === 'paid' && c.priceType === 'monthly' && c.me.role === 'member' ? (c.me.renewalRequested
        ? '<div class="p-3 rounded-2xl bg-card border border-[#81D8D0] text-xs text-ink-2">Оплата за следующий месяц у автора на подтверждении.</div>'
        : `<form onsubmit="SF.actions.payCommunity(event, '${SF.js(c.id)}')" class="glass-card-3d p-3.5 space-y-2 text-xs">
            <div class="flex items-center justify-between gap-2"><span class="font-bold text-ink">Продлить на месяц</span><span class="font-bold text-brand" data-no-tr>${SF.esc(c.priceLabel || '')}</span></div>
            ${c.paymentUrl ? `<button type="button" onclick="SF.openLink('${SF.js(c.paymentUrl)}')" class="w-full py-2.5 rounded-xl btn-3d-dark text-xs flex items-center justify-center gap-1.5"><i data-lucide="external-link" class="w-3.5 h-3.5"></i>Оплатить по ссылке автора</button>` : ''}
            <input name="note" maxlength="300" required placeholder="Как и когда оплатили" class="w-full bg-card border border-line-2 rounded-xl px-3 py-2.5 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]" />
            <button type="submit" class="w-full py-2.5 rounded-xl btn-3d-tiffany text-xs">Я оплатил(а) следующий месяц</button>
          </form>`) : ''}
      ${c.hiddenByStaff ? '<div class="p-3 rounded-2xl bg-sunken border border-line text-xs text-ink-2">Команда SmartFlow скрыла сообщество из каталога и закрыла вход новым участникам. Напишите в поддержку, если это ошибка.</div>' : ''}
      <div class="grid grid-cols-2 gap-2">
        ${c.me.role !== 'owner' ? `<button onclick="SF.actions.reportCommunity('${SF.js(c.id)}', null)" class="py-2.5 rounded-xl bg-sunken border border-line text-xs text-rose-500">Пожаловаться</button>
        <button onclick="SF.actions.leaveCommunity('${SF.js(c.id)}')" class="py-2.5 rounded-xl bg-sunken border border-line text-xs text-ink-2">Выйти</button>` : ''}
      </div>`;
  }

  SF.actions.shareCommunity = async (id) => {
    const c = (remote().view || {})[id];
    if (!c) return;
    const text = `Присоединяйтесь к сообществу «${c.name}» в SmartFlow: ${SF.appLink(`K_${id}`)}`;
    if (navigator.share) {
      try { await navigator.share({ text }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
    }
    SF.copyText(text, 'Ссылка на сообщество скопирована');
  };

  SF.actions.leaveCommunity = async (id) => {
    if (!window.confirm('Выйти из сообщества?')) return;
    if (!await call('POST', `/${encodeURIComponent(id)}/leave`, undefined, 'Вы вышли из сообщества')) return;
    SF.data.invalidate('com:');
    await SF.data.communityMine(0);
    store().data.ui.routes.community = store().data.ui.routes.community.slice(0, 1);
    store().notify();
  };

  function renderWaiting(c) {
    const items = remote().waiting[c.id];
    if (!items) return '<div class="text-xs text-muted px-1">Загружаю…</div>';
    if (!items.length) return SF.emptyState('buddy', 'Никто не ждёт', 'Здесь появятся заявки и оплаты, которые нужно подтвердить.');
    const label = { request: 'Заявка', payment: 'Оплата', renewal: 'Продление на месяц' };
    return items.map(it => `
      <div class="glass-card-3d p-3.5 space-y-2 text-xs">
        <div class="flex items-center justify-between gap-2">
          <button onclick="SF.actions.openPersonProfile('${SF.js(it.person.id)}')" class="flex items-center gap-2 min-w-0 text-left">
            ${SF.avatar(it.person.photoUrl, { size: 32, kind: 'human', userId: it.person.id })}
            <span class="font-bold text-ink truncate" data-no-tr>${SF.esc(it.person.displayName)}</span>
          </button>
          <span class="text-[10px] font-bold text-brand">${label[it.kind]}</span>
        </div>
        ${it.answers.map(a => `<div><div class="text-[10px] text-faint" data-no-tr>${SF.esc(a.q)}</div><div class="text-ink-2 whitespace-pre-line" data-no-tr>${SF.esc(a.a)}</div></div>`).join('')}
        ${it.note ? `<div><div class="text-[10px] text-faint">Как оплатил(а)</div><div class="text-ink-2" data-no-tr>${SF.esc(it.note)}</div></div>` : ''}
        <div class="grid grid-cols-2 gap-2">
          <button onclick="SF.actions.decideCommunity('${SF.js(c.id)}', '${SF.js(it.person.id)}', false)" class="py-2 rounded-xl bg-sunken border border-line text-ink-2">Отклонить</button>
          <button onclick="SF.actions.decideCommunity('${SF.js(c.id)}', '${SF.js(it.person.id)}', true)" class="py-2 rounded-xl btn-3d-tiffany">${it.kind === 'request' ? 'Принять' : 'Оплата пришла'}</button>
        </div>
      </div>`).join('');
  }

  SF.actions.decideCommunity = async (id, userId, accept) => {
    let reason = '';
    if (!accept) {
      reason = window.prompt('Причина (человек её увидит), можно оставить пустой:', '');
      if (reason === null) return;
    }
    const res = await call('POST', `/${encodeURIComponent(id)}/waiting/${encodeURIComponent(userId)}`, { accept, reason }, accept ? 'Готово — человек внутри' : 'Отклонено');
    if (!res) return;
    store().setRemote(`communities.waiting.${id}`, res.items || []);
    reloadCommunity(id);
  };

  function renderCommunity(route) {
    if (!SF.data.signedIn()) return SF.emptyState('assistant', 'Откройте приложение в Telegram', 'Сообщества доступны после входа через Telegram.');
    if (SF.data.isMissing(store().data, `com:${route.id}`)) return SF.emptyState('assistant', 'Сообщество не найдено', 'Возможно, ссылка устарела.');
    const c = (remote().view || {})[route.id];
    if (!c) return '<div class="text-xs text-muted">Загружаю…</div>';
    if (!c.me.access) return renderAbout(c);
    const view = route.view || 'feed';
    return `
      ${header(c)}
      ${tabs(c, view)}
      ${view === 'members' ? renderMembers(c) : view === 'about' ? renderInsideAbout(c) : view === 'waiting' ? renderWaiting(c) : renderFeed(c)}
    `;
  }

  // ---------------- A post with comments ----------------
  let replyTo = null; // { postId, id, name }
  SF.actions.replyComment = (postId, id, name) => {
    replyTo = { postId, id, name };
    store().notify();
    setTimeout(() => document.querySelector('[data-keep="community-comment"]')?.focus(), 50);
  };
  SF.actions.cancelCommentReply = () => { replyTo = null; store().notify(); };

  SF.actions.sendComment = async (e, postId) => {
    e.preventDefault();
    if (busy) return;
    const input = e.target.text;
    const text = input.value.trim();
    if (!text) return;
    const parentId = replyTo && replyTo.postId === postId ? replyTo.id : null;
    busy = true;
    const res = await call('POST', `/posts/${encodeURIComponent(postId)}/comments`, { text, parentId });
    busy = false;
    if (!res) return;
    input.value = '';
    replyTo = null;
    store().setRemote(`communities.post.${postId}`, res);
    SF.askWriteAccess(null, { auto: true });
  };

  SF.actions.deleteComment = async (postId, commentId) => {
    if (!window.confirm('Удалить комментарий?')) return;
    const res = await call('DELETE', `/comments/${encodeURIComponent(commentId)}`, undefined, 'Удалено');
    if (res) store().setRemote(`communities.post.${postId}`, res);
  };

  function commentRow(d, k, postId, reply = false) {
    return `
      <div class="${reply ? 'ml-9' : ''} flex gap-2">
        <button onclick="SF.actions.openPersonProfile('${SF.js(k.author.id)}')" class="flex-shrink-0">${SF.avatar(k.author.photoUrl, { size: reply ? 24 : 30, kind: 'human', userId: k.author.id })}</button>
        <div class="flex-1 min-w-0">
          <div class="px-3 py-2 rounded-2xl ${k.mine ? 'chat-bubble-mine !max-w-full' : `chat-bubble-person ${SF.personTone(k.author.id)} !max-w-full`}">
            <div class="text-[10px] font-bold ${k.mine ? 'text-brand' : 'person-name'}" data-no-tr>${SF.esc(k.author.displayName)}</div>
            ${k.deleted ? '<div class="text-xs italic opacity-60">Комментарий удалён</div>' : `<div class="text-xs text-ink leading-relaxed" data-no-tr>${SF.formatChatMarkdown(k.text)}</div>`}
          </div>
          ${k.deleted ? '' : `
            <div class="flex items-center gap-3 px-2 pt-0.5 text-[10px] text-faint">
              <span>${when(k.createdAt)}</span>
              <button onclick="SF.actions.likeCommunity('${SF.js(k.id)}', '${SF.js(d.communityId)}', '${SF.js(postId)}')" class="${k.liked ? 'text-rose-500' : ''}">${k.liked ? '❤️' : '🤍'} ${n(k.likes)}</button>
              <button onclick="SF.actions.replyComment('${SF.js(postId)}', '${SF.js(k.id)}', ${SF.esc(JSON.stringify(k.author.displayName))})" class="font-semibold">Ответить</button>
              ${k.mine || d.canModerate ? `<button onclick="SF.actions.deleteComment('${SF.js(postId)}', '${SF.js(k.id)}')" class="text-rose-500">Удалить</button>` : ''}
            </div>`}
        </div>
      </div>`;
  }

  function renderPost(route) {
    if (SF.data.isMissing(store().data, `compost:${route.postId}`)) return SF.emptyState('assistant', 'Пост не найден', 'Возможно, его удалили или у вас нет доступа к сообществу.');
    const d = (remote().post || {})[route.postId];
    if (!d) return '<div class="text-xs text-muted">Загружаю…</div>';
    const c = { id: d.communityId, me: { role: d.canModerate ? 'moderator' : null } };
    const top = d.comments.filter(k => !k.parentId);
    const replies = (id) => d.comments.filter(k => k.parentId === id);
    const reply = replyTo && replyTo.postId === route.postId ? replyTo : null;
    return `
      <button onclick="SF.actions.openCommunity('${SF.js(d.communityId)}')" class="text-[11px] text-brand font-semibold" data-no-tr>← ${SF.esc(d.communityName)}</button>
      ${postCard(c, d.post, { full: d.canModerate ? 'staff' : true })}
      <div class="space-y-2.5">
        ${SF.sectionTitle('message-circle', 'Комментарии')}
        ${!top.length ? '<div class="text-xs text-muted px-1">Пока нет комментариев — напишите первым.</div>' : ''}
        ${top.map(k => `${commentRow(d, k, route.postId)}${replies(k.id).map(r => commentRow(d, r, route.postId, true)).join('')}`).join('')}
      </div>
      ${reply ? `
        <div class="px-3 py-2 rounded-xl bg-card border border-[#81D8D0] flex items-center gap-2 text-[11px]">
          <span class="flex-1 min-w-0 truncate"><span>Ответ:</span> <b data-no-tr>${SF.esc(reply.name)}</b></span>
          <button onclick="SF.actions.cancelCommentReply()" class="p-1 text-faint" aria-label="Отменить ответ"><i data-lucide="x" class="w-4 h-4"></i></button>
        </div>` : ''}
      <form onsubmit="SF.actions.sendComment(event, '${SF.js(route.postId)}')" class="flex items-center gap-1.5 sticky bottom-0">
        <input type="text" name="text" data-keep="community-comment" maxlength="2000" autocomplete="off" placeholder="Комментарий…" class="flex-1 min-w-0 bg-card border border-line-2 rounded-xl px-3 py-2.5 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]" />
        <button type="submit" class="p-2.5 rounded-xl btn-3d-tiffany" aria-label="Отправить"><i data-lucide="send" class="w-4 h-4"></i></button>
      </form>
    `;
  }

  // ---------------- Screen ----------------
  function loadFor(route, maxAge) {
    if (route.screen === 'community-post') return SF.data.communityPost(route.postId, maxAge);
    if (route.screen === 'community-edit') return route.id ? SF.data.community(route.id, maxAge) : null;
    if (route.screen === 'community') {
      const id = route.id;
      SF.data.community(id, maxAge);
      const c = (remote().view || {})[id];
      if (!c || !c.me.access) return;
      const view = route.view || 'feed';
      if (view === 'feed') SF.data.communityFeed(id, (remote().feed[id] || {}).category || '', maxAge);
      if (view === 'members') SF.data.communityMembers(id, maxAge);
      if (view === 'waiting') SF.data.communityWaiting(id, maxAge);
      return;
    }
    SF.data.communityMine(maxAge);
    SF.data.communityCatalog(search, maxAge === 0 ? 0 : 30000);
  }

  SF.community = {
    // The «пульс» saw a change in my communities: reload what is on screen
    refresh: (route) => loadFor(route, 0),
    unreadCount: (state) => ((state.remote.communities || {}).mine || []).filter(c => c.newPosts || c.waiting).length
  };

  const TITLES = { 'community-edit': 'Сообщество', 'community-post': 'Пост' };
  SF.screens.community = {
    title(route) {
      if (route.screen === 'community') return ((remote().view || {})[route.id] || {}).name || 'Сообщество';
      return TITLES[route.screen] || 'Комьюнити';
    },
    render(route, state) {
      if (route.screen === 'community-edit') return renderEdit(route);
      if (route.screen === 'community') return renderCommunity(route);
      if (route.screen === 'community-post') return renderPost(route);
      return renderList(state);
    },
    afterRender(route) {
      loadFor(route);
      loadFiles();
      if (route.screen === 'community-edit') SF.actions.communityFormMode();
    }
  };
})(window);
