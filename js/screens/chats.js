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
    return String(text || '').replace(/^\[(SI|Эксперт)\]:\s*/, '');
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
            <div class="text-xs text-muted leading-relaxed">Откройте ссылку, которую дал эксперт, или найдите консультанта в Маркетплейсе.</div>
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
  function bubble(msg, consultant) {
    if (msg.sender === 'client') {
      return `<div class="flex justify-end"><div class="chat-bubble-human">${SF.formatChatMarkdown(msg.text)}</div></div>`;
    }
    if (msg.sender === 'expert_human') {
      return `
        <div class="flex flex-col items-start">
          <div class="text-[9px] text-brand font-semibold px-1 mb-0.5">👤 ${SF.esc(consultant?.author?.name || 'Эксперт')} лично</div>
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

  function renderChat(state, slug) {
    if (!SF.data.signedIn()) {
      return SF.emptyState('assistant', 'Откройте приложение в Telegram', 'Переписка с SI-консультантом доступна после входа через Telegram.');
    }
    const consultant = state.remote.cards[slug];
    const thread = state.remote.messages[slug];
    if (!consultant && SF.data.isMissing(state, slug)) {
      return SF.emptyState('assistant', 'SI-консультант не найден', 'Возможно, ссылка устарела или эксперт выключил консультанта.');
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
        ${messages.map(m => bubble(m, consultant)).join('')}
        <div id="si-typing" class="${messages.length ? 'hidden' : ''} flex items-end gap-1.5">
          <img src="${SF.photoSrc(consultant?.photoUrl, SF.MASCOTS.consultant)}" alt="" class="mascot-avatar object-cover" />
          <div class="typing-dots"><span class="text-[10px] text-muted font-medium mr-1.5">печатает</span><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>
        </div>
      </div>

      <form onsubmit="SF.actions.sendChat(event, '${SF.js(slug)}')" class="flex items-center gap-2">
        <input type="text" name="text" data-keep="chat-input" maxlength="2000" autocomplete="off" placeholder="Напишите сообщение..." class="flex-1 bg-card border border-line-2 rounded-xl px-3 py-2.5 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]" />
        <button type="submit" class="p-2.5 rounded-xl btn-3d-tiffany flex items-center justify-center" aria-label="Отправить">
          <i data-lucide="send" class="w-4 h-4"></i>
        </button>
      </form>
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

  SF.actions.buy = (slug) => {
    const card = store().data.remote.cards[slug];
    if (card?.paymentUrl) SF.openLink(card.paymentUrl);
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
