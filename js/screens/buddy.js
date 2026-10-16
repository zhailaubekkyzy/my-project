// screens/buddy.js - SI-Buddy: the home screen is a conversation with Buddy (owner's decision): a personal
// helper for every day (plans, reminders, later the calendar). Every notification is Buddy's message with a
// button where needed; the next helpful step is Buddy's message too. Real data only.
// Above the conversation — the calendar "for the whole life" (owner's decision 15 Oct.): «Месяц» on the side
// opens the whole month; Сегодня / Завтра / the day after show only the nearest plan and the next one with
// their time; more plans fade out softly, a tap shows the whole day. Plans are added in words to Buddy
// (text or voice); meetings with experts appear by themselves.

(function (window) {
  const SF = window.SF;
  const store = () => window.funnelStore;

  // The chain of hints after key events (see the structure document, "Бадди")
  function nextStep(state) {
    const me = state.me;
    const business = store().isBusinessActive();
    const chats = state.remote.chats || [];
    if (!business && !chats.length) {
      return {
        text: 'Найдите SI-продавца под свою задачу в Маркетплейсе — он ответит за пару секунд.',
        primary: { label: 'Открыть Маркетплейс', action: "SF.go('marketplace')" },
        secondary: { label: 'У меня свой продукт', action: "SF.openIn('marketplace', 'office')" }
      };
    }
    // No "create your own SI-seller" offer from Buddy (owner's decision 16 Oct.: for clients it is spam);
    // experts find the Office in the Marketplace themselves
    if (!business) return null;
    const consultants = store().ownConsultants();
    const unfinished = consultants.find(c => !c.offer || !c.paymentUrl);
    if (!consultants.length || unfinished) {
      return {
        text: 'Заполните карточку SI-продавца: оффер, цену и свою ссылку на оплату. Потом отправьте его ссылку клиентам.',
        primary: unfinished
          ? { label: 'Заполнить', action: `SF.openIn('marketplace', 'office-consultant', { id: '${SF.js(unfinished.id)}', tab: 'methodology' })` }
          : { label: 'Создать', action: "SF.openIn('marketplace', 'office-create')" }
      };
    }
    if (SF.trustScore(me).score < 60) {
      return {
        text: 'Заполните профиль, чтобы посетители вам доверяли. Покажу, что поднимет доверие быстрее всего.',
        primary: { label: 'К профилю', action: "SF.openIn('profile', 'edit')" }
      };
    }
    return {
      text: 'Всё готово: SI-продавец работает, профиль заполнен. Скоро здесь появится Инкубатор — группы с целью и серией дней.',
      primary: null
    };
  }

  function timeLabel(value) {
    if (!value) return '';
    const d = new Date(String(value).replace(' ', 'T') + (/[Z+]/.test(String(value)) ? '' : 'Z'));
    return isNaN(d) ? '' : d.toLocaleString(SF.locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  // Where a Buddy message's button leads (the same params as the bot's buttons)
  const BUTTONS = {
    GO_marketplace: 'Открыть Маркетплейс',
    GO_office: 'Открыть Офис',
    GO_chats: 'Открыть Чаты',
    GO_profile: 'Открыть Профиль',
    S_support: 'Написать в поддержку'
  };
  let sending = false;

  function buddyBubble(html, { time = '', buttons = '', unread = false } = {}) {
    return `
      <div class="flex items-end gap-1.5">
        <img src="${SF.MASCOTS.buddy}" alt="" class="mascot-avatar" />
        <div class="max-w-[85%] space-y-1.5">
          <div class="chat-bubble-si ${unread ? 'ring-2 ring-[#81D8D0]' : ''}">${html}</div>
          ${buttons}
          ${time ? `<div class="text-[9px] text-faint px-1">${time}</div>` : ''}
        </div>
      </div>`;
  }

  // ---------------- Calendar ----------------
  const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const hhmm = (iso) => new Date(iso).toLocaleTimeString(SF.locale(), { hour: '2-digit', minute: '2-digit' });
  const dayShort = (d) => d.toLocaleDateString(SF.locale(), { day: 'numeric', month: 'short' }).replace('.', '');
  const dayLong = (d) => d.toLocaleDateString(SF.locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const itemsOn = (items, day) => items.filter(i => sameDay(new Date(i.startsAt), day));

  // Today + 2 days for the strip (loaded on every Buddy visit)
  function daysRange() {
    const today = startOfDay(new Date());
    return { key: 'days', from: today.toISOString(), to: addDays(today, 3).toISOString() };
  }

  function loadDays(maxAge) {
    const r = daysRange();
    return SF.data.buddyCalendar(r.key, r.from, r.to, maxAge);
  }

  function itemRow(i) {
    return `
      <div class="flex items-baseline gap-2 text-xs leading-snug">
        <span class="w-11 flex-shrink-0 font-bold text-brand tabular-nums">${hhmm(i.startsAt)}</span>
        <span class="flex-1 min-w-0 truncate text-ink">${SF.esc(i.title)}</span>
      </div>`;
  }

  function calendarStrip(route, state) {
    const cal = state.remote.buddyCalendar.days;
    const today = startOfDay(new Date());
    const index = [0, 1, 2].includes(Number(route.day)) ? Number(route.day) : 0;
    const days = [0, 1, 2].map(n => addDays(today, n));
    const labels = ['Сегодня', 'Завтра', dayShort(days[2])];
    const now = Date.now();
    let items = cal ? itemsOn(cal.items, days[index]) : [];
    // Today: only what is still ahead (a meeting that is going on now stays)
    const passed = index === 0 ? items.filter(i => new Date(i.endsAt || i.startsAt).getTime() < now).length : 0;
    if (index === 0) items = items.filter(i => new Date(i.endsAt || i.startsAt).getTime() >= now);
    const more = items.length > 2;
    let empty = '';
    if (cal && !items.length) {
      empty = passed
        ? 'На сегодня планов больше нет'
        : 'Планов нет. Напишите Бадди, например: «завтра в 13:00 созвон»';
    }
    return `
      <div class="glass-card-3d p-2 flex gap-2 flex-shrink-0">
        <button onclick="SF.actions.openBuddyMonth()" class="w-12 flex-shrink-0 rounded-xl bg-sunken border border-line flex flex-col items-center justify-center gap-1 text-muted" aria-label="Открыть месяц">
          <i data-lucide="calendar-days" class="w-4 h-4 text-brand"></i>
          <span class="text-[9px] font-semibold leading-none">Месяц</span>
        </button>
        <div class="flex-1 min-w-0 space-y-1.5">
          <div class="flex gap-1">
            ${labels.map((label, n) => `
              <button onclick="SF.patch({ day: ${n} })" class="flex-1 py-1 rounded-lg text-[11px] font-semibold border ${n === index ? 'bg-[#81D8D0] text-[#08302c] border-[#81D8D0]' : 'bg-sunken text-muted border-line'}">${label}</button>`).join('')}
          </div>
          <button onclick="SF.actions.openBuddyDay('${days[index].toISOString()}')" class="block w-full text-left px-1 h-[46px] overflow-hidden space-y-1" style="${more ? '-webkit-mask-image: linear-gradient(to bottom, #000 62%, transparent); mask-image: linear-gradient(to bottom, #000 62%, transparent);' : ''}" aria-label="Все планы дня">
            ${!cal ? '<div class="text-[11px] text-faint">Загружаю…</div>' : ''}
            ${empty ? `<div class="text-[11px] text-faint leading-snug">${empty}</div>` : ''}
            ${items.slice(0, 3).map(itemRow).join('')}
          </button>
        </div>
      </div>`;
  }

  function dayList(items) {
    if (!items.length) return '<div class="text-xs text-faint">В этот день планов нет. Напишите Бадди, что запланировать.</div>';
    return `<div class="space-y-1.5">${items.map(i => `
      <div class="p-2.5 rounded-xl bg-sunken border border-line flex items-center gap-2.5">
        <span class="w-11 flex-shrink-0 text-xs font-bold text-brand tabular-nums">${hhmm(i.startsAt)}</span>
        <span class="flex-1 min-w-0">
          <span class="block text-xs text-ink">${SF.esc(i.title)}</span>
          ${i.remindAt ? `<span class="block text-[10px] text-faint">напомню в ${hhmm(i.remindAt)}</span>` : ''}
        </span>
        ${i.kind === 'meeting'
          ? (i.startParam ? `<button onclick="SF.closeModal(); SF.openStartParam('${SF.js(i.startParam)}')" class="px-2 py-1 rounded-lg btn-3d-tiffany text-[10px] font-bold">Открыть</button>` : '')
          : `<button onclick="SF.actions.cancelBuddyPlan('${SF.js(i.id)}')" class="p-1.5 rounded-lg btn-3d-dark" aria-label="Удалить из календаря"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>`}
      </div>`).join('')}</div>`;
  }

  // The whole day (a tap on the strip)
  let openedDay = null;
  let openedMonth = null; // { month: Date (1st day), day: Date | null }

  SF.actions.openBuddyDay = (iso) => {
    openedMonth = null;
    openedDay = new Date(iso);
    renderModal();
  };

  SF.actions.openBuddyMonth = (shift = 0) => {
    openedDay = null;
    const base = openedMonth ? openedMonth.month : new Date();
    const month = new Date(base.getFullYear(), base.getMonth() + (openedMonth ? shift : 0), 1);
    openedMonth = { month, day: openedMonth && !shift ? openedMonth.day : null };
    renderModal();
    const key = monthKey(month);
    SF.data.buddyCalendar(key, month.toISOString(), new Date(month.getFullYear(), month.getMonth() + 1, 1).toISOString())
      .then(() => { if (openedMonth && monthKey(openedMonth.month) === key) renderModal(); })
      .catch(() => {});
  };

  SF.actions.pickBuddyMonthDay = (iso) => {
    if (!openedMonth) return;
    openedMonth.day = new Date(iso);
    renderModal();
  };

  function renderModal() {
    const remote = store().data.remote.buddyCalendar;
    if (openedDay) {
      const days = remote.days;
      const month = remote[monthKey(openedDay)];
      const source = days && openedDay >= new Date(days.from) && openedDay < new Date(days.to) ? days : month;
      SF.openModal(`
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-bold text-ink first-letter:uppercase">${dayLong(openedDay)}</h3>
          <button onclick="SF.closeModal()" class="p-1.5 rounded-lg btn-3d-dark" aria-label="Закрыть"><i data-lucide="x" class="w-4 h-4"></i></button>
        </div>
        ${source ? dayList(itemsOn(source.items, openedDay)) : '<div class="text-xs text-muted">Загружаю…</div>'}
        <div class="text-[10px] text-faint">Добавить, перенести или отменить можно словами у Бадди — текстом или голосом.</div>`);
      return;
    }
    if (!openedMonth) return;
    const { month, day } = openedMonth;
    const data = remote[monthKey(month)];
    const first = (month.getDay() + 6) % 7; // Monday first
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const today = startOfDay(new Date());
    const cells = [];
    for (let i = 0; i < first; i++) cells.push('<div></div>');
    for (let d = 1; d <= count; d++) {
      const date = new Date(month.getFullYear(), month.getMonth(), d);
      const has = data && itemsOn(data.items, date).length;
      const picked = day && sameDay(day, date);
      cells.push(`
        <button onclick="SF.actions.pickBuddyMonthDay('${date.toISOString()}')" class="h-10 rounded-xl flex flex-col items-center justify-center text-xs ${picked ? 'bg-[#81D8D0] text-[#08302c] font-bold' : (sameDay(date, today) ? 'border border-[#81D8D0] text-ink font-bold' : 'text-ink-2')}">
          ${d}
          <span class="w-1 h-1 rounded-full ${has ? (picked ? 'bg-[#08302c]' : 'bg-brand') : 'bg-transparent'}"></span>
        </button>`);
    }
    SF.openModal(`
      <div class="flex items-center justify-between gap-2">
        <button onclick="SF.actions.openBuddyMonth(-1)" class="p-1.5 rounded-lg btn-3d-dark" aria-label="Прошлый месяц"><i data-lucide="chevron-left" class="w-4 h-4"></i></button>
        <h3 class="flex-1 text-center text-sm font-bold text-ink">${MONTHS[month.getMonth()]} ${month.getFullYear()}</h3>
        <button onclick="SF.actions.openBuddyMonth(1)" class="p-1.5 rounded-lg btn-3d-dark" aria-label="Следующий месяц"><i data-lucide="chevron-right" class="w-4 h-4"></i></button>
        <button onclick="SF.closeModal()" class="p-1.5 rounded-lg btn-3d-dark" aria-label="Закрыть"><i data-lucide="x" class="w-4 h-4"></i></button>
      </div>
      <div class="grid grid-cols-7 gap-1 text-center">
        ${WEEK.map(w => `<div class="text-[10px] text-faint font-semibold">${w}</div>`).join('')}
        ${cells.join('')}
      </div>
      ${!data ? '<div class="text-xs text-muted">Загружаю…</div>' : ''}
      ${day && data ? `<div class="text-xs font-bold text-ink first-letter:uppercase pt-1">${dayLong(day)}</div>${dayList(itemsOn(data.items, day))}` : ''}
      ${!day && data ? '<div class="text-[11px] text-faint">Нажмите на день, чтобы увидеть планы. Точка — в этот день что-то есть.</div>' : ''}`);
  }

  SF.actions.cancelBuddyPlan = async (id) => {
    if (!confirm('Убрать из календаря?')) return;
    try {
      await window.smartFlowApi.cancelBuddyPlan(id);
      SF.data.invalidate('buddyCalendar');
      await loadDays(0);
      if (openedMonth) {
        const m = openedMonth.month;
        await SF.data.buddyCalendar(monthKey(m), m.toISOString(), new Date(m.getFullYear(), m.getMonth() + 1, 1).toISOString(), 0);
      }
      renderModal();
    } catch (err) {
      SF.showToast(SF.withErrorCode('Не получилось убрать. Попробуйте ещё раз', err));
    }
  };

  // ---------------- Voice to Buddy (up to 1.5 minutes; transcribed, the recording is not kept) ----------------
  const VOICE_MAX = 90;
  let voice = null; // { seconds, controller }
  const voiceTime = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

  SF.actions.startBuddyVoice = async () => {
    if (voice || sending || !window.sfMedia) return;
    try {
      const controller = await window.sfMedia.recordVoice({
        maxSeconds: VOICE_MAX,
        onTick: (sec) => {
          if (!voice) return;
          voice.seconds = sec;
          const el = document.getElementById('buddy-voice-timer');
          if (el) el.textContent = voiceTime(Math.min(sec, VOICE_MAX));
        },
        onLimit: () => SF.actions.sendBuddyVoice()
      });
      voice = { seconds: 0, controller };
      store().notify();
    } catch (err) {
      voice = null;
      SF.showToast(err && err.name === 'NotAllowedError'
        ? 'Разрешите доступ к микрофону для Telegram в настройках телефона'
        : 'Не получилось включить микрофон');
    }
  };

  SF.actions.cancelBuddyVoice = () => {
    if (!voice) return;
    voice.controller.cancel();
    voice = null;
    store().notify();
  };

  SF.actions.sendBuddyVoice = async () => {
    if (!voice || voice.sending) return;
    voice.sending = true;
    const result = await voice.controller.stop();
    voice = null;
    store().notify();
    if (!result || !result.blob.size) return;
    sending = true;
    document.getElementById('buddy-typing')?.classList.remove('hidden');
    SF.scrollToBottom('buddy-scroll');
    try {
      const res = await window.smartFlowApi.uploadBuddyVoice(result.blob, Math.min(result.seconds, VOICE_MAX), -new Date().getTimezoneOffset());
      SF.data.invalidate('buddy');
      await SF.data.buddy(0);
      if (res && res.calendarChanged) {
        SF.data.invalidate('buddyCalendar');
        loadDays(0);
      }
    } catch (err) {
      SF.showToast(SF.withErrorCode(err.message || 'Голосовое не отправилось. Попробуйте ещё раз', err));
    } finally {
      sending = false;
      document.getElementById('buddy-typing')?.classList.add('hidden');
      SF.scrollToBottom('buddy-scroll');
    }
  };

  function render(route, state) {
    const me = state.me;
    const firstName = SF.esc((me.displayName || '').split(' ')[0] || 'друг');
    const buddy = state.remote.buddy;
    const list = buddy ? buddy.messages : [];
    const step = nextStep(state);
    const usage = buddy && buddy.usage;
    const left = usage ? Math.max(0, usage.max - usage.used) : null;
    const signedIn = SF.data.signedIn();

    return `
      <div class="h-full flex flex-col gap-2.5">
      ${state.auth.status === 'offline' ? `
        <div class="p-3 rounded-2xl bg-sunken border border-line text-xs text-muted flex-shrink-0">Нет связи с сервером. Откройте приложение в Telegram или проверьте интернет.</div>` : ''}

      ${signedIn ? calendarStrip(route, state) : ''}

      <div class="glass-card-3d p-3 flex flex-col space-y-2.5 flex-1 min-h-[220px] overflow-y-auto" id="buddy-scroll">
        ${buddyBubble(SF.t(`Привет, ${firstName}! Я Бадди — ваш помощник на каждый день. Напишите, что запланировать или о чём напомнить, — я запомню. Все уведомления тоже приходят сюда.`))}
        ${list.map(m => m.sender === 'user'
          ? `<div class="flex flex-col items-end gap-0.5"><div class="chat-bubble-human">${m.kind === 'voice' ? '<i data-lucide="mic" class="w-3 h-3 inline -mt-0.5 mr-1 opacity-70"></i>' : ''}${SF.esc(m.text)}</div><div class="text-[9px] text-faint px-1">${timeLabel(m.createdAt)}</div></div>`
          : buddyBubble(SF.esc(m.text).replace(/\n/g, '<br>'), {
            time: timeLabel(m.createdAt),
            unread: !m.read,
            buttons: m.startParam ? `<button onclick="SF.openStartParam('${SF.js(m.startParam)}')" class="px-3 py-1.5 rounded-xl btn-3d-tiffany text-[11px] font-bold">${BUTTONS[m.startParam] || 'Открыть'}</button>` : ''
          })).join('')}
        ${step ? buddyBubble(SF.esc(SF.t(step.text)), {
          buttons: step.primary ? `
            <div class="flex flex-wrap gap-2">
              <button onclick="${step.primary.action}" class="px-3 py-1.5 rounded-xl btn-3d-tiffany text-[11px] font-bold">${step.primary.label}</button>
              ${step.secondary ? `<button onclick="${step.secondary.action}" class="px-3 py-1.5 rounded-xl btn-3d-dark text-[11px]">${step.secondary.label}</button>` : ''}
            </div>` : ''
        }) : ''}
        <div id="buddy-typing" class="hidden flex items-end gap-1.5">
          <img src="${SF.MASCOTS.buddy}" alt="" class="mascot-avatar" />
          <div class="typing-dots"><span class="text-[10px] text-muted font-medium mr-1.5">печатает</span><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>
        </div>
      </div>

      ${signedIn ? `
        <div class="flex-shrink-0 space-y-1">
        ${voice ? `
          <div class="flex items-center gap-2 p-2 rounded-xl bg-card border border-[#81D8D0]">
            <button onclick="SF.actions.cancelBuddyVoice()" class="p-2 rounded-lg btn-3d-dark" aria-label="Отменить запись"><i data-lucide="x" class="w-4 h-4"></i></button>
            <span class="flex-1 flex items-center gap-1.5 text-xs text-ink"><span class="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>Запись <span id="buddy-voice-timer" class="font-semibold">${voiceTime(voice.seconds)}</span><span class="text-faint">/ ${voiceTime(VOICE_MAX)}</span></span>
            <button onclick="SF.actions.sendBuddyVoice()" class="p-2.5 rounded-xl btn-3d-tiffany flex items-center justify-center" aria-label="Отправить голосовое"><i data-lucide="send" class="w-4 h-4"></i></button>
          </div>` : `
          <form onsubmit="SF.actions.sendBuddy(event)" class="flex items-center gap-2">
            <input type="text" name="text" data-keep="buddy-input" maxlength="1000" autocomplete="off" placeholder="Напишите Бадди: план, дело, напоминание…" class="flex-1 bg-card border border-line-2 rounded-xl px-3 py-2.5 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]" />
            ${window.sfMedia && window.sfMedia.canRecord() ? `
              <button type="button" onclick="SF.actions.startBuddyVoice()" class="p-2.5 rounded-xl btn-3d-dark flex items-center justify-center" aria-label="Записать голосовое"><i data-lucide="mic" class="w-4 h-4"></i></button>` : ''}
            <button type="submit" class="p-2.5 rounded-xl btn-3d-tiffany flex items-center justify-center" aria-label="Отправить"><i data-lucide="send" class="w-4 h-4"></i></button>
          </form>`}
        ${left !== null && left <= 5 ? `<div class="text-[10px] text-faint text-center">${left ? `Сегодня Бадди ответит ещё на ${left} сообщ.` : 'На сегодня сообщения Бадди закончились — продолжим завтра'}</div>` : ''}
        </div>
      ` : ''}
      </div>
    `;
  }

  SF.actions.sendBuddy = async (e) => {
    e.preventDefault();
    const input = e.target.text;
    const text = input.value.trim();
    if (!text || sending) return;
    sending = true;
    input.value = '';
    const s = store();
    const buddy = s.data.remote.buddy || { messages: [], unread: 0, usage: null };
    s.setRemote('buddy', { ...buddy, messages: [...buddy.messages, { id: `local-${Date.now()}`, sender: 'user', text, read: true, createdAt: new Date().toISOString() }] });
    document.getElementById('buddy-typing')?.classList.remove('hidden');
    SF.scrollToBottom('buddy-scroll');
    try {
      const res = await window.smartFlowApi.sendBuddyMessage(text, -new Date().getTimezoneOffset());
      SF.data.invalidate('buddy');
      await SF.data.buddy(0);
      // Buddy added or removed a plan: the calendar above shows it at once
      if (res && res.calendarChanged) {
        SF.data.invalidate('buddyCalendar');
        loadDays(0);
      }
    } catch (err) {
      input.value = text;
      SF.showToast(SF.withErrorCode('Не отправилось. Проверьте интернет и попробуйте ещё раз', err));
    } finally {
      sending = false;
      SF.scrollToBottom('buddy-scroll');
    }
  };

  // Everything shown on the Buddy screen is read: the red dot on the Buddy button goes away
  function markRead() {
    const b = store().data.remote.buddy;
    if (!b || !b.unread) return;
    store().setRemote('buddy', { ...b, unread: 0, messages: b.messages.map(m => ({ ...m, read: true })) });
    store().setRemote('notifications', { list: [], unread: 0 });
    // After the server marked them read, the red dot is checked again (it must not come back)
    window.smartFlowApi.markBuddyRead()
      .then(() => { SF.data.invalidate('notifications'); return SF.data.notifications(0); })
      .catch(() => {});
  }

  SF.screens.buddy = {
    title: () => 'Бадди',
    render,
    afterRender() {
      if (SF.data.signedIn()) loadDays();
      SF.data.myChats();
      SF.data.marketplace();
      if (store().isBusinessActive()) SF.data.allInquiries();
      SF.data.buddy().then(() => {
        SF.scrollToBottom('buddy-scroll');
        markRead();
      });
      // New messages (replies, reminders, notifications) come by themselves while Buddy is open
      // One poller at a time in the app: the calendar is refreshed with the conversation
      SF.data.poll('buddy', () => {
        if (SF.data.signedIn()) loadDays(60000).catch(() => {});
        return SF.data.buddy(10000).then(markRead);
      }, 15000);
    }
  };
})(window);
