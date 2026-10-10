// screens/buddy.js - SI-Buddy: the central home screen for everyone who just opens the app.
// Widgets for every section, all notifications, and the next helpful step. Real data only.

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
    const consultants = state.office.consultants;
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

  function notifications(state) {
    const list = [];
    (state.remote.chats || []).filter(c => SF.data.isUnread(state, c)).forEach(c => {
      const fromExpert = /^\[Эксперт\]/.test(c.lastMessage || '');
      list.push({
        kind: fromExpert ? 'human' : 'si',
        text: fromExpert ? `${c.expertName || 'Эксперт'} ответил(а) вам лично` : `${c.name}: новое сообщение`,
        action: `SF.actions.openChat('${SF.js(c.slug)}')`
      });
    });
    if (store().isBusinessActive()) {
      const waiting = SF.data.waitingInquiries(state).length;
      if (waiting) {
        list.push({
          kind: 'human',
          text: `${waiting} чел. ждут вашего личного ответа в «Мне написали»`,
          action: "SF.openIn('marketplace', 'office', { section: 'inbox' })"
        });
      }
    }
    return list;
  }

  function widget({ icon, title, body, action, tone = 'human', disabled = false }) {
    return `
      <button onclick="${action}" class="glass-card-3d p-3 text-left flex flex-col gap-1.5 ${disabled ? 'opacity-60' : ''} ${tone === 'si' ? 'border-[var(--si-bubble-line)]' : ''}">
        <div class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider ${tone === 'si' ? 'text-si' : 'text-brand'}">
          <i data-lucide="${icon}" class="w-4 h-4"></i>
          <span class="truncate">${title}</span>
        </div>
        <div class="text-xs text-ink-2 leading-snug">${body}</div>
      </button>`;
  }

  function render(route, state) {
    const me = state.me;
    const firstName = SF.esc((me.displayName || '').split(' ')[0] || 'друг');
    const step = nextStep(state);
    const notes = notifications(state);
    const trust = SF.trustScore(me);
    const chats = state.remote.chats || [];
    const unread = chats.filter(c => SF.data.isUnread(state, c)).length;
    const listed = (state.remote.marketplace || []).length;
    const business = store().isBusinessActive();
    const waiting = SF.data.waitingInquiries(state).length;

    return `
      <div class="glass-card-3d p-4 flex items-center gap-3">
        <img src="${SF.MASCOTS.buddy}" alt="" class="w-16 h-16 flex-shrink-0" />
        <div>
          <div class="text-base font-extrabold text-ink">Привет, ${firstName}!</div>
          <div class="text-xs text-muted leading-snug">Я Бадди. Все уведомления приходят сюда, и я на вашей стороне: без спама и лишних офферов.</div>
        </div>
      </div>

      ${state.auth.status === 'offline' ? `
        <div class="p-3 rounded-2xl bg-sunken border border-line text-xs text-muted">Нет связи с сервером. Откройте приложение в Telegram или проверьте интернет.</div>` : ''}

      ${step ? `
        <div class="hero-tiffany-banner p-4 space-y-3">
          <div class="text-[11px] font-extrabold uppercase tracking-wider">Следующий шаг</div>
          <div class="text-sm font-semibold leading-snug">${step.text}</div>
          ${step.primary ? `
            <div class="flex flex-wrap gap-2">
              <button onclick="${step.primary.action}" class="px-3 py-2 rounded-xl bg-white/90 text-[#0b2530] text-xs font-bold">${step.primary.label}</button>
              ${step.secondary ? `<button onclick="${step.secondary.action}" class="px-3 py-2 rounded-xl text-[#0b2530] text-xs font-semibold">${step.secondary.label}</button>` : ''}
            </div>
          ` : ''}
        </div>
      ` : ''}

      <div class="space-y-2">
        ${SF.sectionTitle('bell', 'Уведомления')}
        ${notes.length ? notes.map(n => `
          <button onclick="${n.action}" class="w-full p-3 rounded-2xl text-left text-xs font-medium flex items-center gap-2.5 border ${n.kind === 'si' ? 'bg-[var(--si-bubble)] border-[var(--si-bubble-line)]' : 'bg-[var(--human-bubble)] border-[var(--human-bubble-line)]'} text-ink">
            ${n.kind === 'si' ? '<span class="si-dot"></span>' : '<i data-lucide="user" class="w-4 h-4 text-brand"></i>'}
            <span class="flex-1">${SF.esc(n.text)}</span>
            <i data-lucide="chevron-right" class="w-4 h-4 text-faint"></i>
          </button>
        `).join('') : `<div class="text-xs text-muted px-1">Новых уведомлений нет.</div>`}
      </div>

      <div class="grid grid-cols-2 gap-2.5">
        ${widget({
          icon: 'messages-square',
          title: 'Чаты',
          tone: 'si',
          body: unread ? `Новых сообщений: ${unread}` : (chats.length ? `Переписок: ${chats.length}` : 'Ваши переписки'),
          action: "SF.go('chats')"
        })}
        ${widget({
          icon: 'store',
          title: 'Маркетплейс',
          body: listed ? `SI-продавцов на витрине: ${listed}` : 'Витрина SI-продавцов экспертов',
          action: "SF.go('marketplace')"
        })}
        ${widget({
          icon: 'briefcase',
          title: 'Офис',
          body: business
            ? (waiting ? `Ждут ответа: ${waiting}` : `SI-продавцов: ${state.office.consultants.length}`)
            : 'Откройте бизнес-профиль, чтобы продавать через SI',
          action: "SF.openIn('marketplace', 'office')"
        })}
        ${widget({
          icon: 'badge-check',
          title: 'Профиль',
          body: `Доверие ${trust.score}%${SF.progressBar(trust.score)}`,
          action: "SF.go('profile')"
        })}
        ${widget({
          icon: 'sprout',
          title: 'Инкубатор',
          body: 'Группы с целью, серия дней и рейтинг — скоро',
          action: "SF.go('incubator')",
          disabled: true
        })}
        ${widget({
          icon: 'life-buoy',
          title: 'Помощь',
          tone: 'si',
          body: 'Поддержка примет жалобу или предложение',
          action: "SF.actions.openChat('assistant')"
        })}
      </div>
    `;
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
    }
  };
})(window);
