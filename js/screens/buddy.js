// screens/buddy.js - SI-Buddy: the home screen is a conversation with Buddy (owner's decision): a personal
// helper for every day (plans, reminders, later the calendar). Every notification is Buddy's message with a
// button where needed; the next helpful step is Buddy's message too. Real data only.

(function (window) {
  const SF = window.SF;
  const store = () => window.funnelStore;

  let hintDismissed = false; // "Не сейчас" hides the hint until the app is reopened

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
    if (!business) {
      if (hintDismissed) return null;
      return {
        text: 'Хотите такого же SI-продавца, чтобы он общался с вашими клиентами? У вас есть свой продукт или услуга?',
        primary: { label: 'Да, есть продукт', action: "SF.openIn('marketplace', 'office')" },
        secondary: { label: 'Не сейчас', action: 'SF.actions.dismissBuddyHint()' }
      };
    }
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
    return isNaN(d) ? '' : d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
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
      ${state.auth.status === 'offline' ? `
        <div class="p-3 rounded-2xl bg-sunken border border-line text-xs text-muted">Нет связи с сервером. Откройте приложение в Telegram или проверьте интернет.</div>` : ''}

      <div class="glass-card-3d p-3 flex flex-col space-y-2.5 min-h-[300px] max-h-[62vh] overflow-y-auto" id="buddy-scroll">
        ${buddyBubble(`Привет, ${firstName}! Я Бадди — ваш помощник на каждый день. Напишите, что запланировать или о чём напомнить, — я запомню. Все уведомления тоже приходят сюда.`)}
        ${list.map(m => m.sender === 'user'
          ? `<div class="flex flex-col items-end gap-0.5"><div class="chat-bubble-human">${SF.esc(m.text)}</div><div class="text-[9px] text-faint px-1">${timeLabel(m.createdAt)}</div></div>`
          : buddyBubble(SF.esc(m.text).replace(/\n/g, '<br>'), {
            time: timeLabel(m.createdAt),
            unread: !m.read,
            buttons: m.startParam ? `<button onclick="SF.openStartParam('${SF.js(m.startParam)}')" class="px-3 py-1.5 rounded-xl btn-3d-tiffany text-[11px] font-bold">${BUTTONS[m.startParam] || 'Открыть'}</button>` : ''
          })).join('')}
        ${step ? buddyBubble(SF.esc(step.text), {
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
        <form onsubmit="SF.actions.sendBuddy(event)" class="flex items-center gap-2">
          <input type="text" name="text" data-keep="buddy-input" maxlength="1000" autocomplete="off" placeholder="Напишите Бадди: план, дело, напоминание…" class="flex-1 bg-card border border-line-2 rounded-xl px-3 py-2.5 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]" />
          <button type="submit" class="p-2.5 rounded-xl btn-3d-tiffany flex items-center justify-center" aria-label="Отправить"><i data-lucide="send" class="w-4 h-4"></i></button>
        </form>
        ${left !== null && left <= 5 ? `<div class="text-[10px] text-faint text-center">${left ? `Сегодня Бадди ответит ещё на ${left} сообщ.` : 'На сегодня сообщения Бадди закончились — продолжим завтра'}</div>` : ''}
      ` : ''}
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
      await window.smartFlowApi.sendBuddyMessage(text, -new Date().getTimezoneOffset());
      SF.data.invalidate('buddy');
      await SF.data.buddy(0);
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

  SF.actions.dismissBuddyHint = () => {
    hintDismissed = true;
    store().notify();
  };

  SF.screens.buddy = {
    title: () => 'Бадди',
    render,
    afterRender() {
      SF.data.myChats();
      SF.data.marketplace();
      if (store().isBusinessActive()) SF.data.allInquiries();
      SF.data.buddy().then(() => {
        SF.scrollToBottom('buddy-scroll');
        markRead();
      });
      // New messages (replies, reminders, notifications) come by themselves while Buddy is open
      SF.data.poll('buddy', () => SF.data.buddy(10000).then(markRead), 15000);
    }
  };
})(window);
