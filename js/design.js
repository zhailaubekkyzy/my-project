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

  // variant: primary (red, one per screen) · dark · outline · quiet · good (turquoise: «Записать», «Опубликовать» —
  // owner's decisions 27 Nov.)
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
  function chatHead({ name = '', role = '', photo = '', right = '' } = {}) {
    return `
      <div class="ds-chat-head">
        ${avatar({ name, photo, kind: 'ai' })}
        <span style="flex:1;min-width:0;display:flex;flex-direction:column">
          <span class="ds-chat-name">${esc(name)}</span>
          ${role ? `<span class="ds-role">${esc(role)}</span>` : ''}
        </span>
        ${right}
      </div>`;
  }

  // Messages written by a person are red (owner's decision 27 Nov.): mine — solid red on the right,
  // another person's (the expert writing personally, a friend) — pale red on the left; AI — fog.
  // Red only in chats with AI and personal chats with a person (place: 'chat', the default); in groups
  // (place: 'group') and Комьюнити (place: 'community') the same shapes are turquoise. author + expert: «Имя · эксперт» with the check mark.
  function bubble(text, { mine = false, human = false, author = '', expert = false, time = '', place = 'chat' } = {}) {
    const head = author ? `<span class="ds-bubble-author">${esc(author)}${expert ? iconTag('badge-check') : ''}</span>` : '';
    const cls = (mine ? 'ds-bubble-mine' : `ds-bubble-in${human || expert ? ' ds-bubble-human' : ''}`) +
      (place !== 'chat' && (mine || human || expert) ? ' ds-bubble-teal' : '');
    return `<div class="ds-bubble ${cls}">${head}${esc(text)}${time ? `<span class="ds-bubble-time">${esc(time)}</span>` : ''}</div>`;
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

  // Bottom menu: icons only (owner's decision 27 Nov.), the name is read aloud from aria-label.
  // tabs: [{ id, label, icon, count, buddy }]; the Buddy tab shows the mascot.
  function tabbar(tabs = [], active = '', { onclick = '' } = {}) {
    return `
      <nav class="ds-tabbar" aria-label="Основное меню">
        ${tabs.map(t => {
          const isActive = t.id === active;
          const inner = t.buddy
            ? `<img src="images/mascots/si-buddy.webp" alt="" />`
            : iconTag(t.icon);
          return `<button type="button" class="ds-tab${isActive ? ' active' : ''}${t.buddy ? ' ds-tab-buddy' : ''}"${isActive ? ' aria-current="page"' : ''} aria-label="${esc(t.label)}"${handler(onclick ? onclick.replace('$id', t.id) : '')}>${inner}${count(t.count)}</button>`;
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

  // Tabs with an underline (MK-Catalog): [{ id, label, num }]
  function tabs(list = [], active = '', { onclick = '' } = {}) {
    return `<div class="ds-tabs" role="tablist">${list.map(t =>
      `<button type="button" role="tab" aria-selected="${t.id === active}"${handler(onclick ? onclick.replace('$id', t.id) : '')}>${esc(t.label)}${t.num != null && t.num !== '' ? `<span class="ds-tab-num">${esc(t.num)}</span>` : ''}</button>`).join('')}</div>`;
  }

  // Filter chips: the chosen one is black
  function chips(list = [], active = '', { onclick = '' } = {}) {
    return `<div class="ds-chips">${list.map(c =>
      `<button type="button" class="ds-chip" aria-pressed="${c.id === active}"${handler(onclick ? onclick.replace('$id', c.id) : '')}>${esc(c.label)}</button>`).join('')}</div>`;
  }

  // Step preview on a catalog card: how long the path is and where the sale is (tone: red · teal · fog)
  function thumb({ steps = 0, sale = 0, tone = 'red' } = {}) {
    const n = Math.max(0, Math.floor(Number(steps) || 0));
    const bars = [70, 55, 80].map((w, i) => `<i${i === 1 ? ' class="ds-thumb-sale"' : ''} style="width:${w}%"></i>`).join('');
    const word = n % 10 === 1 && n % 100 !== 11 ? 'шаг' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'шага' : 'шагов');
    return `<div class="ds-thumb${['red', 'teal'].includes(tone) ? ` ds-thumb-${tone}` : ''}" aria-hidden="true">${bars}${n ? `<span>${n} ${word}</span>` : ''}</div>`;
  }

  // A row of a list / catalog (MK-Components «анатомия»): preview · title (2 lines max) · author ✓ · badges · small social proof
  function item({ title = '', meta = '', verified = false, badges = [], foot = '', preview = '', onclick = '' } = {}) {
    return `
      <div class="ds-item"${onclick ? ` role="button" tabindex="0"${handler(onclick)}` : ''}>
        ${preview}
        <div class="ds-item-body">
          <span class="ds-item-title">${esc(title)}</span>
          ${meta ? `<span class="ds-item-meta">${esc(meta)}${verified ? iconTag('badge-check') : ''}</span>` : ''}
          ${badges.length ? `<div class="ds-row" style="gap:6px;margin-top:2px">${badges.map(b => badge(b.text, b.tone)).join('')}</div>` : ''}
          ${foot ? `<span class="ds-item-foot">${esc(foot)}</span>` : ''}
        </div>
      </div>`;
  }
  const list = (items) => `<div class="ds-list">${items.join('')}</div>`;

  // ---------------- Parts from the three roles' mockups (C-*, MK-*, S-*) ----------------

  // Screen header: «назад» in a square, the title, its state under it («Черновик · сохранено только что»), actions
  function screenHead({ title = '', sub = '', back = '', actions = '' } = {}) {
    return `
      <div class="ds-head">
        ${back ? `<button type="button" class="ds-icon-btn" aria-label="Назад"${handler(back)}><i data-lucide="chevron-left" aria-hidden="true"></i></button>` : ''}
        <span class="ds-head-text"><span class="ds-head-title">${esc(title)}</span>${sub ? `<span class="ds-head-sub">${esc(sub)}</span>` : ''}</span>
        ${actions ? `<span class="ds-head-actions">${actions}</span>` : ''}
      </div>`;
  }

  // Photo or initials. kind: 'ai' (the AI seller) · 'person'
  function avatar({ name = '', photo = '', kind = 'person', size = '' } = {}) {
    const initials = (String(name || '').match(/[\p{L}\p{N}]+/gu) || []).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    const cls = `ds-avatar ds-avatar-${kind === 'ai' ? 'ai' : 'person'}${size === 'sm' ? ' ds-avatar-sm' : ''}`;
    return `<span class="${cls}" aria-hidden="true">${photo ? `<img src="${esc(photo)}" alt="" />` : esc(initials || '·')}</span>`;
  }

  // The path of steps — the thread through all three roles: the author builds it, the expert sees it, the client walks it.
  // steps: [{ title, note }]; done: how many are passed (black); sale: the step where people buy (red, with its note).
  function stepPath(steps = [], { done = 0, sale = -1 } = {}) {
    return `<ol class="ds-steps">${steps.map((s, i) => {
      const cls = ['ds-step', i < done ? 'ds-step-done' : '', i === sale ? 'ds-step-sale' : ''].filter(Boolean).join(' ');
      return `<li class="${cls}"><span class="ds-step-num">${i + 1}</span><span class="ds-step-body"><span>${esc(s.title)}</span>${s.note ? `<span class="ds-step-note">${esc(s.note)}</span>` : ''}</span></li>`;
    }).join('')}</ol>`;
  }

  // The author's list of steps in the editor: the chosen one framed, «ваш текст» where the author rewrote it,
  // a red dot where something is missing. steps: [{ title, mine, warn }]
  function stepEditor(steps = [], { current = 0, onclick = '', addLabel = '+ Добавить шаг', onadd = '' } = {}) {
    return `
      <ol class="ds-steps ds-steps-edit">${steps.map((s, i) => {
        const sale = s.warn || i === current;
        return `<li class="ds-step${i === current ? ' ds-step-current' : ''}" role="button" tabindex="0"${i === current ? ' aria-current="step"' : ''}${handler(onclick ? onclick.replace('$i', String(i)) : '')}>
          <span class="ds-step-grip" aria-hidden="true">⋮⋮</span>
          <span class="ds-step-num" style="${sale && i === current ? 'background:var(--ds-red);border-color:var(--ds-red);color:var(--ds-on-red)' : i < current ? 'background:var(--ds-ink);color:var(--ds-on-ink)' : ''}">${i + 1}</span>
          <span class="ds-step-body"><span${i === current ? ' style="font-weight:700"' : ''}>${esc(s.title)}</span></span>
          ${s.mine ? '<span class="ds-step-mine">ваш текст</span>' : ''}${s.warn ? '<span class="ds-step-warn" aria-label="нужно дополнить"></span>' : ''}
        </li>`;
      }).join('')}</ol>
      ${addLabel ? `<button type="button" class="ds-step-add"${handler(onadd)}>${esc(addLabel)}</button>` : ''}`;
  }

  // A row of big numbers divided by lines: [{ value, label, good }]
  function stats(list = []) {
    return `<div class="ds-stats">${list.map(s =>
      `<div class="ds-stat${s.good ? ' ds-stat-good' : ''}"><span class="ds-stat-value">${esc(s.value)}</span><span class="ds-stat-label">${esc(s.label)}</span></div>`).join('')}</div>`;
  }

  // One big number (income): value · under it the period and the change (good = turquoise, bad = red)
  function bigNumber({ value = '', sub = '', delta = '', good = true } = {}) {
    return `<div class="ds-stack" style="gap:2px"><span class="ds-big">${esc(value)}</span>${sub || delta ? `<span class="ds-meta">${esc(sub)}${delta ? ` · <span class="${good ? 'ds-delta-good' : 'ds-delta-bad'}">${esc(delta)}</span>` : ''}</span>` : ''}</div>`;
  }

  // Choice cards with a radio: [{ id, title, sub, right, disabled, reason }]. tiles: 2 in a row (what the client sells).
  function choice(options = [], { selected = '', onclick = '', tiles = false, label = '' } = {}) {
    return `<div class="${tiles ? 'ds-tiles' : 'ds-choices'}" role="radiogroup"${label ? ` aria-label="${esc(label)}"` : ''}>${options.map(o => {
      const on = o.id === selected;
      return `<button type="button" class="ds-choice" role="radio" aria-checked="${on}"${o.disabled ? ' aria-disabled="true"' : handler(onclick ? onclick.replace('$id', o.id) : '')}>
        <span class="ds-radio" aria-hidden="true"></span>
        <span class="ds-choice-body"><span class="ds-choice-title">${esc(o.title)}</span>${o.sub || o.reason ? `<span class="ds-choice-sub">${esc(o.disabled && o.reason ? o.reason : o.sub)}</span>` : ''}</span>
        ${o.right ? `<span class="ds-choice-right">${esc(o.right)}</span>` : ''}
      </button>`;
    }).join('')}</div>`;
  }

  // Two or three options in a row («Неделя / Месяц», «до 20 тыс / 20–100 тыс / от 100 тыс»): [{ id, label }]
  function segmented(options = [], active = '', { onclick = '', block = false, label = '' } = {}) {
    return `<div class="ds-segmented${block ? ' ds-segmented-block' : ''}" role="group"${label ? ` aria-label="${esc(label)}"` : ''}>${options.map(o =>
      `<button type="button" aria-pressed="${o.id === active}"${handler(onclick ? onclick.replace('$id', o.id) : '')}>${esc(o.label)}</button>`).join('')}</div>`;
  }

  // A setting that is on or off, with its explanation and an optional value box («10%»)
  function toggle({ title = '', sub = '', on = false, onclick = '', value = '' } = {}) {
    return `
      <div class="ds-toggle-row">
        <span class="ds-choice-body"><span class="ds-choice-title">${esc(title)}</span>${sub ? `<span class="ds-choice-sub">${esc(sub)}</span>` : ''}</span>
        ${value ? `<span class="ds-value-box">${esc(value)}</span>` : ''}
        <button type="button" class="ds-toggle" role="switch" aria-checked="${Boolean(on)}" aria-label="${esc(title)}"${handler(onclick)}></button>
      </div>`;
  }

  // «2 из 3» on top of a short form
  function progress(step, total) {
    const n = Math.max(1, Math.floor(Number(total) || 1));
    const k = Math.min(n, Math.max(0, Math.floor(Number(step) || 0)));
    return `<div class="ds-progress"><span class="ds-progress-parts" role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${k}">${Array.from({ length: n }, (_, i) => `<i${i < k ? ' class="on"' : ''}></i>`).join('')}</span><span class="ds-progress-label">${k} из ${n}</span></div>`;
  }

  // A thin turquoise bar (0–100)
  function meter(percent) {
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    return `<div class="ds-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}"><i style="width:${p}%"></i></div>`;
  }

  // «Перед публикацией · 3 из 4»: [{ text, done, action, onclick }] — done = turquoise check, not done = red circle + action
  function checklist(items = [], { title = '' } = {}) {
    const doneCount = items.filter(i => i.done).length;
    return `
      <div class="ds-stack">
        ${title ? `<span class="ds-label-sm">${esc(title)} · ${doneCount} из ${items.length}</span>` : ''}
        <ul class="ds-checklist">${items.map(i => `
          <li class="ds-check${i.done ? '' : ' ds-check-todo'}">
            <span class="ds-check-mark" aria-hidden="true">${i.done ? iconTag('check') : ''}</span>
            <span class="ds-check-text">${esc(i.text)}</span>
            ${!i.done && i.action ? `<button type="button" class="ds-link-red"${handler(i.onclick)}>${esc(i.action)}</button>` : ''}
          </li>`).join('')}</ul>
      </div>`;
  }

  // Pale red warning with one action: «Нет ссылки на оплату. Без неё … → Добавить»
  function alert({ title = '', text = '', action = '', onclick = '' } = {}) {
    return `
      <div class="ds-alert" role="status">
        <span class="ds-alert-text">${title ? `<b>${esc(title)}</b> ` : ''}${esc(text)}</span>
        ${action ? button({ text: action, variant: 'outline', onclick }) : ''}
      </div>`;
  }

  // «Главное сейчас» — the dark card: eyebrow (left, right) · title · optional progress / bars · actions (HTML)
  function focusCard({ eyebrow = '', eyebrowRight = '', title = '', percent = null, bars = null, actions = '' } = {}) {
    const barsHtml = Array.isArray(bars) && bars.length ? `<div class="ds-bars" aria-hidden="true">${bars.map(b =>
      `<i${b.loss ? ' class="ds-bar-loss"' : ''} style="height:${Math.max(8, Math.min(100, Number(b.value) || 0))}%"></i>`).join('')}</div>` : '';
    return `
      <div class="ds-focus">
        ${eyebrow || eyebrowRight ? `<span class="ds-focus-eyebrow"><span>${esc(eyebrow)}</span><span>${esc(eyebrowRight)}</span></span>` : ''}
        ${percent != null ? meter(percent) : ''}
        <span class="ds-focus-title">${esc(title)}</span>
        ${barsHtml}
        ${actions ? `<div class="ds-focus-actions">${actions}</div>` : ''}
      </div>`;
  }

  // Bottom bar: price on the left («10% / с каждой продажи»), the main button on the right
  function actionBar({ price = '', sub = '', button: btn = null } = {}) {
    return `
      <div class="ds-actionbar">
        ${price || sub ? `<span class="ds-actionbar-price"><b>${esc(price)}</b><span>${esc(sub)}</span></span>` : ''}
        ${btn ? button({ variant: 'primary', size: 'lg', block: true, ...btn }) : ''}
      </div>`;
  }

  // Bottom sheet. preview: drawn in place (the showcase) instead of over the screen
  function sheet({ title = '', body = '', footer = '', onclose = '', preview = false } = {}) {
    return `
      <div class="ds-sheet-backdrop${preview ? ' ds-sheet-preview' : ''}"${preview ? '' : ' role="dialog" aria-modal="true"'}>
        <div class="ds-sheet">
          <span class="ds-sheet-handle" aria-hidden="true"></span>
          <div class="ds-sheet-head"><h2 class="ds-h2">${esc(title)}</h2><button type="button" class="ds-close" aria-label="Закрыть"${handler(onclose)}><i data-lucide="x" aria-hidden="true"></i></button></div>
          ${body}
          ${footer}
        </div>
      </div>`;
  }

  // Chat: «Через 2 дня»
  const dateLine = (text) => `<span class="ds-date">${esc(text)}</span>`;

  // Chat: the offer — what the client gets, ways to pay, the pay button, the small print under it.
  // options: [{ id, label, price }]; the button is red (main), unless variant says otherwise
  function offerCard({ title = '', meta = '', points = [], options = [], selected = '', onpick = '', button: btn = null, fineprint = '' } = {}) {
    return `
      <div class="ds-offer">
        <div class="ds-offer-body">
          <span class="ds-offer-title">${esc(title)}</span>
          ${meta ? `<span class="ds-meta">${esc(meta)}</span>` : ''}
          ${points.length ? `<ul class="ds-offer-list">${points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
        </div>
        ${options.length ? `<div class="ds-offer-options" role="radiogroup">${options.map(o => `
          <button type="button" class="ds-option" role="radio" aria-checked="${o.id === selected}"${handler(onpick ? onpick.replace('$id', o.id) : '')}>
            <span class="ds-radio" aria-hidden="true"></span><span>${esc(o.label)}</span><span class="ds-choice-right">${esc(o.price)}</span>
          </button>`).join('')}</div>` : ''}
        ${btn || fineprint ? `<div class="ds-offer-foot">${btn ? button({ variant: 'primary', size: 'lg', block: true, ...btn }) : ''}${fineprint ? `<span class="ds-fineprint">${esc(fineprint)}</span>` : ''}</div>` : ''}
      </div>`;
  }

  // Chat: a free next step for those who did not buy (turquoise: it is good news)
  function giftCard({ eyebrow = '', title = '', text = '', button: btn = null } = {}) {
    return `
      <div class="ds-gift">
        ${eyebrow ? `<span class="ds-gift-eyebrow">${esc(eyebrow)}</span>` : ''}
        <span class="ds-offer-title">${esc(title)}</span>
        ${text ? `<span class="ds-meta" style="color:var(--ds-ink-2)">${esc(text)}</span>` : ''}
        ${btn ? button({ variant: 'good', size: 'lg', block: true, ...btn }) : ''}
      </div>`;
  }

  // Chat: the input with the round microphone, and SmartFlow one small line at the very bottom
  function composer({ placeholder = 'Или напишите своими словами', name = 'message' } = {}) {
    return `
      <div class="ds-composer">
        <input class="ds-input" name="${esc(name)}" placeholder="${esc(placeholder)}" aria-label="Сообщение" />
        <button type="button" class="ds-mic" aria-label="Голосовое сообщение"><i data-lucide="mic" aria-hidden="true"></i></button>
      </div>
      <div class="ds-powered">работает на SmartFlow</div>`;
  }

  // «Если клиент… → …» rows of a step's scenarios: [{ when, then }]
  function conditions(rows = []) {
    return `<div class="ds-stack">${rows.map(r =>
      `<div class="ds-cond"><span class="ds-cond-cell">${esc(r.when)}</span><span class="ds-cond-arrow" aria-hidden="true">→</span><span class="ds-cond-cell">${esc(r.then)}</span></div>`).join('')}</div>`;
  }

  // «Ниша: нутрициология · изменить»
  function pill({ label = '', value = '', action = '', onclick = '' } = {}) {
    return `<span class="ds-pill">${esc(label)}${label ? ':' : ''} <b>${esc(value)}</b>${action ? `<button type="button" class="ds-link-red"${handler(onclick)}>${esc(action)}</button>` : ''}</span>`;
  }

  SF.ds = {
    FLAG, on, apply, esc,
    button, field, search, card, badge, count, status, STATUSES, chatHead, bubble, replies, typing, tabbar,
    skeleton, empty, error, tabs, chips, thumb, item, list,
    screenHead, avatar, stepPath, stepEditor, stats, bigNumber, choice, segmented, toggle, progress, meter, checklist, alert,
    focusCard, actionBar, sheet, dateLine, offerCard, giftCard, composer, conditions, pill
  };
})(window);
