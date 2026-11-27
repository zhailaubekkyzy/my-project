// design-showcase.js - Настройки → «Дизайн-система» (only with the flag design-v2).
//
// The three roles' paths from the mockups (docs/design/C-*, MK-*, S-*), screen after screen, built only from
// the components in js/design.js, with the owner's rules applied (ИИ-…, no invented numbers: N and [цена]
// stand where real data will be; nothing the owner has not decided). Plus «Детали»: palette, type, every part.
(function (window) {
  const SF = window.SF = window.SF || {};
  const ds = () => SF.ds;
  const esc = (v) => SF.ds.esc(v);

  let role = 'client';     // client · expert · marketer · parts
  let preview = '';        // '' = like the app, 'light' / 'dark' = this page only
  const pick = { reply: 0, pay: 'parts', model: 'percent', sells: 'course', check: 'mid', period: 'month', step: 2, error: false };

  const phone = (inner) => `<div class="ds-phone">${inner}</div>`;
  const screen = (name, inner) => `<div class="ds-screen"><span class="ds-eyebrow">${esc(name)}</span>${phone(inner)}</div>`;
  const label = (text) => `<span class="ds-label-sm">${esc(text)}</span>`;

  // ---------------- Client of an expert: C-Entry → C-Pay → C-NotBought ----------------
  function clientPath() {
    const d = ds();
    const head = d.chatHead({ name: 'Имя · помощница эксперта', role: 'ИИ-помощница эксперта' });
    const entry = `
      ${head}
      <div class="ds-pad">
        <div class="ds-card ds-stack" style="gap:10px">
          <div class="ds-row" style="flex-wrap:nowrap;gap:10px">${d.avatar({ name: 'Имя Эксперта', size: 'sm' })}
            <span class="ds-stack" style="gap:0"><span class="ds-h3">Имя эксперта · ниша</span><span class="ds-small">[опыт эксперта]</span></span></div>
          <ul class="ds-offer-list" style="color:var(--ds-ink-2)"><li>Имя — ИИ-помощница эксперта, отвечает в любое время</li><li>Эксперт подключится сам, если вы попросите</li></ul>
        </div>
        <div class="ds-chat">
          ${d.bubble('Здравствуйте! Помогу понять, подойдёт ли вам программа. Что для вас сейчас важнее всего?')}
          ${d.replies(['[Главная цель клиента 1]', '[Главная цель клиента 2]', '[Главная цель клиента 3]'], { selected: pick.reply, onclick: 'SF.actions.dsPick(\'reply\', $i)' })}
        </div>
      </div>
      ${d.composer()}`;
    const pay = `
      ${head}
      <div class="ds-pad"><div class="ds-chat">
        ${d.bubble('Звучит классно, но дорого для меня', { mine: true })}
        ${d.bubble('Понимаю, сразу всю сумму отдать непросто. Можно оплатить частями — первый платёж сегодня, остальные через месяц и два.')}
        ${d.offerCard({
          title: '[Название продукта]', meta: '[длительность] · [формат] · доступ сразу',
          points: ['[Что получит клиент 1]', '[Что получит клиент 2]', '[Что получит клиент 3]'],
          options: [{ id: 'once', label: 'Сразу', price: '[цена]' }, { id: 'parts', label: 'Частями', price: 'N × [цена]' }],
          selected: pick.pay, onpick: "SF.actions.dsPick('pay', '$id')",
          button: { text: 'Перейти к оплате' },
          fineprint: 'Деньги идут эксперту напрямую. Чек и доступ придут в этот чат.'
        })}
      </div></div>
      <div class="ds-powered">работает на SmartFlow</div>`;
    const notBought = `
      ${head}
      <div class="ds-pad"><div class="ds-chat">
        ${d.dateLine('Через 2 дня')}
        ${d.bubble('Как прошла неделя — получилось то, о чём говорили?')}
        ${d.bubble('Один раз получилось, но курс пока не потяну', { mine: true })}
        ${d.bubble('Понимаю. Тогда вот что бесплатно:')}
        ${d.giftCard({ eyebrow: 'Бесплатно · [когда старт]', title: '[Бесплатный шаг]', text: '[Что будет и кто ведёт]', button: { text: 'Записать' } })}
        ${d.replies(['Напомнить через месяц', 'Мне нужно что-то другое'])}
        <button type="button" class="ds-link-quiet">Не присылать рассылки</button>
      </div></div>
      <div class="ds-powered">работает на SmartFlow</div>`;
    return `<div class="ds-path">${screen('1 · Первое касание', entry)}${screen('2 · Предложение и оплата', pay)}${screen('3 · Не купил', notBought)}</div>`;
  }

  // ---------------- Expert in the Marketplace: MK-Catalog → MK-Detail → MK-Connect ----------------
  const STEPS = [
    { title: 'Приветствие и вопрос о цели' }, { title: 'Бесплатный материал' },
    { title: 'Возражения и рассрочка', note: 'Здесь кнопка «Купить»' }, { title: 'Оплата и доступ' }, { title: 'Дожим тех, кто не купил' }
  ];
  function expertPath() {
    const d = ds();
    const catalog = `
      <div class="ds-pad" style="gap:12px;padding-bottom:0">
        <div class="ds-row" style="flex-wrap:nowrap"><div style="flex:1">${d.search({ placeholder: 'Ниша, продукт или цель' })}</div>
          <button type="button" class="ds-icon-btn" aria-label="Избранное"><i data-lucide="bookmark" aria-hidden="true"></i></button></div>
        ${d.tabs([{ id: 't', label: 'Шаблоны', num: 'N' }, { id: 's', label: 'Специалисты' }], 't')}
        ${d.chips([{ id: 'a', label: '[Раздел 1]' }, { id: 'b', label: '[Раздел 2]' }, { id: 'c', label: '[Раздел 3]' }], 'a')}
      </div>
      <div style="padding:0 16px">${d.list([
        d.item({ title: '[Название = результат для клиента]', meta: 'Имя автора', verified: true, preview: d.thumb({ steps: 5, tone: 'red' }),
          badges: [{ text: 'N% в покупку', tone: 'good' }, { text: '% от продаж', tone: 'neutral' }], foot: 'Подключили N экспертов' }),
        d.item({ title: '[Диагностика → консультация → программа]', meta: 'Имя автора', preview: d.thumb({ steps: 3, tone: 'teal' }),
          badges: [{ text: 'N% в запись', tone: 'good' }, { text: 'Бесплатно', tone: 'neutral' }], foot: 'Подключили N экспертов' }),
        d.item({ title: '[Новый шаблон без цифр]', meta: 'Имя автора · новинка', preview: d.thumb({ steps: 7, tone: 'fog' }),
          badges: [{ text: 'мало данных', tone: 'neutral' }, { text: 'Разово · [цена]', tone: 'neutral' }] })
      ])}</div>
      ${d.tabbar(TABS, 'marketplace')}`;
    const detail = `
      ${d.screenHead({ back: 'void 0', actions: '<button type="button" class="ds-icon-btn" aria-label="Поделиться"><i data-lucide="share" aria-hidden="true"></i></button><button type="button" class="ds-icon-btn" aria-label="Избранное"><i data-lucide="bookmark" aria-hidden="true"></i></button>' })}
      <div class="ds-pad">
        <div class="ds-stack" style="gap:6px"><span class="ds-eyebrow">Шаблон · [Раздел]</span><h1 class="ds-h1">[Название шаблона = результат]</h1>
          <div class="ds-row">${d.avatar({ name: 'Имя Автора', size: 'sm' })}<b style="font-size:14px">Имя автора</b></div></div>
        ${d.stats([{ value: 'N%', label: 'диалогов в покупку', good: true }, { value: 'N', label: 'экспертов подключили' }])}
        <h2 class="ds-h2">Как продавец ведёт клиента</h2>
        ${d.stepPath(STEPS, { done: 2, sale: 2 })}
      </div>
      ${d.actionBar({ price: 'N%', sub: 'с каждой продажи', button: { text: 'Подключить' } })}`;
    const connect = d.sheet({
      preview: true, title: 'Подключить шаблон',
      body: `
        ${label('Как платить автору')}
        ${d.choice([
          { id: 'percent', title: 'Процент от продаж', sub: 'Платите, только когда продавец продал', right: 'N%' },
          { id: 'month', title: 'Подписка', sub: 'Каждый месяц', right: '[цена]/мес' },
          { id: 'once', title: 'Купить навсегда', disabled: true, reason: 'Автор не продаёт этот шаблон разово' }
        ], { selected: pick.model, onclick: "SF.actions.dsPick('model', '$id')", label: 'Как платить автору' })}
        ${label('Мозг бизнеса')}
        ${d.checklist([{ text: 'Продукт, аудитория, тон общения', done: true }])}
        ${d.alert({ title: 'Не хватает 2 ответов:', text: 'условия рассрочки и ссылка на оплату', action: 'Ответить' })}`,
      footer: d.button({ text: 'Подключить и запустить', size: 'lg', block: true, disabled: true, reason: 'Станет активной, когда ответите на 2 вопроса' })
    });
    return `<div class="ds-path">${screen('1 · Каталог', catalog)}${screen('2 · Страница шаблона', detail)}${screen('3 · Подключение', connect)}</div>`;
  }

  // ---------------- Marketer (author of a template): S-Brief → S-Builder → S-Listing → S-Earnings ----------------
  function marketerPath() {
    const d = ds();
    const brief = `
      <div class="ds-pad">
        <div class="ds-row" style="flex-wrap:nowrap;gap:12px"><button type="button" class="ds-icon-btn" aria-label="Назад"><i data-lucide="chevron-left" aria-hidden="true"></i></button><div style="flex:1">${d.progress(2, 5)}</div></div>
        ${d.pill({ label: 'Ниша', value: '[ниша]', action: 'изменить' })}
        <h1 class="ds-h1">Что продаёт ваш клиент?</h1>
        ${d.choice([{ id: 'course', title: 'Онлайн-курс' }, { id: 'consult', title: 'Консультации' }, { id: 'offline', title: 'Услуги офлайн' }, { id: 'goods', title: 'Товары' }],
          { selected: pick.sells, tiles: true, onclick: "SF.actions.dsPick('sells', '$id')", label: 'Что продаёт клиент' })}
        <h2 class="ds-h2">Средний чек</h2>
        ${d.segmented([{ id: 'low', label: 'до 20 тыс' }, { id: 'mid', label: '20–100 тыс' }, { id: 'high', label: 'от 100 тыс' }], pick.check, { block: true, onclick: "SF.actions.dsPick('check', '$id')" })}
        <div class="ds-hint-card"><img src="images/mascots/si-buddy.webp" alt="" /><span style="flex:1">Ещё несколько вопросов — и я соберу черновик из шагов</span></div>
        ${d.button({ text: 'Дальше', variant: 'soft', size: 'lg', block: true })}
      </div>`;
    const builder = `
      ${d.screenHead({ back: 'void 0', title: '[Название шаблона]', sub: 'Черновик · сохранено только что' })}
      <div class="ds-pad">
        ${d.stepEditor([
          { title: 'Приветствие и цель', mine: true }, { title: 'Бесплатный материал', mine: true },
          { title: 'Возражения и рассрочка', warn: true }, { title: 'Оплата и доступ' }, { title: 'Дожим тех, кто не купил' }
        ], { current: pick.step, onclick: "SF.actions.dsPick('step', $i)" })}
        <div class="ds-stack" style="gap:4px"><span class="ds-eyebrow">Шаг ${pick.step + 1} из 5</span><h2 class="ds-h1" style="font-size:22px">Возражения и рассрочка</h2></div>
        ${d.alert({ title: 'Нет ссылки на оплату.', text: 'Без неё продавец не закроет продажу на этом шаге.', action: 'Добавить' })}
        ${d.field({ label: 'Что говорит продавец', multiline: true, value: 'Понимаю, сразу всю сумму отдать непросто. Курс можно оплатить частями.' })}
        <h2 class="ds-h2" style="font-size:15px">Если клиент…</h2>
        ${d.conditions([{ when: 'пишет «дорого»', then: 'показать отзыв' }, { when: 'спрашивает «а если не подойдёт?»', then: 'рассказать про возврат' }, { when: 'молчит 24 часа', then: 'мягкое напоминание' }])}
        <button type="button" class="ds-link-red" style="align-self:flex-start;padding:0">+ Ещё условие</button>
        <h2 class="ds-h2" style="font-size:15px">Так увидит клиент</h2>
        <div class="ds-card" style="padding:0;overflow:hidden">
          ${d.chatHead({ name: 'Имя продавца', role: 'ИИ-консультант' })}
          <div class="ds-chat" style="padding:12px">${d.bubble('Звучит классно, но дорого для меня', { mine: true })}${d.bubble('Понимаю, сразу всю сумму отдать непросто. Курс можно оплатить частями.')}</div>
        </div>
        <div class="ds-row" style="flex-wrap:nowrap">${d.button({ text: 'Как клиент', variant: 'outline', size: 'lg' })}<div style="flex:1">${d.button({ text: 'Опубликовать', variant: 'good', size: 'lg', block: true })}</div></div>
      </div>`;
    const listing = `
      ${d.screenHead({ back: 'void 0', title: 'Опубликовать' })}
      <div class="ds-pad">
        ${label('Так карточку увидят в Маркетплейсе')}
        <div class="ds-card" style="padding:0 12px">${d.item({ title: '[Название шаблона]', meta: 'Вы · новинка', preview: d.thumb({ steps: 5, tone: 'red' }), badges: [{ text: 'мало данных', tone: 'neutral' }] })}</div>
        ${label('Как вам платят')}
        <div>
          ${d.toggle({ title: '% от продаж', sub: 'Процент задаёте вы', on: true, value: 'N%' })}
          ${d.toggle({ title: 'Подписка', sub: 'Каждый месяц' })}
          ${d.toggle({ title: 'Продать навсегда', sub: 'Разовый платёж, дальше без вас' })}
        </div>
        ${d.checklist([
          { text: 'Все шаги заполнены', done: true }, { text: 'Проверено на примере бизнеса', done: true },
          { text: 'Ниша и цель указаны', done: true }, { text: 'Описание для покупателя', done: false, action: 'Написать' }
        ], { title: 'Перед публикацией' })}
        ${d.button({ text: 'Опубликовать', variant: 'good', size: 'lg', block: true, disabled: true, reason: 'Допишите описание для покупателя' })}
      </div>`;
    const earnings = `
      <div class="ds-pad">
        <div class="ds-row" style="justify-content:space-between;flex-wrap:nowrap"><h1 class="ds-h1" style="font-size:20px">Доход автора</h1>
          ${d.segmented([{ id: 'week', label: 'Неделя' }, { id: 'month', label: 'Месяц' }], pick.period, { onclick: "SF.actions.dsPick('period', '$id')" })}</div>
        ${d.bigNumber({ value: 'N ₸', sub: 'за месяц', delta: '+N% к прошлому' })}
        ${d.focusCard({ title: '«[Шаблон]» теряет людей на шаге 4', bars: [{ value: 100 }, { value: 80 }, { value: 72 }, { value: 30, loss: true }, { value: 24 }],
          actions: d.button({ text: 'Открыть шаг 4', variant: 'onfocus', size: 'lg', block: true }) })}
        <div class="ds-row" style="justify-content:space-between">${label('Шаблон')}${label('Доход')}</div>
        <div class="ds-list">
          ${[['[Шаблон 1]', 'N подключений', 'N ₸', ''], ['[Шаблон 2]', 'N подключений · падает 3 недели', 'N ₸', 'bad'], ['[Шаблон 3]', 'новинка', '—', '']].map(([t, m, v, tone]) => `
            <div class="ds-item" style="align-items:center"><div class="ds-item-body"><span class="ds-item-title">${esc(t)}</span><span class="ds-item-meta"${tone ? ' style="color:var(--ds-red-ink);font-weight:700"' : ''}>${esc(m)}</span></div><b class="ds-num">${esc(v)}</b></div>`).join('')}
        </div>
        ${d.button({ text: '+ Новый шаблон', variant: 'outline', size: 'lg', block: true })}
      </div>`;
    return `<div class="ds-path">${screen('1 · Бриф', brief)}${screen('2 · Конструктор', builder)}${screen('3 · Публикация', listing)}${screen('4 · Доход', earnings)}</div>`;
  }

  // ---------------- Parts: palette, type, every base component ----------------
  const PALETTE = [['red', 'Красный', '#E3121F'], ['teal', 'Бирюза', '#1BC6B4'], ['ink', 'Чернила', '#161213'], ['fog', 'Туман', '#F2F0EF'], ['line', 'Линии', '#E6E1DF'], ['muted', 'Второстепенный', '#6A6262'], ['surface', 'Белый', '#FFFFFF']];
  const section = (title, body) => `<section class="ds-section"><h2 class="ds-h2">${esc(title)}</h2>${body}</section>`;
  function parts() {
    const d = ds();
    return `
      ${section('Палитра', `<div class="ds-grid">${PALETTE.map(([t, name, hex]) => `<div class="ds-swatch"><div class="ds-swatch-chip" style="background:var(--ds-${t})"></div><span style="font-size:13px;font-weight:700">${name}</span><span class="ds-small">${hex}</span></div>`).join('')}</div>`)}
      ${section('Шрифт Golos Text', `<span class="ds-h1">24 · Экран</span><span class="ds-h2">17 · Секция</span><span class="ds-h3">15 · Карточка</span><span class="ds-meta">13 · Подпись</span><span style="font-size:12px;font-weight:600">12 · Бейдж</span><span class="ds-num">1 111 · 8 808</span>`)}
      ${section('Отступы и радиусы', `<div class="ds-stack">${[[1, 4], [2, 8], [3, 12], [4, 16], [6, 24]].map(([k, px]) => `<div class="ds-row" style="gap:10px;font-size:13px"><span class="ds-space-bar" style="width:var(--ds-space-${k})"></span>${px}</div>`).join('')}</div>
        <div class="ds-row" style="gap:16px">${['xs', 'sm', 'md', 'lg', 'xl'].map(k => `<span class="ds-radius-box" style="border-radius:var(--ds-radius-${k})"></span>`).join('')}</div>`)}
      ${section('Кнопки', `${d.button({ text: 'Перейти к оплате', size: 'lg', block: true })}
        <div class="ds-row">${d.button({ text: 'Дальше', variant: 'soft' })}${d.button({ text: 'Тёмная', variant: 'dark' })}${d.button({ text: 'Обводка', variant: 'outline' })}${d.button({ text: 'Тихая', variant: 'quiet' })}</div>
        ${d.button({ text: 'Ответить: клиент ждёт', variant: 'primary', block: true })}
        ${d.button({ text: 'Опубликовать', variant: 'good', block: true, disabled: true, reason: 'Допишите описание для покупателя' })}`)}
      ${section('Поля', `${d.search({ placeholder: 'Ниша, продукт или цель' })}
        ${d.field({ label: 'Название', placeholder: '[название]', hint: 'Это увидят клиенты' })}
        ${d.field({ label: 'Ссылка на оплату', value: pick.error ? 'не ссылка' : '', placeholder: 'https://…', error: pick.error ? 'Ссылка должна начинаться с https://' : '' })}
        ${d.button({ text: pick.error ? 'Убрать ошибку' : 'Показать ошибку', variant: 'quiet', onclick: 'SF.actions.dsToggleError()' })}`)}
      ${section('Бейджи и статусы', `<div class="ds-row">${d.badge('N% в покупку', 'good')}${d.badge('мало данных')}${d.badge('новинка', 'new')}${d.badge('падает 3 недели', 'warn')}${d.count(3)}</div>
        <div class="ds-stack">${Object.keys(d.STATUSES).map(d.status).join('')}</div>`)}
      ${section('Сообщения', `<div class="ds-chat">${d.bubble('ИИ-продавец')}${d.bubble('Я в чате', { mine: true })}${d.bubble('Эксперт лично', { author: 'Имя · эксперт', expert: true })}
        ${d.bubble('Участник группы', { human: true, author: 'Имя', place: 'group' })}${d.bubble('Я в группе или Комьюнити', { mine: true, place: 'group' })}${d.typing()}</div>`)}
      ${section('Нижнее меню', phone(d.tabbar(TABS, 'marketplace')))}
      ${section('«Главное сейчас»', d.focusCard({ eyebrow: '[Продукт] · [эксперт]', eyebrowRight: 'неделя N из N', percent: 25, title: 'Сегодня: [задание дня]',
        actions: d.button({ text: 'Записать', variant: 'good', size: 'lg' }) + d.button({ text: 'Урок 2', variant: 'onfocus-outline', size: 'lg' }) }))}
      ${section('Загрузка', d.skeleton({ rows: 3 }))}
      ${section('Пусто', d.empty({ title: 'Здесь пока пусто', text: '[Почему пусто и что сделать]', button: { text: 'Скопировать ссылку' } }))}
      ${section('Ошибка', d.error({ text: 'Нет интернета. Показываем то, что сохранили', retry: "SF.showToast('Повторяем…')" }))}`;
  }

  const TABS = [
    { id: 'community', label: 'Комьюнити', icon: 'users' }, { id: 'marketplace', label: 'Маркетплейс', icon: 'store' },
    { id: 'buddy', label: 'Бадди', buddy: true }, { id: 'chats', label: 'Чаты', icon: 'messages-square', count: 3 },
    { id: 'profile', label: 'Настройки', icon: 'settings' }
  ];
  const ROLES = [{ id: 'client', label: 'Клиент' }, { id: 'expert', label: 'Эксперт' }, { id: 'marketer', label: 'Маркетолог' }, { id: 'parts', label: 'Детали' }];

  function render() {
    const d = ds();
    const body = role === 'expert' ? expertPath() : role === 'marketer' ? marketerPath() : role === 'parts' ? parts() : clientPath();
    return `
      <div class="ds ds-showcase${preview ? ` ds-theme-${preview}` : ''}" data-no-tr>
        <div class="ds-stack" style="gap:12px">
          ${d.tabs(ROLES, role, { onclick: "SF.actions.dsRole('$id')" })}
          ${d.segmented([{ id: '', label: 'Как в приложении' }, { id: 'light', label: 'Светлая' }, { id: 'dark', label: 'Тёмная' }], preview, { onclick: "SF.actions.dsPreview('$id')", label: 'Тема' })}
        </div>
        ${body}
      </div>`;
  }

  SF.actions = SF.actions || {};
  const rerender = () => window.funnelStore && window.funnelStore.notify && window.funnelStore.notify();
  SF.actions.dsRole = (id) => { role = ROLES.some(r => r.id === id) ? id : 'client'; rerender(); };
  SF.actions.dsPreview = (id) => { preview = ['light', 'dark'].includes(id) ? id : ''; rerender(); };
  SF.actions.dsPick = (key, value) => { if (key in pick) { pick[key] = value; rerender(); } };
  SF.actions.dsToggleError = () => { pick.error = !pick.error; rerender(); };

  SF.dsShowcase = { render, ROLES, setRole: (id) => { role = id; } };
})(window);
