// screens/buddy.js - SI-Buddy: the central home screen.
// Widgets for every section, all notifications, and the next helpful step.

(function (window) {
  const SF = window.SF;

  let hintDismissed = false; // "Не сейчас" hides the hint until the app is reopened

  // The chain of hints after key events (see the structure document, "Бадди")
  function nextStep(state) {
    const me = state.me;
    const talked = state.clientSession.messages.length > 1;
    if (!talked) {
      return {
        text: 'Задайте вопрос SI-консультанту Елены — он ответит за пару секунд, голосом тоже можно.',
        primary: { label: 'Открыть чат', action: "SF.actions.openChat('si-elena')" }
      };
    }
    if (!me.business.active) {
      return {
        text: 'Хотите такого же SI-консультанта, чтобы он общался с вашими клиентами? У вас есть свой продукт или услуга?',
        primary: { label: 'Да, есть продукт', action: "SF.openIn('marketplace', 'office')" },
        secondary: { label: 'Не сейчас', action: 'SF.actions.dismissBuddyHint()' }
      };
    }
    if (SF.trustScore(me).score < 60) {
      return {
        text: 'Заполните профиль, чтобы посетители вам доверяли. Покажу, что поднимет доверие быстрее всего.',
        primary: { label: 'К профилю', action: "SF.openIn('profile', 'edit')" }
      };
    }
    return {
      text: 'Всё готово: Офис открыт, профиль заполнен. Скоро здесь появится Комьюнити — группы с целью и серией дней.',
      primary: null
    };
  }

  function notifications(state) {
    const list = [];
    state.chats.list.filter(c => c.unread).forEach(c => {
      list.push({
        kind: c.kind,
        text: c.kind === 'si'
          ? `${c.roleTitle} · ${c.title} написал вам`
          : `${c.title} написал(а) вам`,
        action: `SF.actions.openChat('${SF.js(c.id)}')`
      });
    });
    if (state.me.business.active) {
      const waiting = state.expert.directHumanInquiries.filter(i => i.status === 'waiting').length;
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
    const step = hintDismissed && !state.me.business.active ? null : nextStep(state);
    const notes = notifications(state);
    const trust = SF.trustScore(me);
    const unread = state.chats.list.reduce((n, c) => n + (c.unread || 0), 0);
    const lastSi = [...state.clientSession.messages].reverse().find(m => m.sender === 'ai');
    const top = state.marketplace.consultants[0];
    const waiting = state.expert.directHumanInquiries.filter(i => i.status === 'waiting').length;

    return `
      <!-- Greeting -->
      <div class="glass-card-3d p-4 flex items-center gap-3">
        <img src="${SF.MASCOTS.buddy}" alt="" class="w-16 h-16 flex-shrink-0" />
        <div>
          <div class="text-base font-extrabold text-ink">Привет, ${firstName}!</div>
          <div class="text-xs text-muted leading-snug">Я Бадди. Все уведомления приходят сюда, и я на вашей стороне: без спама и лишних офферов.</div>
        </div>
      </div>

      ${step ? `
        <!-- Next step -->
        <div class="hero-tiffany-banner p-4 space-y-3">
          <div class="text-[11px] font-extrabold uppercase tracking-wider">Следующий шаг</div>
          <div class="text-sm font-semibold leading-snug">${step.text}</div>
          ${step.primary ? `
            <div class="flex gap-2">
              <button onclick="${step.primary.action}" class="px-3 py-2 rounded-xl bg-white/90 text-[#0b2530] text-xs font-bold">${step.primary.label}</button>
              ${step.secondary ? `<button onclick="${step.secondary.action}" class="px-3 py-2 rounded-xl text-[#0b2530] text-xs font-semibold">${step.secondary.label}</button>` : ''}
            </div>
          ` : ''}
        </div>
      ` : ''}

      <!-- Notifications -->
      <div class="space-y-2">
        ${SF.sectionTitle('bell', 'Уведомления')}
        ${notes.length ? notes.map(n => `
          <button onclick="${n.action}" class="w-full p-3 rounded-2xl text-left text-xs font-medium flex items-center gap-2.5 border ${n.kind === 'si' ? 'bg-[var(--si-bubble)] border-[var(--si-bubble-line)]' : 'bg-[var(--human-bubble)] border-[var(--human-bubble-line)]'} text-ink">
            ${n.kind === 'si' ? '<span class="si-dot"></span>' : '<i data-lucide="user" class="w-4 h-4 text-brand"></i>'}
            <span class="flex-1">${n.text}</span>
            <i data-lucide="chevron-right" class="w-4 h-4 text-faint"></i>
          </button>
        `).join('') : `<div class="text-xs text-muted px-1">Новых уведомлений нет. Отдыхайте 🙂</div>`}
      </div>

      <!-- Widgets for every section -->
      <div class="grid grid-cols-2 gap-2.5">
        ${widget({
          icon: 'messages-square',
          title: 'Чаты',
          tone: 'si',
          body: unread ? `${unread} непрочитанн.` : (lastSi ? SF.esc(lastSi.text.replace(/\*\*/g, '').slice(0, 70)) + '…' : 'Переписки с SI и людьми'),
          action: "SF.go('chats')"
        })}
        ${widget({
          icon: 'store',
          title: 'Маркетплейс',
          body: `${SF.esc(top.roleTitle)} · ${SF.esc(top.name)}: ${SF.esc(top.offer)}`,
          action: "SF.go('marketplace')"
        })}
        ${widget({
          icon: 'briefcase',
          title: 'Офис',
          body: me.business.active
            ? (waiting ? `Ждут ответа: ${waiting}` : `SI-консультантов: ${state.office.consultants.length}`)
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
          icon: 'users-round',
          title: 'Комьюнити',
          body: 'Группы с целью, серия дней и рейтинг — скоро',
          action: "SF.go('community')",
          disabled: true
        })}
        ${widget({
          icon: 'life-buoy',
          title: 'Помощь',
          tone: 'si',
          body: 'SI-ассистент примет жалобу или предложение',
          action: "SF.actions.openChat('si-assistant')"
        })}
      </div>
    `;
  }

  SF.actions.dismissBuddyHint = () => {
    hintDismissed = true;
    window.funnelStore.notify();
  };

  SF.screens.buddy = {
    title: () => 'Бадди',
    render
  };
})(window);
