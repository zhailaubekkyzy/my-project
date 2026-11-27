// design.js - SmartFlow design system: base components (HTML strings) and the new look switch.
//
// Tokens and styles live in css/design.css; mockups in docs/design/ (Palette, MK-Components).
// The new look is a flag: Railway FEATURES=design-v2:beta + BETA_USERS → <html data-design="v2">
// (calm neutrals and Golos Text for the whole app). Screens move to these components one by one
// (docs/ARCHITECTURE.md, «Внедрение дизайна», step 2) — logic and data are never changed for that.
//
// Rules from the spec: one main (red) button per screen; red = urgent, turquoise = good news; a disabled button
// always says why; every screen has 4 states: loading (skeleton) · empty (one phrase + one button) ·
// error (human words + «Повторить», what was loaded stays) · normal. All text people typed goes through esc().
(function (window) {
  const SF = window.SF = window.SF || {};
  const FLAG = 'design-v2';
  const FONT_URL = 'https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700;800&display=swap';

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  // onclick="..." is code written by us, never text typed by people; escaped only to stay a valid attribute
  const handler = (code) => (code ? ` onclick="${esc(code)}"` : '');
  const iconTag = (name, cls = '') => (name ? `<i data-lucide="${esc(name)}"${cls ? ` class="${cls}"` : ''} aria-hidden="true"></i>` : '');

  // ---------------- The new look (only BETA_USERS while the flag is beta) ----------------
  function on() {
    return Boolean(SF.feature && SF.feature(FLAG));
  }

  function loadFont(doc) {
    if (doc.getElementById('ds-font')) return;
    const link = doc.createElement('link');
    link.id = 'ds-font';
    link.rel = 'stylesheet';
    link.href = FONT_URL;
    doc.head.appendChild(link);
  }

  // Called before every render: cheap, changes the page only when the flag changed
  function apply(doc = window.document) {
    const root = doc && doc.documentElement;
    if (!root) return false;
    const wanted = on();
    const now = root.getAttribute('data-design') === 'v2';
    if (wanted === now) return wanted;
    if (wanted) {
      root.setAttribute('data-design', 'v2');
      loadFont(doc);
    } else {
      root.removeAttribute('data-design');
    }
    // Telegram's own header and background follow the page colour
    if (typeof window.SFApplyTheme === 'function') window.SFApplyTheme();
    return wanted;
  }

  // ---------------- Components ----------------

  // variant: primary (red, one per screen) · dark · outline · quiet · good (turquoise)
  // A disabled button always says why: pass `reason`.
  function button({ text, variant = 'primary', size = '', block = false, onclick = '', disabled = false, reason = '', icon = '', type = 'button', label = '' } = {}) {
    const cls = ['ds-btn', `ds-btn-${variant}`, size === 'lg' ? 'ds-btn-lg' : '', block ? 'ds-btn-block' : ''].filter(Boolean).join(' ');
    const btn = `<button type="${type === 'submit' ? 'submit' : 'button'}" class="${cls}"${handler(disabled ? '' : onclick)}${disabled ? ' disabled' : ''}${label ? ` aria-label="${esc(label)}"` : ''}>${iconTag(icon, 'w-5 h-5')}${esc(text)}</button>`;
    if (!disabled) return btn;
    return `<div${block ? '' : ' class="inline-block"'}>${btn}<span class="ds-btn-reason">${esc(reason || 'Пока недоступно')}</span></div>`;
  }

  let fieldSeq = 0;
  function field({ label = '', name = '', value = '', placeholder = '', hint = '', error = '', multiline = false, type = 'text', maxlength = 0, required = false, id = '' } = {}) {
    const fid = id || `ds-f${++fieldSeq}`;
    const hintId = hint || error ? `${fid}-hint` : '';
    const common = `id="${esc(fid)}" class="ds-input"${name ? ` name="${esc(name)}"` : ''}${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}` +
      `${maxlength ? ` maxlength="${Number(maxlength)}"` : ''}${required ? ' required' : ''}${error ? ' aria-invalid="true"' : ''}${hintId ? ` aria-describedby="${hintId}"` : ''}`;
    const control = multiline
      ? `<textarea ${common}>${esc(value)}</textarea>`
      : `<input type="${esc(type)}" ${common} value="${esc(value)}" />`;
    return `
      <div class="ds-field${error ? ' ds-field-error' : ''}">
        ${label ? `<label class="ds-label" for="${esc(fid)}">${esc(label)}</label>` : ''}
        ${control}
        ${hintId ? `<span id="${hintId}" class="ds-hint">${esc(error || hint)}</span>` : ''}
      </div>`;
  }

  function search({ placeholder = 'Поиск', name = 'q', value = '', label = 'Поиск' } = {}) {
    return `<label class="ds-search">${iconTag('search')}<input type="search" class="ds-input" name="${esc(name)}" value="${esc(value)}" placeholder="${esc(placeholder)}" aria-label="${esc(label)}" /></label>`;
  }

  // inner is HTML built by the caller (already escaped)
  function card(inner, { fog = false, onclick = '' } = {}) {
    const cls = ['ds-card', fog ? 'ds-card-fog' : '', onclick ? 'ds-card-press' : ''].filter(Boolean).join(' ');
    return onclick
      ? `<div role="button" tabindex="0" class="${cls}"${handler(onclick)}>${inner}</div>`
      : `<div class="${cls}">${inner}</div>`;
  }

  // tone: good (turquoise: bought, paid) · neutral («мало данных») · new · warn (a warning, never an ad)
  const BADGE_TONES = ['good', 'neutral', 'new', 'warn'];
  function badge(text, tone = 'neutral') {
    return `<span class="ds-badge ds-badge-${BADGE_TONES.includes(tone) ? tone : 'neutral'}">${esc(text)}</span>`;
  }

  // Unread / waiting counter: red, because it is urgent
  function count(n) {
    const value = Math.max(0, Math.floor(Number(n) || 0));
    if (!value) return '';
    return `<span class="ds-count">${value > 99 ? '99+' : value}</span>`;
  }

  // Client statuses — the names used in the Office (not renamed yet: docs/spec.md, decision 27 Nov., item 1)
  const STATUSES = {
    waiting_human: { label: 'Ждут человека', cls: 'waiting' },
    objections: { label: 'Есть возражения', cls: 'objection' },
    not_finished: { label: 'Не дошли до конца воронки', cls: 'unfinished' },
    bought: { label: 'Купили', cls: 'bought' },
    refused: { label: 'Отказ', cls: 'refused' }
  };
  function status(id) {
    const s = STATUSES[id] || STATUSES.not_finished;
    return `<span class="ds-status ds-status-${s.cls}">${esc(s.label)}</span>`;
  }

  // Chat header: name, and the role pale gray under it (always starts with «ИИ-», decision 27 Nov.)
  function chatHead({ name = '', role = '', photo = '' } = {}) {
    const avatar = photo ? `<img src="${esc(photo)}" alt="" width="44" height="44" style="width:44px;height:44px;border-radius:50%;object-fit:cover;flex-shrink:0" />` : '';
    return `
      <div class="ds-chat-head">
        ${avatar}
        <span style="flex:1;min-width:0;display:flex;flex-direction:column">
          <span class="ds-chat-name">${esc(name)}</span>
          ${role ? `<span class="ds-role">${esc(role)}</span>` : ''}
        </span>
      </div>`;
  }

  // mine: my own message (ink). Otherwise incoming (fog). author + expert: «Имя · эксперт» with the check mark.
  function bubble(text, { mine = false, author = '', expert = false, time = '' } = {}) {
    const head = author ? `<span class="ds-bubble-author">${esc(author)}${expert ? iconTag('badge-check') : ''}</span>` : '';
    return `<div class="ds-bubble ${mine ? 'ds-bubble-mine' : 'ds-bubble-in'}">${head}${esc(text)}${time ? `<span class="ds-bubble-time">${esc(time)}</span>` : ''}</div>`;
  }

  // Ready answers for the client: pressing one = sending it as their message (decision 27 Nov., item 8)
  function replies(list = [], { selected = -1, onclick = '' } = {}) {
    if (!list.length) return '';
    return `<div class="ds-replies">${list.map((text, i) =>
      `<button type="button" class="ds-reply" aria-pressed="${i === selected}"${handler(onclick ? onclick.replace('$i', String(i)) : '')}>${esc(text)}</button>`).join('')}</div>`;
  }

  function typing() {
    return '<div class="ds-bubble ds-bubble-in" aria-label="печатает…"><span class="ds-typing"><span></span><span></span><span></span></span></div>';
  }

  // Bottom menu. tabs: [{ id, label, icon, count, buddy }]; the Buddy tab shows the mascot.
  function tabbar(tabs = [], active = '', { onclick = '' } = {}) {
    return `
      <nav class="ds-tabbar" aria-label="Основное меню">
        ${tabs.map(t => {
          const isActive = t.id === active;
          const inner = t.buddy
            ? `<img src="images/mascots/si-buddy.webp" alt="" />`
            : iconTag(t.icon);
          return `<button type="button" class="ds-tab${isActive ? ' active' : ''}${t.buddy ? ' ds-tab-buddy' : ''}"${isActive ? ' aria-current="page"' : ''}${handler(onclick ? onclick.replace('$id', t.id) : '')}>${inner}<span>${esc(t.label)}</span>${count(t.count)}</button>`;
        }).join('')}
      </nav>`;
  }

  // Loading: the skeleton repeats the shape of real cards, so the screen does not jump when data arrives
  function skeleton({ rows = 3, thumb = true } = {}) {
    const widths = [[90, 60, 40], [80, 50, 45], [85, 55, 35]];
    const row = (i) => {
      const [a, b, c] = widths[i % widths.length];
      return `<div class="ds-skel-row">${thumb ? '<span class="ds-skel ds-skel-thumb"></span>' : ''}<div class="ds-skel-lines">` +
        `<span class="ds-skel ds-skel-line" style="width:${a}%"></span><span class="ds-skel ds-skel-line" style="width:${b}%"></span>` +
        `<span class="ds-skel ds-skel-line ds-skel-soft" style="width:${c}%"></span></div></div>`;
    };
    return `<div class="ds-stack" style="gap:14px" aria-busy="true" aria-label="Загрузка">${Array.from({ length: rows }, (_, i) => row(i)).join('')}</div>`;
  }

  // Empty: one phrase why it is empty and ONE button further
  function empty({ title = '', text = '', button: btn = null, mascot = 'images/mascots/si-buddy.webp' } = {}) {
    return `
      <div class="ds-empty">
        ${mascot ? `<img src="${esc(mascot)}" alt="" />` : ''}
        ${title ? `<span class="ds-empty-title">${esc(title)}</span>` : ''}
        ${text ? `<span class="ds-empty-text">${esc(text)}</span>` : ''}
        ${btn ? button({ variant: 'dark', ...btn, block: true }) : ''}
      </div>`;
  }

  // Error: human words + «Повторить»; shown above what was already loaded, never instead of it
  function error({ text = 'Не получилось загрузить. Проверьте интернет.', retry = '', code = '' } = {}) {
    return `
      <div class="ds-error" role="alert">
        <span class="ds-error-text">${esc(text)}${code ? ` (код ${esc(code)})` : ''}</span>
        ${retry ? button({ text: 'Повторить', variant: 'outline', onclick: retry }) : ''}
      </div>`;
  }

  // ---------------- Showcase: Настройки → «Дизайн-система» (only with the flag) ----------------
  // Sample texts only: no invented people, ratings or numbers.
  const PALETTE = [
    ['red', 'Красный', 'срочное, главная кнопка'],
    ['teal', 'Бирюза', 'хорошие новости'],
    ['ink', 'Чернила', 'текст'],
    ['fog', 'Туман', 'фон блоков'],
    ['line', 'Линии', 'границы'],
    ['muted', 'Второстепенный', 'подписи'],
    ['surface', 'Белый', 'карточки']
  ];
  let preview = ''; // '' = like the app, 'light' / 'dark' = forced for this page only
  let pickedReply = 0;
  let fieldError = false;

  const section = (title, body) => `<section class="ds-section"><h2 class="ds-h2">${esc(title)}</h2>${body}</section>`;

  function renderShowcase() {
    const themeCls = preview ? `ds-theme-${preview}` : '';
    const swatches = PALETTE.map(([token, name, use]) => `
      <div class="ds-swatch">
        <div class="ds-swatch-chip" style="background:var(--ds-${token})"></div>
        <span style="font-size:13px;font-weight:700">${esc(name)}</span>
        <span class="ds-small">${esc(use)}</span>
      </div>`).join('');
    const spaces = [[1, 4, 'внутри бейджа'], [2, 8, 'между бейджами'], [3, 12, 'превью ↔ текст'], [4, 16, 'край экрана'], [6, 24, 'между секциями']]
      .map(([k, px, use]) => `<div class="ds-row" style="gap:10px;font-size:13px"><span class="ds-space-bar" style="width:var(--ds-space-${k})"></span>${px} — ${esc(use)}</div>`).join('');
    const radii = [['xs', 6, 'бейдж'], ['sm', 8, 'фильтр'], ['md', 12, 'кнопка, поле'], ['lg', 16, 'карточка'], ['xl', 20, 'панель']]
      .map(([k, px, use]) => `<div class="ds-stack" style="align-items:center;gap:4px"><span class="ds-radius-box" style="border-radius:var(--ds-radius-${k})"></span><span class="ds-small">${px} · ${esc(use)}</span></div>`).join('');
    const tabs = [
      { id: 'community', label: 'Комьюнити', icon: 'users' },
      { id: 'marketplace', label: 'Маркетплейс', icon: 'store' },
      { id: 'buddy', label: 'Бадди', buddy: true },
      { id: 'chats', label: 'Чаты', icon: 'messages-square', count: 3 },
      { id: 'profile', label: 'Настройки', icon: 'settings' }
    ];

    return `
      <div class="ds ds-showcase ${themeCls}" data-no-tr>
        <div class="ds-stack">
          <h1 class="ds-h1">Дизайн-система</h1>
          <span class="ds-meta">Все базовые детали нового вида. Тексты — примеры. Видно только тем, у кого включён новый вид.</span>
          <div class="ds-switch" role="group" aria-label="Тема">
            ${[['', 'Как в приложении'], ['light', 'Светлая'], ['dark', 'Тёмная']].map(([id, label]) =>
              `<button type="button" aria-pressed="${preview === id}" onclick="SF.actions.dsPreview('${id}')">${esc(label)}</button>`).join('')}
          </div>
        </div>

        ${section('Палитра', `
          <div class="ds-grid">${swatches}</div>
          <div class="ds-stack ds-meta" style="color:var(--ds-ink-2)">
            <span><b>Красный</b> — только то, что важно сейчас: клиенты ждут, главная кнопка.</span>
            <span><b>Бирюза</b> — хорошие новости: купили, оплачено, цель достигнута.</span>
            <span><b>Чернила и туман</b> — всё остальное. Чем спокойнее фон, тем громче красный.</span>
          </div>`)}

        ${section('Шрифт Golos Text', `
          <span class="ds-h1">24 · Экран</span>
          <span class="ds-h2">17 · Секция</span>
          <span class="ds-h3">15 · Карточка</span>
          <span class="ds-meta">13 · Подпись</span>
          <span style="font-size:12px;font-weight:600">12 · Бейдж — самый мелкий текст</span>
          <span class="ds-num" style="font-size:15px">Цифры ровными столбиками: 1 111 · 8 808</span>`)}

        ${section('Отступы и радиусы', `<div class="ds-stack">${spaces}</div><div class="ds-row" style="gap:16px;align-items:flex-start">${radii}</div>`)}

        ${section('Кнопки', `
          ${button({ text: 'Главная кнопка', variant: 'primary', size: 'lg', block: true })}
          <div class="ds-row">
            ${button({ text: 'Тёмная', variant: 'dark' })}
            ${button({ text: 'Обводка', variant: 'outline' })}
            ${button({ text: 'Тихая', variant: 'quiet' })}
            ${button({ text: 'Хорошая новость', variant: 'good', icon: 'check' })}
          </div>
          ${button({ text: 'Опубликовать', variant: 'primary', block: true, disabled: true, reason: 'Сначала заполните описание шаблона' })}
          <span class="ds-small">Главная (красная) кнопка — одна на экран, внизу. Неактивная всегда объясняет почему.</span>`)}

        ${section('Поля', `
          ${search({ placeholder: 'Ниша, продукт или цель' })}
          ${field({ label: 'Название', placeholder: 'Например, «Курс по питанию»', hint: 'Это увидят клиенты' })}
          ${field({ label: 'Ссылка на оплату', value: fieldError ? 'не ссылка' : '', placeholder: 'https://…', error: fieldError ? 'Ссылка должна начинаться с https://' : '', hint: fieldError ? '' : 'Куда клиент пойдёт платить' })}
          ${field({ label: 'Описание', multiline: true, placeholder: 'Что получит клиент' })}
          ${button({ text: fieldError ? 'Убрать ошибку' : 'Показать ошибку в поле', variant: 'quiet', onclick: 'SF.actions.dsToggleError()' })}`)}

        ${section('Карточки', `
          ${card(`<div class="ds-stack"><span class="ds-h3">Название = результат для клиента</span><span class="ds-meta">Имя автора · раздел</span><div class="ds-row">${badge('Бесплатно', 'neutral')}${badge('3 шага', 'neutral')}</div></div>`)}
          ${card('<span class="ds-meta" style="color:var(--ds-ink-2)">Карточка на тумане — для подсказок и вспомогательных блоков.</span>', { fog: true })}`)}

        ${section('Бейджи и счётчик', `
          <div class="ds-row">
            ${badge('N% в покупку', 'good')}
            ${badge('мало данных', 'neutral')}
            ${badge('новинка', 'new')}
            ${badge('падает 3 недели', 'warn')}
            ${count(3)}
          </div>
          <span class="ds-small">Бирюза — только при достаточных данных. Красный бейдж — только предупреждение, не реклама. Счётчик непрочитанного — красный.</span>`)}

        ${section('Статусы клиента', `
          <div class="ds-stack">${Object.keys(STATUSES).map(status).join('')}</div>
          <span class="ds-small">Названия — как сейчас в Офисе (переименование ещё не решено).</span>`)}

        ${section('Чат', `
          <div class="ds-card" style="padding:0;overflow:hidden">
            ${chatHead({ name: 'Имя продавца', role: 'ИИ-консультант' })}
            <div class="ds-chat" style="padding:16px">
              ${bubble('Здравствуйте! Помогу понять, подойдёт ли вам программа. Что для вас сейчас важнее всего?')}
              ${replies(['Первый готовый ответ', 'Второй готовый ответ', 'Третий готовый ответ'], { selected: pickedReply, onclick: 'SF.actions.dsPickReply($i)' })}
              ${bubble('Ответ клиента своими словами', { mine: true, time: '12:30' })}
              ${bubble('Ответ эксперта лично', { author: 'Имя · эксперт', expert: true })}
              ${typing()}
            </div>
          </div>
          <span class="ds-small">Роль «ИИ-…» — бледно-серым под именем. Готовый ответ = сообщение клиента.</span>`)}

        ${section('Нижнее меню', `<div class="ds-card" style="padding:0;overflow:hidden">${tabbar(tabs, 'marketplace')}</div>`)}

        ${section('Четыре состояния экрана', `
          <span class="ds-meta">Загрузка — скелет в форме настоящих карточек</span>
          ${card(skeleton({ rows: 3 }))}
          <span class="ds-meta">Пусто — одна фраза и одна кнопка</span>
          ${card(empty({ title: 'Здесь пока пусто', text: 'Одна фраза, почему пусто и что сделать дальше.', button: { text: 'Одно действие' } }))}
          <span class="ds-meta">Ошибка — по-человечески и «Повторить»; загруженное остаётся</span>
          ${error({ text: 'Нет интернета. Показываем то, что сохранили', retry: "SF.showToast('Здесь экран загрузил бы данные заново')" })}
          <div style="opacity:.55">${card('<span class="ds-h3">Уже загруженная карточка</span>')}</div>`)}
      </div>`;
  }

  SF.actions = SF.actions || {};
  const rerender = () => window.funnelStore && window.funnelStore.notify && window.funnelStore.notify();
  SF.actions.dsPreview = (id) => { preview = ['light', 'dark'].includes(id) ? id : ''; rerender(); };
  SF.actions.dsPickReply = (i) => { pickedReply = Number(i); rerender(); };
  SF.actions.dsToggleError = () => { fieldError = !fieldError; rerender(); };

  SF.ds = {
    FLAG, on, apply,
    button, field, search, card, badge, count, status, STATUSES, chatHead, bubble, replies, typing, tabbar,
    skeleton, empty, error, renderShowcase
  };
})(window);
