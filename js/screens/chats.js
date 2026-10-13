// screens/chats.js - Chats: with SI-consultants (soft red) and with people (Tiffany).
// Real data from the server (js/data.js): my chats as a client, messages, SI replies.
// A chat opens by the consultant's link: t.me/smartflow_ai_support_bot/app?startapp=<slug>.

(function (window) {
  const SF = window.SF;
  const showToast = SF.showToast;
  const ASSISTANT = 'assistant';
  let sending = false;

  const store = () => window.funnelStore;
  const api = () => window.smartFlowApi;

  function stripPrefix(text) {
    return String(text || '').replace(/^\[(SI|Эксперт|Помощник)\]:\s*/, '');
  }

  // ---------------- List: one list of conversations, newest first ----------------
  function row({ onclick, kind, photoUrl, title, preview, unread }) {
    return `
      <button onclick="${onclick}" class="w-full p-3 rounded-2xl flex items-center gap-3 text-left bg-card border border-line">
        ${SF.avatar(photoUrl, { size: 44, kind })}
        <span class="flex-1 min-w-0">
          <span class="block text-sm font-bold text-ink truncate">${SF.esc(title)}</span>
          <span class="block text-[11px] text-muted truncate">${SF.esc(preview)}</span>
        </span>
        ${unread ? '<span class="w-2.5 h-2.5 rounded-full bg-[#81D8D0]"></span>' : ''}
      </button>`;
  }

  function renderList(state) {
    const chats = state.remote.chats;
    const assistantList = assistantMessages(state);
    const lastAssistant = assistantList[assistantList.length - 1];
    return `
      <div class="space-y-2">
        ${chats === null && SF.data.signedIn() ? '<div class="text-xs text-muted px-1">Загружаю…</div>' : ''}
        ${(chats || []).map(c => row({
          onclick: `SF.actions.openChat('${SF.js(c.slug)}')`,
          kind: 'si',
          photoUrl: c.photoUrl,
          title: c.name,
          preview: stripPrefix(c.lastMessage),
          unread: SF.data.isUnread(state, c)
        })).join('')}
        ${chats && !chats.length ? `
          <div class="glass-card-3d p-4 space-y-2 text-center">
            <div class="text-sm font-bold text-ink">Пока нет переписок</div>
            <div class="text-xs text-muted leading-relaxed">Откройте ссылку, которую дал эксперт, или найдите SI-продавца в Маркетплейсе.</div>
            <button onclick="SF.go('marketplace')" class="px-3 py-2 rounded-xl btn-3d-tiffany text-xs">Открыть Маркетплейс</button>
          </div>` : ''}
        ${row({
          onclick: `SF.actions.openChat('${ASSISTANT}')`,
          kind: 'si',
          photoUrl: SF.MASCOTS.assistant,
          title: 'Поддержка SmartFlow',
          preview: lastAssistant ? lastAssistant.text : 'Жалобы и предложения по платформе',
          unread: false
        })}
      </div>
    `;
  }

  // ---------------- Chat with an SI-consultant ----------------
  function bubble(msg, consultant, slug) {
    if (msg.sender === 'client') {
      const body = msg.voiceId ? SF.voiceContent(msg, `/api/chat/${encodeURIComponent(slug)}/voice/${msg.voiceId}`) : SF.formatChatMarkdown(msg.text);
      return `<div class="flex justify-end"><div class="chat-bubble-human">${body}</div></div>`;
    }
    if (msg.sender === 'expert_human') {
      return `
        <div class="flex flex-col items-start">
          <div class="text-[9px] text-brand font-semibold px-1 mb-0.5">👤 ${msg.authorType === 'assistant' ? `Помощник ${SF.esc(consultant?.author?.name || 'эксперта')}` : `${SF.esc(consultant?.author?.name || 'Эксперт')} лично`}</div>
          <div class="chat-bubble-expert">${SF.formatChatMarkdown(msg.text)}</div>
        </div>`;
    }
    return `
      <div class="flex items-end gap-1.5">
        <img src="${SF.photoSrc(consultant?.photoUrl, SF.MASCOTS.consultant)}" alt="" class="mascot-avatar object-cover" />
        <div class="chat-bubble-si">${SF.formatChatMarkdown(msg.text)}</div>
      </div>`;
  }

  // "Купить" leads to this consultant's own payment link (SmartFlow takes no payments)
  function buyBanner(state, slug, consultant, messages) {
    if (!consultant?.paymentUrl || state.chats.hiddenBanners[slug]) return '';
    const clientMessages = messages.filter(m => m.sender === 'client').length;
    if (clientMessages < 2) return '';
    return `
      <div class="sticky top-0 z-10 p-3 rounded-2xl bg-card border border-[#81D8D0] shadow-lg flex items-center gap-2">
        <img src="${SF.MASCOTS.buddy}" alt="" class="w-8 h-8 flex-shrink-0" />
        <div class="flex-1 min-w-0">
          <div class="text-[10px] text-muted">Готовы начать?</div>
          <div class="text-xs font-bold text-ink truncate">${SF.esc(consultant.priceLabel || consultant.offer)}</div>
        </div>
        <button onclick="SF.actions.buy('${SF.js(slug)}')" class="px-3 py-2 rounded-xl btn-3d-tiffany text-xs">Купить</button>
        <button onclick="SF.actions.hideBuyBanner('${SF.js(slug)}')" class="px-1 text-faint text-lg leading-none" aria-label="Не интересно">&times;</button>
      </div>`;
  }

  // Small buttons above the input: share the contact (Telegram's own dialog) and send a receipt.
  // Hidden by default; the server says when the conversation needs them (thread.tools).
  const canShareContact = () => typeof window.Telegram?.WebApp?.requestContact === 'function' &&
    (!window.Telegram.WebApp.isVersionAtLeast || window.Telegram.WebApp.isVersionAtLeast('6.9'));
  function chatTools(slug, consultant, thread) {
    const tools = (thread && thread.tools) || {};
    const contact = Boolean(tools.contact) && !thread.contactShared && canShareContact();
    const receipt = Boolean(tools.receipt) && Boolean(consultant?.paymentUrl);
    const book = tools.booking === 'book' || tools.booking === 'meeting';
    if (!contact && !receipt && !book) return '';
    return `
      <div class="flex gap-2">
        ${book ? `<button onclick="SF.actions.openBooking('${SF.js(slug)}')" class="flex-1 py-1.5 rounded-xl bg-card border border-[#81D8D0] text-[11px] text-ink-2 flex items-center justify-center gap-1"><i data-lucide="calendar" class="w-3.5 h-3.5"></i>${tools.booking === 'meeting' ? 'Моя встреча' : 'Записаться'}</button>` : ''}
        ${contact ? `<button onclick="SF.actions.shareContact('${SF.js(slug)}')" class="flex-1 py-1.5 rounded-xl bg-card border border-line text-[11px] text-ink-2 flex items-center justify-center gap-1"><i data-lucide="phone" class="w-3.5 h-3.5"></i>Поделиться контактом</button>` : ''}
        ${receipt ? `<button onclick="SF.actions.sendReceipt('${SF.js(slug)}')" class="flex-1 py-1.5 rounded-xl bg-card border border-line text-[11px] text-ink-2 flex items-center justify-center gap-1"><i data-lucide="receipt" class="w-3.5 h-3.5"></i>Отправить чек</button>` : ''}
      </div>`;
  }

  function renderChat(state, slug) {
    if (!SF.data.signedIn()) {
      return SF.emptyState('assistant', 'Откройте приложение в Telegram', 'Переписка с SI-продавцом доступна после входа через Telegram.');
    }
    const consultant = state.remote.cards[slug];
    const thread = state.remote.messages[slug];
    if (!consultant && SF.data.isMissing(state, slug)) {
      return SF.emptyState('assistant', 'SI-продавец не найден', 'Возможно, ссылка устарела или эксперт выключил SI-продавца.');
    }
    if (!consultant && !thread) return '<div class="text-xs text-muted">Загружаю…</div>';
    const messages = thread ? thread.messages : [];

    return `
      ${buyBanner(state, slug, consultant, messages)}

      <div class="glass-card-3d p-3 border-[var(--si-bubble-line)] flex items-center justify-between gap-2">
        <button onclick="${consultant?.isListed ? `SF.openIn('marketplace', 'consultant', { id: '${SF.js(consultant.id)}' })` : ''}" class="flex items-center gap-2.5 min-w-0 text-left">
          ${SF.avatar(consultant?.photoUrl, { size: 40, kind: 'si' })}
          <span class="min-w-0">
            <span class="block text-xs font-bold text-ink truncate">${SF.esc(consultant?.name || '')}</span>
            <span class="block text-[10px] text-faint">${SF.esc(consultant?.roleTitle || 'SI-консультант')}${consultant?.author?.name ? ` · ${SF.esc(consultant.author.name)}` : ''}</span>
          </span>
        </button>
        <button onclick="SF.actions.requestHuman('${SF.js(slug)}')" class="px-2.5 py-1.5 rounded-xl btn-3d-tiffany text-[11px] flex items-center gap-1 flex-shrink-0">
          <i data-lucide="user" class="w-3.5 h-3.5"></i><span>Связаться с человеком</span>
        </button>
      </div>

      ${thread?.siPaused ? `
        <div class="p-2.5 rounded-xl bg-[var(--human-bubble)] border border-[var(--human-bubble-line)] text-[11px] text-ink-2">
          👤 Эксперт скоро ответит вам лично прямо здесь.
        </div>` : ''}

      <div class="glass-card-3d p-3 flex flex-col space-y-2.5 min-h-[320px] max-h-[460px] overflow-y-auto" id="chat-scroll">
        ${messages.map(m => bubble(m, consultant, slug)).join('')}
        <div id="si-typing" class="${messages.length ? 'hidden' : ''} flex items-end gap-1.5">
          <img src="${SF.photoSrc(consultant?.photoUrl, SF.MASCOTS.consultant)}" alt="" class="mascot-avatar object-cover" />
          <div class="typing-dots"><span class="text-[10px] text-muted font-medium mr-1.5">печатает</span><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>
        </div>
      </div>

      ${chatTools(slug, consultant, thread)}
      ${bookingPanel(slug)}

      ${voice && voice.slug === slug ? `
        <div class="flex items-center gap-2 p-2 rounded-xl bg-card border border-[#81D8D0]">
          <button onclick="SF.actions.cancelVoice()" class="p-2 rounded-lg btn-3d-dark" aria-label="Отменить запись"><i data-lucide="x" class="w-4 h-4"></i></button>
          <span class="flex-1 flex items-center gap-1.5 text-xs text-ink"><span class="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>Запись <span id="voice-timer" class="font-semibold">${voiceTime(voice.seconds)}</span><span class="text-faint">/ ${voiceTime(VOICE_MAX)}</span></span>
          <button onclick="SF.actions.sendVoice('${SF.js(slug)}')" class="p-2.5 rounded-xl btn-3d-tiffany flex items-center justify-center" aria-label="Отправить голосовое"><i data-lucide="send" class="w-4 h-4"></i></button>
        </div>` : `
      <form onsubmit="SF.actions.sendChat(event, '${SF.js(slug)}')" class="flex items-center gap-2">
        <input type="text" name="text" data-keep="chat-input" maxlength="2000" autocomplete="off" placeholder="Напишите сообщение..." class="flex-1 bg-card border border-line-2 rounded-xl px-3 py-2.5 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]" />
        ${window.sfMedia && window.sfMedia.canRecord() ? `
          <button type="button" onclick="SF.actions.startVoice('${SF.js(slug)}')" class="p-2.5 rounded-xl btn-3d-dark flex items-center justify-center" aria-label="Записать голосовое"><i data-lucide="mic" class="w-4 h-4"></i></button>` : ''}
        <button type="submit" class="p-2.5 rounded-xl btn-3d-tiffany flex items-center justify-center" aria-label="Отправить">
          <i data-lucide="send" class="w-4 h-4"></i>
        </button>
      </form>`}
    `;
  }

  // ---------------- SI-assistant: complaints and suggestions ----------------
  const ACK_TEXT = 'Спасибо, записал! Передам команде SmartFlow. Ответ придёт сюда и в Telegram.';

  // Messages of the support chat: the greeting, then my messages from the server with the team's
  // answers; messages that did not reach the server stay on this phone (state.chats.assistant).
  function assistantMessages(state) {
    const local = state.chats.assistant;
    const server = state.remote.myFeedback;
    if (!server) return local;
    const list = [local[0]];
    server.forEach(f => {
      list.push({ sender: 'me', text: f.text });
      list.push({ sender: 'ai', text: ACK_TEXT });
      if (f.reply) list.push({ sender: 'team', text: f.reply });
    });
    return list.concat(local.slice(1).filter(m => m.unsent));
  }

  function renderAssistant(state) {
    return `
      <div class="glass-card-3d p-3 flex items-center gap-2.5 border-[var(--si-bubble-line)]">
        ${SF.avatar(SF.MASCOTS.assistant, { size: 40, kind: 'si' })}
        <div>
          <div class="text-xs font-bold text-ink">Поддержка SmartFlow</div>
          <div class="text-[10px] text-faint">Жалобы, предложения и вопросы</div>
        </div>
      </div>
      <div class="glass-card-3d p-3 flex flex-col space-y-2.5 min-h-[280px] max-h-[460px] overflow-y-auto" id="chat-scroll">
        ${assistantMessages(state).map(m => {
          if (m.sender === 'me') return `<div class="flex justify-end"><div class="chat-bubble-human">${SF.formatChatMarkdown(m.text)}</div></div>`;
          if (m.sender === 'team') {
            return `
              <div class="flex flex-col items-start">
                <div class="text-[9px] text-brand font-semibold px-1 mb-0.5">👤 Команда SmartFlow</div>
                <div class="chat-bubble-expert">${SF.formatChatMarkdown(m.text)}</div>
              </div>`;
          }
          return `<div class="flex items-end gap-1.5"><img src="${SF.MASCOTS.assistant}" alt="SI" class="mascot-avatar" /><div class="chat-bubble-si">${SF.formatChatMarkdown(m.text)}</div></div>`;
        }).join('')}
      </div>
      <form onsubmit="SF.actions.sendFeedback(event)" class="flex items-center gap-2">
        <input type="text" name="text" data-keep="assistant-input" maxlength="2000" autocomplete="off" placeholder="Жалоба, предложение или вопрос..." class="flex-1 bg-card border border-line-2 rounded-xl px-3 py-2.5 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]" />
        <button type="submit" class="p-2.5 rounded-xl btn-3d-tiffany flex items-center justify-center" aria-label="Отправить"><i data-lucide="send" class="w-4 h-4"></i></button>
      </form>
      ${state.me.supportCode ? `<div class="text-[10px] text-faint text-center">Ваш номер в поддержке: ${SF.esc(state.me.supportCode)}. К сообщению автоматически прикладываются модель телефона, версия Telegram и коды последних ошибок — без ваших переписок.</div>` : ''}
    `;
  }

  // ---------------- Actions ----------------
  // First visit: the SI greets the person (once per chat)
  const started = {};
  async function startChat(slug) {
    if (started[slug] || !SF.data.signedIn()) return;
    started[slug] = true;
    try {
      const res = await api().startChat(slug);
      store().setRemote(`messages.${slug}`, { ...(store().data.remote.messages[slug] || {}), messages: res.messages || [] });
      SF.data.invalidate('chats');
      SF.data.myChats();
    } catch (err) {
      started[slug] = false;
    }
  }

  SF.actions.openChat = (slug) => SF.openIn('chats', 'chat', { slug });

  SF.actions.sendChat = async (e, slug) => {
    e.preventDefault();
    const input = e.target.text;
    const text = input.value.trim();
    if (!text || sending) return;
    sending = true;
    input.value = '';
    const s = store();
    const thread = s.data.remote.messages[slug] || { messages: [], siPaused: false };
    // A new object (not a change in place), so the store sees the difference and re-renders
    s.setRemote(`messages.${slug}`, { ...thread, messages: [...thread.messages, { id: `local-${Date.now()}`, sender: 'client', text }] });
    document.getElementById('si-typing')?.classList.remove('hidden');
    SF.scrollToBottom('chat-scroll');
    try {
      const res = await api().sendChatMessage(slug, text);
      SF.data.invalidate(`messages:${slug}`);
      SF.data.invalidate('chats');
      await SF.data.chatMessages(slug);
      SF.data.myChats();
      if (res.limitReached) showToast('SI ответил на всё, что мог. Нажмите «Связаться с человеком»');
    } catch (err) {
      showToast(err.status === 401 ? 'Войдите заново через Telegram' : SF.withErrorCode('Не отправилось. Проверьте интернет и попробуйте ещё раз', err));
    } finally {
      sending = false;
      SF.scrollToBottom('chat-scroll');
    }
  };

  SF.actions.requestHuman = async (slug) => {
    SF.askWriteAccess(); // so the bot can tell the person when the expert answers
    try {
      await api().requestHuman(slug, 'Клиент нажал «Связаться с человеком»');
      SF.data.invalidate(`messages:${slug}`);
      SF.data.chatMessages(slug);
      showToast('Эксперт получил ваш запрос в Telegram и ответит здесь');
    } catch (err) {
      showToast(SF.withErrorCode('Не получилось отправить запрос. Попробуйте ещё раз', err));
    }
  };

  SF.actions.shareContact = (slug) => {
    const tg = window.Telegram?.WebApp;
    if (!tg || typeof tg.requestContact !== 'function') return;
    tg.requestContact(async (shared, answer) => {
      if (!shared) return;
      const response = answer && typeof answer === 'object' ? answer.response : null;
      if (!response) {
        showToast('Обновите Telegram, чтобы поделиться контактом');
        return;
      }
      try {
        await api().shareContact(slug, response);
        const thread = store().data.remote.messages[slug] || { messages: [] };
        store().setRemote(`messages.${slug}`, { ...thread, contactShared: true });
        showToast('Готово: эксперт увидит ваш номер');
      } catch (err) {
        showToast(SF.withErrorCode(err.message || 'Не получилось', err));
      }
    });
  };

  SF.actions.sendReceipt = async (slug) => {
    if (!window.sfMedia || sending) return;
    try {
      const file = await window.sfMedia.pickReceipt();
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        showToast('Файл больше 5 МБ. Сделайте снимок экрана с чеком');
        return;
      }
      sending = true;
      showToast('Отправляю чек…');
      await api().uploadReceipt(slug, file);
      SF.data.invalidate(`messages:${slug}`);
      await SF.data.chatMessages(slug);
      SF.askWriteAccess(); // so the bot can tell the person when the payment is confirmed
      showToast('Чек отправлен. Эксперт проверит оплату и напишет здесь');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не отправилось. Попробуйте ещё раз', err));
    } finally {
      sending = false;
      SF.scrollToBottom('chat-scroll');
    }
  };

  // ---------------- Booking a meeting (free times of the expert and the assistant) ----------------
  // Times come from the server in UTC and are shown in the phone's own time zone.
  let booking = null; // { slug, data, mode: 'book' | 'reschedule', day }
  const dayKey = (iso) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };
  const dayLabel = (iso) => new Date(iso).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
  const timeLabel = (iso) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const whenLabel = (iso) => `${dayLabel(iso)}, ${timeLabel(iso)}`;

  function rulesText(rules) {
    if (!rules) return '';
    const can = [rules.clientCanReschedule && 'перенести', rules.clientCanCancel && 'отменить'].filter(Boolean);
    if (!can.length) return 'Перенести или отменить встречу можно через чат — напишите эксперту.';
    return `${can.join(' или ')[0].toUpperCase()}${can.join(' или ').slice(1)} можно${rules.hoursBefore ? ` не позже чем за ${rules.hoursBefore} ч` : ''} — здесь же.`;
  }

  function bookingPanel(slug) {
    if (!booking || booking.slug !== slug) return '';
    const d = booking.data;
    const head = (title) => `
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold text-ink flex items-center gap-1.5"><i data-lucide="calendar" class="w-4 h-4 text-brand"></i>${title}</span>
        <button onclick="SF.actions.closeBooking()" class="px-1 text-faint text-lg leading-none" aria-label="Закрыть">&times;</button>
      </div>`;
    const box = (inner) => `<div class="p-3 rounded-2xl bg-card border border-[#81D8D0] space-y-2.5">${inner}</div>`;
    if (!d) return box(`${head('Запись на встречу')}<div class="text-[11px] text-muted">Загружаю свободное время…</div>`);

    if (d.meeting && booking.mode !== 'reschedule') {
      const m = d.meeting;
      return box(`
        ${head('Ваша встреча')}
        <div class="text-sm font-semibold text-ink">${SF.esc(whenLabel(m.startsAt))}</div>
        <div class="text-[11px] text-muted">${d.durationMinutes} мин · время на вашем телефоне</div>
        ${m.zoomUrl ? `<button onclick="SF.openLink('${SF.js(m.zoomUrl)}')" class="w-full py-2 rounded-xl btn-3d-tiffany text-xs flex items-center justify-center gap-1"><i data-lucide="video" class="w-3.5 h-3.5"></i>Ссылка на встречу</button>` : '<div class="text-[11px] text-muted">Ссылку на встречу пришлют в этот чат.</div>'}
        ${m.canReschedule || m.canCancel ? `
          <div class="flex gap-2">
            ${m.canReschedule ? `<button onclick="SF.actions.startReschedule()" class="flex-1 py-1.5 rounded-xl bg-sunken border border-line text-[11px] text-ink-2">Перенести</button>` : ''}
            ${m.canCancel ? `<button onclick="SF.actions.cancelMeeting('${SF.js(slug)}')" class="flex-1 py-1.5 rounded-xl bg-sunken border border-line text-[11px] text-ink-2">Отменить</button>` : ''}
          </div>` : ''}
        <div class="text-[10px] text-faint">${SF.esc(m.canReschedule || m.canCancel ? rulesText(d.rules) : 'Перенести или отменить встречу теперь можно через чат — напишите эксперту.')}</div>`);
    }

    const days = [];
    for (const at of d.slots || []) {
      const key = dayKey(at);
      if (!days.find(x => x.key === key)) days.push({ key, at });
    }
    const title = booking.mode === 'reschedule' ? 'Перенести встречу' : 'Запись на встречу';
    if (!days.length) {
      return box(`${head(title)}<div class="text-[11px] text-muted">Свободного времени в ближайшие две недели пока нет. Напишите в чат — эксперт подберёт время.</div>`);
    }
    const day = days.find(x => x.key === booking.day) ? booking.day : days[0].key;
    const times = d.slots.filter(at => dayKey(at) === day);
    return box(`
      ${head(title)}
      <div class="text-[11px] text-muted">${d.durationMinutes} мин · время на вашем телефоне${booking.mode === 'reschedule' && d.meeting ? ` · сейчас: ${SF.esc(whenLabel(d.meeting.startsAt))}` : ''}</div>
      <div class="flex gap-1.5 overflow-x-auto pb-1">
        ${days.map(x => `<button onclick="SF.actions.pickBookingDay('${x.key}')" class="flex-shrink-0 px-2.5 py-1.5 rounded-xl text-[11px] ${x.key === day ? 'btn-3d-tiffany' : 'bg-sunken border border-line text-ink-2'}">${SF.esc(dayLabel(x.at))}</button>`).join('')}
      </div>
      <div class="grid grid-cols-4 gap-1.5">
        ${times.map(at => `<button onclick="SF.actions.pickSlot('${SF.js(slug)}', '${SF.js(at)}')" class="py-1.5 rounded-xl bg-sunken border border-line text-xs text-ink">${timeLabel(at)}</button>`).join('')}
      </div>
      ${booking.mode === 'reschedule' ? `<button onclick="SF.actions.stopReschedule()" class="w-full text-[11px] text-muted">Оставить как было</button>` : ''}`);
  }

  async function reloadBooking(slug) {
    try {
      const data = await api().getChatCalendar(slug);
      if (booking && booking.slug === slug) booking.data = data;
    } catch (err) {
      booking = null;
      showToast(SF.withErrorCode(err.message || 'Не получилось открыть запись', err));
    }
    store().notify();
  }

  SF.actions.openBooking = (slug) => {
    booking = { slug, data: null, mode: 'book', day: null };
    store().notify();
    reloadBooking(slug);
  };

  SF.actions.closeBooking = () => {
    booking = null;
    store().notify();
  };

  SF.actions.pickBookingDay = (key) => {
    if (!booking) return;
    booking.day = key;
    store().notify();
  };

  SF.actions.startReschedule = () => {
    if (!booking) return;
    booking.mode = 'reschedule';
    store().notify();
  };

  SF.actions.stopReschedule = () => {
    if (!booking) return;
    booking.mode = 'book';
    store().notify();
  };

  async function afterMeetingChange(slug, data, toast) {
    if (booking && booking.slug === slug) {
      booking.data = data;
      booking.mode = 'book';
    }
    SF.data.invalidate(`messages:${slug}`);
    await SF.data.chatMessages(slug);
    showToast(toast);
    SF.scrollToBottom('chat-scroll');
  }

  SF.actions.pickSlot = async (slug, at) => {
    if (!booking || sending) return;
    const moving = booking.mode === 'reschedule' && booking.data?.meeting;
    if (!window.confirm(`${moving ? 'Перенести встречу на' : 'Записаться на'} ${whenLabel(at)}?`)) return;
    sending = true;
    try {
      const res = moving
        ? await api().rescheduleMeeting(slug, booking.data.meeting.id, at)
        : await api().bookMeeting(slug, at);
      SF.askWriteAccess(); // so the bot can remind about the meeting an hour before
      await afterMeetingChange(slug, res.calendar, moving ? 'Встреча перенесена' : 'Готово, вы записаны');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не получилось записаться', err));
      if (err.status === 409) reloadBooking(slug);
    } finally {
      sending = false;
    }
  };

  SF.actions.cancelMeeting = async (slug) => {
    const meeting = booking?.data?.meeting;
    if (!meeting || sending || !window.confirm(`Отменить встречу ${whenLabel(meeting.startsAt)}?`)) return;
    sending = true;
    try {
      const res = await api().cancelMeeting(slug, meeting.id);
      await afterMeetingChange(slug, res.calendar, 'Встреча отменена');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не получилось отменить', err));
    } finally {
      sending = false;
    }
  };

  // ---------------- Voice messages (up to 1.5 minutes; the limit is a quiet timer) ----------------
  const VOICE_MAX = 90;
  let voice = null; // { slug, seconds, controller }
  const voiceTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  SF.actions.startVoice = async (slug) => {
    if (voice || sending || !window.sfMedia) return;
    try {
      const controller = await window.sfMedia.recordVoice({
        maxSeconds: VOICE_MAX,
        onTick: (s) => {
          if (!voice) return;
          voice.seconds = s;
          const el = document.getElementById('voice-timer');
          if (el) el.textContent = voiceTime(Math.min(s, VOICE_MAX));
        },
        onLimit: () => SF.actions.sendVoice(slug)
      });
      voice = { slug, seconds: 0, controller };
      store().notify();
    } catch (err) {
      voice = null;
      showToast(err && err.name === 'NotAllowedError'
        ? 'Разрешите доступ к микрофону для Telegram в настройках телефона'
        : 'Не получилось включить микрофон');
    }
  };

  SF.actions.cancelVoice = () => {
    if (!voice) return;
    voice.controller.cancel();
    voice = null;
    store().notify();
  };

  SF.actions.sendVoice = async (slug) => {
    if (!voice || voice.sending) return;
    voice.sending = true;
    const controller = voice.controller;
    const result = await controller.stop();
    voice = null;
    store().notify();
    if (!result || !result.blob.size) return;
    sending = true;
    document.getElementById('si-typing')?.classList.remove('hidden');
    SF.scrollToBottom('chat-scroll');
    try {
      await api().uploadVoice(slug, result.blob, Math.min(result.seconds, VOICE_MAX));
      SF.data.invalidate(`messages:${slug}`);
      SF.data.invalidate('chats');
      await SF.data.chatMessages(slug);
      SF.data.myChats();
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Голосовое не отправилось. Попробуйте ещё раз', err));
    } finally {
      sending = false;
      SF.scrollToBottom('chat-scroll');
    }
  };

  SF.actions.buy = (slug) => {
    const card = store().data.remote.cards[slug];
    if (card?.paymentUrl) SF.openLink(card.paymentUrl);
    // The expert sees «Нажал „Купить“» in the client's journal; a failure never blocks the payment
    // After «Купить» the "Отправить чек" button appears in this chat
    if (SF.data.signedIn()) {
      api().sendChatEvent(slug, 'buy_clicked')
        .then(() => { SF.data.invalidate(`messages:${slug}`); return SF.data.chatMessages(slug); })
        .catch(() => {});
    }
  };

  SF.actions.hideBuyBanner = (slug) => {
    store().hideBuyBanner(slug);
  };

  SF.actions.sendFeedback = async (e) => {
    e.preventDefault();
    const text = e.target.text.value.trim();
    if (!text) return;
    e.target.text.value = '';
    const s = store();
    let error = null;
    if (SF.data.signedIn()) {
      try {
        const res = await api().sendFeedback(text, SF.supportContext());
        const mine = s.data.remote.myFeedback || [];
        s.setRemote('myFeedback', [...mine, { id: res.id, text, status: 'new', reply: null }]);
        SF.data.invalidate('myFeedback');
        SF.data.myFeedback();
      } catch (err) {
        error = err;
      }
    } else {
      error = new Error('Откройте приложение в Telegram');
    }
    if (error) {
      s.addAssistantMessage('me', text, { unsent: true });
      s.addAssistantMessage('ai', `Не получилось отправить: ${error.message}. Попробуйте ещё раз чуть позже.`, { unsent: true });
    }
    SF.scrollToBottom('chat-scroll');
  };

  // ---------------- Screen ----------------
  SF.screens.chats = {
    title(route, state) {
      if (route.screen !== 'chat') return 'Чаты';
      if (route.slug === ASSISTANT) return 'Поддержка';
      const card = state.remote.cards[route.slug];
      return card ? card.name : 'Чат';
    },
    render(route, state) {
      if (route.screen !== 'chat') return renderList(state);
      return route.slug === ASSISTANT ? renderAssistant(state) : renderChat(state, route.slug);
    },
    afterRender(route, state) {
      if (route.screen !== 'chat') {
        SF.data.myChats();
        SF.data.myFeedback(60000);
        return;
      }
      SF.scrollToBottom('chat-scroll');
      if (route.slug === ASSISTANT) {
        SF.data.myFeedback(15000);
        return;
      }
      const slug = route.slug;
      if (SF.data.isMissing(state, slug)) return;
      SF.data.cardBySlug(slug);
      SF.data.chatMessages(slug);
      const thread = state.remote.messages[slug];
      if (thread && !thread.messages.length) startChat(slug);
      const chat = (state.remote.chats || []).find(c => c.slug === slug);
      if (chat) store().markChatSeen(slug, chat.lastActivity);
      SF.data.poll(`chat:${slug}`, () => {
        SF.data.chatMessages(slug);
        SF.data.myChats();
      });
    }
  };
})(window);
