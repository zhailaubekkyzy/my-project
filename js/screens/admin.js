// screens/admin.js - Support panel for the SmartFlow team (owner and support staff).
// Opens from Profile → «Панель поддержки» (visible only to the team) and from the bot's message
// about a new complaint (startapp=A_<id>). Lives inside the Profile tab: route.screen 'admin…'.
//
// Data of other people is NOT saved on this phone: it is kept in memory only (cache below).
// Every fix shows "было → станет" and the number of records first; the server re-checks the
// number and writes every action to the team's log (server/services/support-fixes.js).

(function (window) {
  const SF = window.SF;
  const showToast = SF.showToast;
  const store = () => window.funnelStore;
  const api = () => window.smartFlowApi;

  // ---------------- Data (memory only) ----------------
  const cache = {};
  const errors = {};

  function load(key, fn, maxAgeMs = 20000) {
    return SF.data.ensure(`admin:${key}`, async () => {
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

  function refresh(prefix = '') {
    SF.data.invalidate(`admin:${prefix}`);
    store().notify();
  }

  // ---------------- Small parts ----------------
  const esc = SF.esc;
  const FEEDBACK_STATUS = { new: 'Новая', in_progress: 'В работе', done: 'Решена' };
  const STATUS_CLASS = { new: 'text-si', in_progress: 'text-brand', done: 'text-faint' };

  // Database time "2026-10-09 12:30:00" is UTC
  function fmtTime(value) {
    if (!value) return '—';
    const str = String(value);
    const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(str) ? `${str.replace(' ', 'T')}Z` : str);
    if (isNaN(date)) return esc(str);
    return date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function card(inner, extra = '') {
    return `<div class="glass-card-3d p-3.5 space-y-2 ${extra}">${inner}</div>`;
  }

  function row(label, value) {
    return `<div class="flex justify-between gap-3 text-[11px]"><span class="text-muted flex-shrink-0">${label}</span><span class="text-ink-2 text-right break-all">${value}</span></div>`;
  }

  function loading(key) {
    if (errors[key]) return card(`<div class="text-xs text-si">Не загрузилось: ${esc(errors[key])}</div><button onclick="SF.admin.refresh()" class="px-3 py-1.5 rounded-xl btn-3d-dark text-xs">Ещё раз</button>`);
    return '<div class="text-xs text-muted px-1">Загружаю…</div>';
  }

  // Icons are named as { icon: '…' } so scripts/build-icons.js bundles them
  function btn(label, onclick, kind = 'dark', { icon = '' } = {}) {
    return `<button onclick="${onclick}" class="px-3 py-2 rounded-xl btn-3d-${kind} text-xs flex items-center justify-center gap-1.5">${icon ? `<i data-lucide="${icon}" class="w-3.5 h-3.5"></i>` : ''}${label}</button>`;
  }

  // onclick="SF.admin.fix('usr_1', 'resume_si', '{...}')"
  function fixBtn(userId, fixId, label, params = {}, kind = 'dark') {
    return btn(label, `SF.admin.fix('${SF.js(userId)}', '${fixId}', '${SF.js(JSON.stringify(params))}')`, kind);
  }

  function personLine(u) {
    if (!u) return '<span class="text-faint">без входа</span>';
    return `<button onclick="SF.push('admin-user', { id: '${SF.js(u.id)}' })" class="text-brand font-semibold text-left">${esc(u.displayName || u.id)}${u.supportCode ? ` · ${esc(u.supportCode)}` : ''}</button>`;
  }

  const PANEL_LINK = 'https://t.me/smartflow_ai_support_bot/app?startapp=ADMIN';

  function noAccess() {
    const code = store().data.me.supportCode;
    return SF.emptyState('assistant', 'Панель только для команды',
      `Её видят владелица (номер в ADMIN_USERS в Railway) и люди, которых она добавила в «Команду».${code ? `<br/><br/>Ваш номер: <b class="text-ink">${esc(code)}</b> — передайте его владелице, чтобы она добавила вас.` : ''}`);
  }

  // ---------------- Home ----------------
  function renderHome(route, state) {
    if (!state.me.staffRole) return noAccess();
    const o = cache.overview;
    if (!o) return loading('overview');
    const sys = o.system;
    return `
      ${sys.warnings.length ? `
        <div class="p-3.5 rounded-2xl bg-[var(--si-bubble)] border border-[var(--si-bubble-line)] space-y-1">
          <div class="text-xs font-bold text-si">Требует внимания</div>
          ${sys.warnings.map(w => `<div class="text-[11px] text-ink-2">• ${esc(w)}</div>`).join('')}
        </div>` : ''}

      <form onsubmit="SF.admin.search(event)" class="flex gap-2">
        <input name="q" autocomplete="off" placeholder="SF-48213, @ник, имя или код ошибки" class="flex-1 p-2.5 rounded-xl bg-sunken border border-line-2 text-ink text-xs" />
        <button type="submit" class="px-3 rounded-xl btn-3d-tiffany text-xs" aria-label="Найти"><i data-lucide="search" class="w-4 h-4"></i></button>
      </form>

      <div class="grid grid-cols-2 gap-2">
        ${tile({ icon: 'message-circle-warning', title: 'Жалобы', sub: o.feedback.new ? `${o.feedback.new} новых` : 'новых нет', onclick: "SF.push('admin-feedback-list', { status: 'new' })", alert: o.feedback.new > 0 })}
        ${tile({ icon: 'users', title: 'Люди', sub: `${o.users.total} всего, +${o.users.new24h} за сутки`, onclick: "SF.push('admin-users')" })}
        ${tile({ icon: 'bug', title: 'Ошибки', sub: `${o.errors24h} за сутки`, onclick: "SF.push('admin-errors')", alert: o.errors24h > 0 })}
        ${tile({ icon: 'history', title: 'Журнал команды', sub: 'кто что исправлял', onclick: "SF.push('admin-actions')" })}
        ${o.me.role === 'owner' ? tile({ icon: 'shield-check', title: 'Команда', sub: 'добавить студента', onclick: "SF.push('admin-team')" }) : ''}
        ${tile({ icon: 'book-open', title: 'Как чинить', sub: 'пошаговая инструкция', onclick: "SF.push('admin-help')" })}
      </div>

      ${card(`
        <div class="text-xs font-bold text-ink">Состояние системы</div>
        ${row('Версия сервера', sys.commit ? esc(sys.commit) : '—')}
        ${row('База', sys.database === 'postgres' ? 'Supabase ✓' : esc(sys.database))}
        ${row('OpenAI (ответы SI)', sys.openai ? `работает ✓ (${esc(sys.openaiModel)})` : '<span class="text-si">нет ключа</span>')}
        ${row('Бот Telegram', sys.bot ? 'работает ✓' : '<span class="text-si">нет токена</span>')}
        ${row('Ваша роль', esc(o.me.roleLabel || o.me.role))}
      `)}
    `;
  }

  function tile({ icon, title, sub, onclick, alert = false }) {
    return `
      <button onclick="${onclick}" class="glass-card-3d p-3 text-left space-y-1">
        <i data-lucide="${icon}" class="w-5 h-5 ${alert ? 'text-si' : 'text-brand'}"></i>
        <div class="text-xs font-bold text-ink">${title}</div>
        <div class="text-[10px] ${alert ? 'text-si font-semibold' : 'text-muted'}">${sub}</div>
      </button>`;
  }

  // ---------------- Complaints ----------------
  function renderFeedbackList(route) {
    const status = route.status || 'new';
    const key = `feedback:${status}`;
    const list = cache[key];
    const chips = [['new', 'Новые'], ['in_progress', 'В работе'], ['done', 'Решены'], ['all', 'Все']];
    return `
      <div class="flex gap-1.5 overflow-x-auto">
        ${chips.map(([id, label]) => `<button onclick="SF.patch({ status: '${id}' })" class="px-3 py-1.5 rounded-xl text-xs ${id === status ? 'btn-3d-tiffany' : 'btn-3d-dark'}">${label}</button>`).join('')}
      </div>
      ${!list ? loading(key) : !list.length ? SF.emptyState('assistant', 'Пусто', status === 'new' ? 'Новых жалоб нет.' : 'Здесь пока ничего нет.') : list.map(f => `
        <button onclick="SF.push('admin-feedback', { id: '${SF.js(f.id)}' })" class="glass-card-3d p-3 w-full text-left space-y-1">
          <div class="flex justify-between gap-2 text-[11px]">
            <span class="font-bold text-ink truncate">${esc(f.user.displayName)} · ${esc(f.user.supportCode || '')}</span>
            <span class="${STATUS_CLASS[f.status] || 'text-muted'} font-semibold flex-shrink-0">${FEEDBACK_STATUS[f.status] || esc(f.status)}</span>
          </div>
          <div class="text-xs text-ink-2 line-clamp-2">${esc(f.text)}</div>
          <div class="text-[10px] text-faint">${fmtTime(f.createdAt)}${f.reply ? ' · есть ответ' : ''}</div>
        </button>`).join('')}
    `;
  }

  function contextRows(ctx) {
    if (!ctx) return '<div class="text-[11px] text-faint">Сведений нет (жалоба из старой версии приложения).</div>';
    const yes = (v) => (v === true ? 'да' : v === false ? '<span class="text-si">нет</span>' : '—');
    return `
      ${row('Телефон / система', esc(ctx.platform || '—'))}
      ${row('Версия Telegram', esc(ctx.tgVersion || '—'))}
      ${row('Экран', esc(ctx.route || '—'))}
      ${row('Размер экрана', esc(ctx.screen || '—'))}
      ${row('Тема', ctx.colorScheme === 'dark' ? 'тёмная' : 'светлая')}
      ${row('Интернет', yes(ctx.online))}
      ${row('Бот может писать', yes(ctx.botCanWrite))}
      ${row('Вход', esc(ctx.authStatus || '—'))}
      ${row('Версия приложения', esc(ctx.appVersion || '—'))}
      ${row('Язык / часовой пояс', `${esc(ctx.language || '—')} / ${esc(ctx.timezone || '—')}`)}
      <details class="text-[10px] text-faint"><summary>Браузер (user agent)</summary>${esc(ctx.userAgent || '—')}</details>
    `;
  }

  function recentErrorsList(list) {
    if (!list || !list.length) return '<div class="text-[11px] text-faint">Ошибок на телефоне не было.</div>';
    return list.slice().reverse().map(e => `
      <div class="text-[11px] flex gap-2 items-start">
        ${e.code ? `<button onclick="SF.push('admin-errors', { code: '${SF.js(e.code)}' })" class="font-mono font-bold text-brand flex-shrink-0">${esc(e.code)}</button>` : '<span class="font-mono text-faint flex-shrink-0">—</span>'}
        <span class="text-ink-2 break-all">${e.status === 0 ? 'нет связи' : e.status === -1 ? 'сбой приложения' : esc(e.status)} · ${esc(e.path)} · ${esc(e.message)}<span class="text-faint"> · ${fmtTime(e.at)}</span></span>
      </div>`).join('');
  }

  function renderFeedback(route) {
    const key = `fb:${route.id}`;
    const f = cache[key];
    if (!f) return loading(key);
    const ctx = f.context || {};
    return `
      ${card(`
        <div class="flex justify-between gap-2 text-[11px]">
          ${personLine(f.user)}
          <span class="${STATUS_CLASS[f.status]} font-semibold">${FEEDBACK_STATUS[f.status] || esc(f.status)}</span>
        </div>
        <div class="text-sm text-ink whitespace-pre-line">${esc(f.text)}</div>
        <div class="text-[10px] text-faint">${fmtTime(f.createdAt)}${f.user.username ? ` · @${esc(f.user.username)}` : ''}</div>
        ${btn('Открыть карточку человека', `SF.push('admin-user', { id: '${SF.js(f.user.id)}' })`, 'tiffany', { icon: 'user-round-search' })}
      `)}

      ${card(`<div class="text-xs font-bold text-ink">Телефон и экран</div>${contextRows(f.context)}`)}
      ${card(`<div class="text-xs font-bold text-ink">Последние ошибки на телефоне</div>${recentErrorsList(ctx.recentErrors)}`)}

      ${f.reply ? card(`
        <div class="text-xs font-bold text-ink">Ответ отправлен ${fmtTime(f.repliedAt)}${f.repliedBy ? ` · ${esc(f.repliedBy)}` : ''}</div>
        <div class="text-xs text-ink-2 whitespace-pre-line">${esc(f.reply)}</div>`) : ''}

      <form onsubmit="SF.admin.reply(event, '${SF.js(f.id)}')" class="glass-card-3d p-3.5 space-y-2 text-xs">
        <div class="font-bold text-ink">${f.reply ? 'Ответить ещё раз' : 'Ответить человеку'}</div>
        <textarea name="text" data-keep="admin-reply" rows="3" maxlength="2000" placeholder="Например: Починили! Закройте и откройте приложение заново." class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink"></textarea>
        <div class="text-[10px] text-faint">Ответ появится у человека в чате «Поддержка», бот пришлёт его в Telegram.</div>
        <div class="grid grid-cols-2 gap-2">
          <button type="submit" name="close" value="0" class="py-2 rounded-xl btn-3d-dark">Ответить</button>
          <button type="submit" name="close" value="1" class="py-2 rounded-xl btn-3d-tiffany">Ответить и закрыть</button>
        </div>
      </form>

      <form onsubmit="SF.admin.saveNote(event, '${SF.js(f.id)}')" class="glass-card-3d p-3.5 space-y-2 text-xs">
        <div class="font-bold text-ink">Заметка для команды</div>
        <textarea name="note" data-keep="admin-note" rows="2" maxlength="2000" placeholder="Что проверили, что сделали" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink">${esc(f.note)}</textarea>
        <div class="grid grid-cols-3 gap-2">
          ${['new', 'in_progress', 'done'].map(s => `<button type="submit" name="status" value="${s}" class="py-2 rounded-xl ${s === f.status ? 'btn-3d-tiffany' : 'btn-3d-dark'}">${FEEDBACK_STATUS[s]}</button>`).join('')}
        </div>
      </form>
    `;
  }

  // ---------------- People ----------------
  function renderUsers(route) {
    const q = route.q || '';
    const key = `users:${q}`;
    const list = cache[key];
    return `
      <form onsubmit="SF.admin.searchUsers(event)" class="flex gap-2">
        <input name="q" value="${esc(q)}" autocomplete="off" placeholder="SF-48213, @ник, имя, usr_… или Telegram id" class="flex-1 p-2.5 rounded-xl bg-sunken border border-line-2 text-ink text-xs" />
        <button type="submit" class="px-3 rounded-xl btn-3d-tiffany text-xs" aria-label="Найти"><i data-lucide="search" class="w-4 h-4"></i></button>
      </form>
      ${!q ? '<div class="text-[11px] text-muted px-1">Последние, кто заходил:</div>' : ''}
      ${!list ? loading(key) : !list.length ? SF.emptyState('assistant', 'Никого не нашли', 'Попросите человека открыть Профиль: внизу его номер вида SF-48213.') : list.map(u => `
        <button onclick="SF.push('admin-user', { id: '${SF.js(u.id)}' })" class="glass-card-3d p-3 w-full text-left flex items-center gap-2.5">
          ${SF.avatar(u.photoUrl, { size: 36, kind: 'human' })}
          <span class="min-w-0 flex-1">
            <span class="block text-xs font-bold text-ink truncate">${esc(u.displayName)}${u.status === 'blocked' ? ' <span class="text-si">(заблокирован)</span>' : ''}</span>
            <span class="block text-[10px] text-muted truncate">${esc(u.supportCode || '—')}${u.username ? ` · @${esc(u.username)}` : ''} · был(а) ${fmtTime(u.lastSeenAt || u.createdAt)}</span>
          </span>
        </button>`).join('')}
    `;
  }

  function renderUser(route, state) {
    const key = `user:${route.id}`;
    const d = cache[key];
    if (!d) return loading(key);
    const u = d.user;
    const isOwner = state.me.staffRole === 'owner';
    const actionLabel = (a) => ({
      view_chat: `открыл(а) переписку «${esc(a.details.consultant || '')}»`,
      message: 'написал(а) в Telegram',
      'feedback:reply': 'ответил(а) на жалобу',
      'feedback:update': 'изменил(а) жалобу',
      'staff:add': 'добавил(а) в команду',
      'staff:remove': 'убрал(а) из команды'
    }[a.action] || esc(a.details.title || a.action));

    return `
      ${card(`
        <div class="flex items-center gap-3">
          ${SF.avatar(u.photoUrl, { size: 52, kind: 'human' })}
          <div class="min-w-0">
            <div class="text-sm font-extrabold text-ink">${esc(u.displayName)}</div>
            <div class="text-[11px] text-muted">${u.username ? `@${esc(u.username)}` : 'без @ника'}${u.staffRole ? ` · <span class="text-brand">команда</span>` : ''}</div>
          </div>
        </div>
        ${u.status === 'blocked' ? '<div class="text-xs font-bold text-si">Заблокирован</div>' : ''}
        ${row('Номер', `<button onclick="SF.copyText('${SF.js(u.supportCode || '')}', 'Скопировано')" class="font-mono font-bold">${esc(u.supportCode || '—')}</button>`)}
        ${row('ID в базе', `<button onclick="SF.copyText('${SF.js(u.id)}', 'Скопировано')" class="font-mono">${esc(u.id)}</button>`)}
        ${row('Telegram id', esc(u.telegramId || '—'))}
        ${row('Имя в Telegram', esc(u.telegramName))}
        ${row('Своё имя в приложении', esc(u.customName || '—'))}
        ${row('Зарегистрирован(а)', fmtTime(u.createdAt))}
        ${row('Последний вход', fmtTime(u.lastSeenAt))}
        ${row('Бот может писать', u.botCanWrite === true ? 'да' : u.botCanWrite === false ? '<span class="text-si">нет — уведомления не доходят</span>' : 'неизвестно')}
        ${row('Бизнес-профиль (Офис)', u.businessAgreedAt ? 'включён' : 'нет')}
        ${row('Кэш телефона очищали', fmtTime(u.clientResetAt))}
      `)}

      ${card(`
        <div class="text-xs font-bold text-ink">Быстрые действия</div>
        <div class="grid grid-cols-2 gap-2">
          ${fixBtn(u.id, 'reset_device', 'Очистить данные на телефоне', {}, 'tiffany')}
          ${btn('Написать в Telegram', `SF.admin.messageUser('${SF.js(u.id)}')`, 'dark', { icon: 'send' })}
          ${u.customName ? fixBtn(u.id, 'reset_name', 'Вернуть имя из Telegram') : ''}
          ${u.hasUploadedPhoto ? fixBtn(u.id, 'remove_photo', 'Удалить фото') : ''}
          ${isOwner && !u.staffRole ? fixBtn(u.id, 'block_user', u.status === 'blocked' ? 'Разблокировать' : 'Заблокировать', { blocked: u.status !== 'blocked' }) : ''}
        </div>
      `)}

      ${section('Жалобы', d.feedback, f => `
        <button onclick="SF.push('admin-feedback', { id: '${SF.js(f.id)}' })" class="w-full text-left text-[11px] flex justify-between gap-2">
          <span class="text-ink-2 truncate">${esc(f.text)}</span>
          <span class="${STATUS_CLASS[f.status]} flex-shrink-0">${FEEDBACK_STATUS[f.status] || ''}</span>
        </button>`)}

      ${section('Последние ошибки', d.errors, e => `
        <div class="text-[11px] flex gap-2">
          <span class="font-mono font-bold text-brand flex-shrink-0">${esc(e.code)}</span>
          <span class="text-ink-2 break-all">${e.source === 'client' ? 'телефон' : 'сервер'} · ${esc(e.method || '')} ${esc(e.path || '')} ${e.status ? `· ${esc(e.status)}` : ''} · ${esc(e.message)} <span class="text-faint">· ${fmtTime(e.createdAt)}</span></span>
        </div>`)}

      ${section('SI-продавцы', d.consultants, c => `
        <div class="space-y-1.5 pb-2 border-b border-line last:border-0">
          <div class="flex justify-between gap-2 text-xs">
            <span class="font-bold text-ink">${esc(c.name)}${c.isDemo ? ' (демо)' : ''}</span>
            <span class="${c.status === 'active' ? 'text-brand' : 'text-si'}">${c.status === 'active' ? 'включён' : 'выключен'}</span>
          </div>
          <div class="text-[10px] text-muted">${c.isListed ? 'в Маркетплейсе' : 'не в Маркетплейсе'} · клиентов ${c.clients} · SI молчит у ${c.siPaused} · ждут эксперта ${c.waitingInquiries}${!c.hasOffer ? ' · <span class="text-si">нет оффера</span>' : ''}${!c.paymentUrl ? ' · нет ссылки на оплату' : ''}</div>
          <div class="flex flex-wrap gap-1.5">
            ${fixBtn(u.id, 'consultant_listing', c.isListed ? 'Скрыть из Маркетплейса' : 'Показать в Маркетплейсе', { projectId: c.id, listed: !c.isListed })}
            ${fixBtn(u.id, 'consultant_status', c.status === 'active' ? 'Выключить' : 'Включить', { projectId: c.id, active: c.status !== 'active' })}
            ${c.photoUrl ? fixBtn(u.id, 'consultant_remove_photo', 'Удалить фото', { projectId: c.id }) : ''}
            ${btn('Ссылка', `SF.copyText('${SF.js(c.link)}')`)}
          </div>
        </div>`)}

      ${section('SI-мозг (материалы)', d.materials, m => `
        <div class="text-[11px] flex justify-between gap-2">
          <span class="text-ink-2 truncate">${esc(m.title)} · ${m.chunks} частей · у ${m.consultants} SI</span>
          <span class="${m.pending ? 'text-si' : 'text-faint'} flex-shrink-0">${m.pending ? `не обработано ${m.pending}` : 'обработан'}</span>
        </div>`, d.materials.some(m => m.pending) ? fixBtn(u.id, 'brain_process', 'Досчитать SI-мозг', {}, 'tiffany') : '')}

      ${section('Его/её чаты с SI (как клиент)', d.chatsAsClient, c => chatRow(u.id, c, c.consultantName, c.consultantActive ? '' : ' · SI-продавец выключен'))}
      ${section('Клиенты его/её SI-продавцов', d.myClients, c => chatRow(u.id, c, `${c.name}${c.username ? ` (@${c.username})` : ''} → ${c.consultantName}`, ''))}

      ${section('Что команда уже делала', d.actions, a => `
        <div class="text-[11px] text-ink-2">${fmtTime(a.createdAt)} · ${esc(a.staffName)} ${actionLabel(a)}</div>`)}
    `;
  }

  function chatRow(userId, c, title, extra) {
    return `
      <div class="space-y-1 pb-2 border-b border-line last:border-0">
        <div class="text-[11px] text-ink-2">${esc(title)} · ${c.messages} сообщ. · ${fmtTime(c.lastActivity)}${extra}</div>
        <div class="flex flex-wrap gap-1.5 items-center">
          ${c.siPaused ? `<span class="text-[10px] text-si font-semibold">SI молчит</span>${fixBtn(userId, 'resume_si', 'Включить SI', { clientId: c.clientId })}` : ''}
          ${btn('Открыть переписку', `SF.push('admin-chat', { id: '${SF.js(userId)}', clientId: '${SF.js(c.clientId)}' })`)}
        </div>
      </div>`;
  }

  function section(title, items, renderItem, footer = '') {
    return card(`
      <div class="text-xs font-bold text-ink">${title} <span class="text-faint font-normal">${items.length}</span></div>
      ${items.length ? items.map(renderItem).join('') : '<div class="text-[11px] text-faint">Нет</div>'}
      ${footer}
    `);
  }

  function renderChat(route) {
    const key = `chat:${route.clientId}`;
    const d = cache[key];
    if (!d) return loading(key);
    const who = { client: 'Клиент', ai: 'SI', expert_human: 'Эксперт лично' };
    return `
      <div class="text-[10px] text-faint px-1">Только чтение. Просмотр записан в журнал команды.</div>
      ${card(`
        <div class="text-xs font-bold text-ink">«${esc(d.chat.consultantName)}» ↔ ${esc(d.chat.clientName)}</div>
        <div class="text-[11px] ${d.chat.siPaused ? 'text-si' : 'text-muted'}">${d.chat.siPaused ? 'SI сейчас молчит (ждёт эксперта)' : 'SI отвечает'}</div>
      `)}
      <div class="space-y-2">
        ${d.messages.length ? d.messages.map(m => `
          <div class="${m.sender === 'client' ? 'chat-bubble-human ml-8' : m.sender === 'ai' ? 'chat-bubble-si mr-8' : 'chat-bubble-expert mr-8'}">
            <div class="text-[9px] font-semibold opacity-70">${who[m.sender] || esc(m.sender)} · ${fmtTime(m.createdAt)}</div>
            ${SF.formatChatMarkdown(m.text)}
          </div>`).join('') : '<div class="text-xs text-muted">Сообщений нет</div>'}
      </div>
    `;
  }

  // ---------------- Errors ----------------
  function renderErrors(route) {
    const code = route.code || '';
    const key = `errors:${code}`;
    const list = cache[key];
    return `
      <form onsubmit="SF.admin.searchErrors(event)" class="flex gap-2">
        <input name="code" value="${esc(code)}" maxlength="4" autocomplete="off" placeholder="Код с экрана, например K7P2" class="flex-1 p-2.5 rounded-xl bg-sunken border border-line-2 text-ink text-xs uppercase" />
        <button type="submit" class="px-3 rounded-xl btn-3d-tiffany text-xs" aria-label="Найти"><i data-lucide="search" class="w-4 h-4"></i></button>
      </form>
      <div class="text-[10px] text-faint px-1">${code ? `Ошибки с кодом ${esc(code)}` : 'Последние 100 ошибок. Сервер — ошибка на Railway; телефон — сбой приложения или нет связи.'}</div>
      ${!list ? loading(key) : !list.length ? SF.emptyState('assistant', 'Не нашли', code ? 'Такого кода нет. Проверьте буквы: в кодах нет О/0 и I/1. Ошибки «нет связи» попадают сюда, только когда связь вернулась.' : 'Ошибок нет.') : list.map(e => card(`
        <div class="flex justify-between gap-2 text-[11px]">
          <span class="font-mono font-bold text-brand">${esc(e.code)}</span>
          <span class="text-faint">${e.source === 'client' ? 'телефон' : 'сервер'} · ${fmtTime(e.createdAt)}</span>
        </div>
        ${row('Человек', personLine(e.user))}
        ${row('Где', `${esc(e.method || '')} ${esc(e.path || '—')}${e.status ? ` · ${esc(e.status)}` : ''}`)}
        <div class="text-[11px] text-ink-2 break-all">${esc(e.message)}</div>
        ${e.context && e.context.stack ? `<details class="text-[10px] text-faint"><summary>Подробности</summary><pre class="whitespace-pre-wrap">${esc(e.context.stack)}</pre></details>` : ''}
      `)).join('')}
    `;
  }

  // ---------------- Team log ----------------
  function renderActions() {
    const list = cache.actions;
    if (!list) return loading('actions');
    return list.length ? list.map(a => `
      <div class="glass-card-3d p-3 space-y-0.5 text-[11px]">
        <div class="text-faint">${fmtTime(a.createdAt)} · ${esc(a.staffName)}</div>
        <div class="text-ink-2"><b>${esc(a.details.title || a.action)}</b>${a.targetUserId ? ` → <button onclick="SF.push('admin-user', { id: '${SF.js(a.targetUserId)}' })" class="text-brand">${esc(a.targetName || a.targetUserId)}</button>` : ''}</div>
        ${(a.details.changes || []).map(c => `<div class="text-muted">${esc(c.label)}: ${esc(c.before)} → ${esc(c.after)}</div>`).join('')}
        ${a.details.text ? `<div class="text-muted">«${esc(a.details.text)}»</div>` : ''}
      </div>`).join('') : SF.emptyState('assistant', 'Пока пусто', 'Здесь будет всё, что команда исправляла.');
  }

  // ---------------- Team (owner) ----------------
  function renderTeam(route, state) {
    if (state.me.staffRole !== 'owner') return noAccess();
    const list = cache.staff;
    return `
      ${card(`
        <div class="text-xs font-bold text-ink">Добавить в команду поддержки</div>
        <div class="text-[11px] text-muted leading-relaxed">Человек открывает SmartFlow → Профиль, внизу его номер вида SF-48213. Впишите номер — у него появится «Панель поддержки». Всё, что он делает, видно в «Журнале команды».</div>
        <form onsubmit="SF.admin.addStaff(event)" class="flex gap-2">
          <input name="code" autocomplete="off" placeholder="SF-48213" class="flex-1 p-2.5 rounded-xl bg-sunken border border-line-2 text-ink text-xs" />
          <button type="submit" class="px-3 rounded-xl btn-3d-tiffany text-xs">Добавить</button>
        </form>
      `)}
      ${card(`
        <div class="text-xs font-bold text-ink">Ссылка для входа в панель</div>
        <div class="text-[11px] text-muted leading-relaxed">Отправьте её студенту. Он открывает её в своём Telegram (на телефоне или в Telegram Desktop на компьютере) — сразу открывается панель. Без вашего «Добавить» он увидит только «Панель только для команды».</div>
        <div class="text-[11px] font-mono text-ink-2 break-all">${PANEL_LINK}</div>
        ${btn('Скопировать ссылку', `SF.copyText('${PANEL_LINK}', 'Ссылка скопирована')`, 'tiffany', { icon: 'copy' })}
      `)}
      ${!list ? loading('staff') : list.map(p => `
        <div class="glass-card-3d p-3 flex items-center gap-2.5">
          ${SF.avatar(p.photoUrl, { size: 36, kind: 'human' })}
          <div class="flex-1 min-w-0">
            <div class="text-xs font-bold text-ink truncate">${esc(p.displayName)}</div>
            <div class="text-[10px] text-muted">${esc(p.supportCode || '')} · ${esc(p.roleLabel)}</div>
          </div>
          ${p.fromSettings ? '<span class="text-[10px] text-faint">ADMIN_USERS</span>' : `<button onclick="SF.admin.removeStaff('${SF.js(p.id)}', '${SF.js(p.displayName)}')" class="px-2.5 py-1.5 rounded-xl btn-3d-dark text-[11px]">Убрать</button>`}
        </div>`).join('')}
    `;
  }

  // ---------------- How to fix (for a new team member) ----------------
  function renderHelp() {
    const step = (n, title, text) => `
      <div class="flex gap-2.5">
        <span class="w-6 h-6 rounded-full bg-[#81D8D0] text-[#08302c] text-xs font-bold flex items-center justify-center flex-shrink-0">${n}</span>
        <div><div class="text-xs font-bold text-ink">${title}</div><div class="text-[11px] text-ink-2 leading-relaxed">${text}</div></div>
      </div>`;
    const recipe = (problem, fix) => `<div class="text-[11px] py-1.5 border-b border-line last:border-0"><div class="font-semibold text-ink">${problem}</div><div class="text-muted">${fix}</div></div>`;
    return `
      ${card(`
        <div class="text-sm font-bold text-ink">Как разобрать любую жалобу</div>
        ${step(1, 'Найдите человека', 'По кнопке из жалобы или поиском: номер SF-48213 (внизу его Профиля), @ник или имя. Если человек назвал код ошибки (K7P2) — ищите в «Ошибках».')}
        ${step(2, 'Поймите, где проблема', '<b>Телефон</b> — у других всё работает, у него «зависло» или старые данные. <b>Его данные</b> — что-то не так только в его SI-продавце, чате, фото. <b>Код</b> — одна и та же ошибка у многих людей.')}
        ${step(3, 'Почините', '<b>Телефон</b> → «Очистить данные на телефоне». <b>Данные</b> → кнопка в его карточке; сначала покажется «было → станет» и сколько записей изменится. <b>Код</b> → ничего не меняйте, передайте разработчику код ошибки и номер человека.')}
        ${step(4, 'Ответьте и закройте', 'В жалобе — «Ответить и закрыть»: ответ придёт человеку в чат «Поддержка» и в Telegram.')}
      `)}

      ${card(`
        <div class="text-sm font-bold text-ink">Частые случаи</div>
        ${recipe('«Приложение зависло / показывает старое / пустой экран»', 'Карточка → «Очистить данные на телефоне». Попросите закрыть и открыть приложение.')}
        ${recipe('«SI не отвечает в чате»', 'Карточка → чат → если «SI молчит» — «Включить SI». Если SI отвечает шаблоном у всех — на главной панели «нет ключа OpenAI» → владелице.')}
        ${recipe('«Не приходят уведомления»', 'В карточке «Бот может писать: нет» → попросите: Профиль → «Уведомления в Telegram → Включить».')}
        ${recipe('«SI не знает мои материалы»', 'Карточка → SI-мозг: есть «не обработано» → «Досчитать SI-мозг». Проверьте, что материал открыт нужному SI (у N SI).')}
        ${recipe('«Мой SI-продавец не виден в Маркетплейсе»', 'Нужны оффер и включённый показ. «нет оффера» → эксперт заполняет карточку в Офисе. Скрыт командой → «Показать в Маркетплейсе».')}
        ${recipe('«Клиент не может открыть ссылку»', 'SI-продавец «выключен»? → «Включить». Иначе пришлите разработчику ссылку и номер человека.')}
        ${recipe('Жалоба на обман или неприемлемое', 'Откройте переписку, проверьте. Скрыть из Маркетплейса или выключить SI-продавца. Блокировка — только владелица.')}
        ${recipe('«Ошибка, код …»', '«Ошибки» → вписать код → видно, кто, где и что. Повторяется у многих → разработчику.')}
      `)}

      ${card(`
        <div class="text-sm font-bold text-ink">Правила</div>
        <div class="text-[11px] text-ink-2 leading-relaxed">• Меняем только данные человека из жалобы — кнопки в его карточке ничего не трогают у других.<br/>• Перед подтверждением читаем «было → станет». Ожидали 1 запись, а показывает больше — не подтверждаем, пишем владелице.<br/>• В Supabase руками ничего не правим.<br/>• Переписки открываем только по жалобе: каждый просмотр записывается.<br/>• Не просим у людей пароли, коды из SMS и ключи.</div>
      `)}
    `;
  }

  // ---------------- Actions ----------------
  const parseParams = (json) => {
    try {
      return JSON.parse(json || '{}');
    } catch (e) {
      return {};
    }
  };

  // Preview → modal "было → станет" → apply with the number of records seen
  async function fix(userId, fixId, paramsJson) {
    const params = parseParams(paramsJson);
    let preview;
    try {
      preview = (await api().admin.previewFix(userId, fixId, params)).preview;
    } catch (err) {
      showToast(err.message || 'Не получилось');
      return;
    }
    SF.admin.pending = { userId, fixId, params, count: preview.count };
    SF.openModal(`
      <div class="text-sm font-bold text-ink">${esc(preview.title)}</div>
      <div class="text-[11px] text-muted leading-relaxed">${esc(preview.help)}</div>
      <div class="space-y-1.5">
        ${preview.changes.map(c => `
          <div class="p-2.5 rounded-xl bg-sunken border border-line text-[11px] space-y-0.5">
            <div class="font-semibold text-ink">${esc(c.label)}</div>
            <div><span class="text-muted">было:</span> <span class="text-ink-2">${esc(c.before)}</span></div>
            <div><span class="text-muted">станет:</span> <span class="text-brand font-semibold">${esc(c.after)}</span></div>
          </div>`).join('')}
      </div>
      ${preview.blocked
        ? `<div class="text-xs text-si font-semibold">${esc(preview.blocked)}</div>
           <button onclick="SF.closeModal()" class="w-full py-2.5 rounded-xl btn-3d-dark text-xs">Понятно</button>`
        : `<div class="text-xs text-ink">Изменится записей: <b>${preview.count}</b> — только у этого человека.</div>
           <div class="grid grid-cols-2 gap-2">
             <button onclick="SF.closeModal()" class="py-2.5 rounded-xl btn-3d-dark text-xs">Отмена</button>
             <button onclick="SF.admin.confirmFix()" class="py-2.5 rounded-xl btn-3d-tiffany text-xs">Подтвердить</button>
           </div>`}
    `);
  }

  async function confirmFix() {
    const p = SF.admin.pending;
    if (!p) return;
    SF.admin.pending = null;
    SF.closeModal();
    try {
      const res = await api().admin.applyFix(p.userId, p.fixId, p.params, p.count);
      showToast(res.result.result ? `Готово. ${res.result.result}` : 'Готово');
    } catch (err) {
      showToast(err.message || 'Не получилось');
    }
    refresh(`user:${p.userId}`);
  }

  function messageUser(userId) {
    SF.openModal(`
      <div class="text-sm font-bold text-ink">Написать человеку в Telegram</div>
      <div class="text-[11px] text-muted">Бот пришлёт сообщение с подписью «Поддержка SmartFlow». Дойдёт, только если человек разрешил боту писать.</div>
      <form onsubmit="SF.admin.sendMessage(event, '${SF.js(userId)}')" class="space-y-2">
        <textarea name="text" rows="4" maxlength="2000" class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink text-xs" placeholder="Здравствуйте! Это поддержка SmartFlow…"></textarea>
        <button type="submit" class="w-full py-2.5 rounded-xl btn-3d-tiffany text-xs">Отправить</button>
      </form>
    `);
  }

  async function sendMessage(e, userId) {
    e.preventDefault();
    const text = e.target.text.value.trim();
    if (!text) return;
    try {
      const res = await api().admin.message(userId, text);
      SF.closeModal();
      showToast(res.notified ? 'Отправлено в Telegram' : 'Не дошло: человек не разрешил боту писать');
    } catch (err) {
      showToast(err.message || 'Не отправилось');
    }
    refresh(`user:${userId}`);
  }

  async function reply(e, feedbackId) {
    e.preventDefault();
    const text = e.target.text.value.trim();
    if (!text) return showToast('Напишите ответ');
    const close = e.submitter && e.submitter.value === '1';
    try {
      const res = await api().admin.replyFeedback(feedbackId, text, close);
      e.target.text.value = '';
      cache[`fb:${feedbackId}`] = res.feedback;
      showToast(res.notified ? 'Ответ отправлен' : 'Ответ сохранён в чате «Поддержка» (в Telegram не дошёл: бот не может писать)');
    } catch (err) {
      showToast(err.message || 'Не отправилось');
    }
    refresh('feedback:');
    refresh('overview');
  }

  async function saveNote(e, feedbackId) {
    e.preventDefault();
    const status = e.submitter && e.submitter.value;
    try {
      const res = await api().admin.updateFeedback(feedbackId, { note: e.target.note.value, status });
      cache[`fb:${feedbackId}`] = res.feedback;
      showToast('Сохранено');
    } catch (err) {
      showToast(err.message || 'Не сохранилось');
    }
    refresh('feedback:');
    refresh('overview');
  }

  // One search box on the home screen: an error code (4 signs with a digit) or a person
  function search(e) {
    e.preventDefault();
    const q = e.target.q.value.trim();
    if (!q) return;
    if (/^[A-Za-z0-9]{4}$/.test(q) && /\d/.test(q) && /[A-Za-z]/.test(q)) {
      SF.push('admin-errors', { code: q.toUpperCase() });
    } else {
      SF.push('admin-users', { q });
    }
  }

  function searchUsers(e) {
    e.preventDefault();
    SF.patch({ q: e.target.q.value.trim() });
  }

  function searchErrors(e) {
    e.preventDefault();
    SF.patch({ code: e.target.code.value.trim().toUpperCase() });
  }

  async function addStaff(e) {
    e.preventDefault();
    try {
      const res = await api().admin.addStaff(e.target.code.value.trim());
      showToast(`${res.user.displayName} в команде`);
    } catch (err) {
      showToast(err.message || 'Не получилось');
    }
    refresh('staff');
  }

  async function removeStaff(userId, name) {
    if (!confirm(`Убрать ${name} из команды? Панель поддержки у него пропадёт.`)) return;
    try {
      await api().admin.removeStaff(userId);
      showToast('Убран(а) из команды');
    } catch (err) {
      showToast(err.message || 'Не получилось');
    }
    refresh('staff');
  }

  // ---------------- Screen ----------------
  const TITLES = {
    admin: 'Панель поддержки',
    'admin-feedback-list': 'Жалобы',
    'admin-feedback': 'Жалоба',
    'admin-users': 'Люди',
    'admin-user': 'Карточка человека',
    'admin-chat': 'Переписка',
    'admin-errors': 'Ошибки',
    'admin-actions': 'Журнал команды',
    'admin-team': 'Команда',
    'admin-help': 'Как чинить'
  };

  const RENDER = {
    admin: renderHome,
    'admin-feedback-list': renderFeedbackList,
    'admin-feedback': renderFeedback,
    'admin-users': renderUsers,
    'admin-user': renderUser,
    'admin-chat': renderChat,
    'admin-errors': renderErrors,
    'admin-actions': renderActions,
    'admin-team': renderTeam,
    'admin-help': renderHelp
  };

  function afterRender(route, state) {
    if (!state.me.staffRole) return;
    const a = api().admin;
    switch (route.screen) {
      case 'admin': return load('overview', () => a.overview());
      case 'admin-feedback-list': {
        const status = route.status || 'new';
        return load(`feedback:${status}`, async () => (await a.feedbackList(status === 'all' ? '' : status)).feedback);
      }
      case 'admin-feedback': return load(`fb:${route.id}`, async () => (await a.feedback(route.id)).feedback);
      case 'admin-users': return load(`users:${route.q || ''}`, async () => (await a.users(route.q || '')).users);
      case 'admin-user': return load(`user:${route.id}`, () => a.user(route.id));
      case 'admin-chat': return load(`chat:${route.clientId}`, () => a.chat(route.id, route.clientId), 60000);
      case 'admin-errors': return load(`errors:${route.code || ''}`, async () => (await a.errors(route.code || '')).errors);
      case 'admin-actions': return load('actions', async () => (await a.actions()).actions);
      case 'admin-team': return load('staff', async () => (await a.staff()).staff);
      default: return null;
    }
  }

  SF.admin = {
    title: (route) => TITLES[route.screen] || 'Панель поддержки',
    render: (route, state) => {
      if (!state.me.staffRole && route.screen !== 'admin-help') {
        return state.auth?.status === 'checking' ? '<div class="text-xs text-muted px-1">Проверяю вход…</div>' : noAccess();
      }
      return (RENDER[route.screen] || renderHome)(route, state);
    },
    afterRender,
    refresh: () => refresh(),
    pending: null,
    fix,
    confirmFix,
    messageUser,
    sendMessage,
    reply,
    saveNote,
    search,
    searchUsers,
    searchErrors,
    addStaff,
    removeStaff
  };
})(window);
