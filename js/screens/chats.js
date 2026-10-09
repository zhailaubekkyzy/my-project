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

  // ---------------- List ----------------
  function row({ onclick, kind, photoUrl, title, subtitle, preview, unread }) {
    const si = kind === 'si';
    return `
      <button onclick="${onclick}" class="w-full p-3 rounded-2xl flex items-center gap-3 text-left border ${si ? 'bg-[var(--si-bubble)] border-[var(--si-bubble-line)]' : 'bg-[var(--human-bubble)] border-[var(--human-bubble-line)]'}">
        ${SF.avatar(photoUrl, { size: 44, kind: si ? 'si' : 'human' })}
        <span class="flex-1 min-w-0">
          <span class="flex items-center gap-1.5">
            <span class="text-sm font-bold text-ink truncate">${SF.esc(title)}</span>
            <span class="text-[10px] ${si ? 'text-si' : 'text-brand'} font-semibold whitespace-nowrap">${SF.esc(subtitle)}</span>
          </span>
          <span class="block text-[11px] text-muted truncate">${SF.esc(preview)}</span>
        </span>
        ${unread ? `<span class="w-2.5 h-2.5 rounded-full ${si ? 'bg-[var(--sf-si-red)]' : 'bg-[#81D8D0]'}"></span>` : ''}
      </button>`;
  }

  function renderList(state) {
    const chats = state.remote.chats;
    const lastAssistant = state.chats.assistant[state.chats.assistant.length - 1];
    const siRows = (chats || []).map(c => row({
      onclick: `SF.actions.openChat('${SF.js(c.slug)}')`,
      kind: 'si',
      photoUrl: c.photoUrl,
      title: c.name,
      subtitle: c.roleTitle,
      preview: stripPrefix(c.lastMessage),
      unread: SF.data.isUnread(state, c)
    }));
    const humanRows = (chats || []).filter(c => c.expertReplied).map(c => row({
      onclick: `SF.actions.openChat('${SF.js(c.slug)}')`,
      kind: 'human',
      photoUrl: null,
      title: c.expertName || 'Эксперт',
      subtitle: 'Эксперт',
      preview: `Переписка в чате «${c.name}»`,
      unread: false
    }));

    return `
      <div class="space-y-2">
        <div class="flex items-center gap-1.5 px-1 text-[11px] font-bold uppercase tracking-wider text-si"><span class="si-dot"></span>С SI</div>
        ${chats === null && SF.data.signedIn() ? '<div class="text-xs text-muted px-1">Загружаю…</div>' : ''}
        ${siRows.join('')}
        ${chats && !chats.length ? `
          <div class="text-xs text-muted px-1 leading-relaxed">Здесь появятся ваши переписки с SI-консультантами. Найдите консультанта в Маркетплейсе или откройте ссылку, которую дал эксперт.</div>
          <button onclick="SF.go('marketplace')" class="px-3 py-2 rounded-xl btn-3d-tiffany text-xs">Открыть Маркетплейс</button>` : ''}
        ${row({
          onclick: `SF.actions.openChat('${ASSISTANT}')`,
          kind: 'si',
          photoUrl: SF.MASCOTS.assistant,
          title: 'SmartFlow',
          subtitle: 'SI-ассистент',
          preview: lastAssistant ? lastAssistant.text : 'Жалобы и предложения по платформе',
          unread: false
        })}
      </div>
      <div class="space-y-2">
        <div class="flex items-center gap-1.5 px-1 text-[11px] font-bold uppercase tracking-wider text-brand"><i data-lucide="user" class="w-3.5 h-3.5"></i>С людьми</div>
        ${humanRows.length ? humanRows.join('') : '<div class="text-xs text-muted px-1">Когда эксперт ответит вам лично, переписка будет здесь.</div>'}
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
        <img src="${SF.MASCOTS.consultant}" alt="SI" class="mascot-avatar" />
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
            <span class="block text-[10px] text-si">${SF.esc(consultant?.roleTitle || 'SI-консультант')}${consultant?.author?.name ? ` · ${SF.esc(consultant.author.name)}` : ''}</span>
          </span>
        </button>
        <button onclick="SF.actions.requestHuman('${SF.js(slug)}')" class="px-2.5 py-1.5 rounded-xl btn-3d-tiffany text-[11px] flex items-center gap-1 flex-shrink-0">
          <i data-lucide="user" class="w-3.5 h-3.5"></i><span>Связаться с человеком</span>
        </button>
      </div>

      ${thread?.siPaused ? `
        <div class="p-2.5 rounded-xl bg-[var(--human-bubble)] border border-[var(--human-bubble-line)] text-[11px] text-ink-2">
          👤 Эксперт ответит вам лично. SI пока не отвечает в этом чате.
        </div>` : ''}

      <div class="glass-card-3d p-3 flex flex-col space-y-2.5 min-h-[320px] max-h-[460px] overflow-y-auto" id="chat-scroll">
        ${messages.length ? messages.map(m => bubble(m, consultant)).join('') : `
          <div class="flex items-end gap-1.5">
            <img src="${SF.MASCOTS.consultant}" alt="SI" class="mascot-avatar" />
            <div class="chat-bubble-si">Здравствуйте! Я ${SF.esc(consultant?.roleTitle || 'SI-консультант')}${consultant?.name ? ` «${SF.esc(consultant.name)}»` : ''}. ${consultant?.offer ? SF.esc(consultant.offer) + '. ' : ''}Задайте вопрос — отвечу сразу.</div>
          </div>`}
        <div id="si-typing" class="hidden flex items-end gap-1.5">
          <img src="${SF.MASCOTS.consultant}" alt="SI" class="mascot-avatar" />
          <div class="typing-dots"><span class="text-[10px] text-si font-medium mr-1.5">SI пишет</span><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>
        </div>
      </div>

      <form onsubmit="SF.actions.sendChat(event, '${SF.js(slug)}')" class="flex items-center gap-2">
        <input type="text" name="text" data-keep="chat-input" maxlength="2000" autocomplete="off" placeholder="Напишите сообщение..." class="flex-1 bg-card border border-line-2 rounded-xl px-3 py-2.5 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]" />
        <button type="submit" class="p-2.5 rounded-xl btn-3d-tiffany flex items-center justify-center" aria-label="Отправить">
          <i data-lucide="send" class="w-4 h-4"></i>
        </button>
      </form>
      <div class="text-[10px] text-faint text-center">SI может ошибаться. Важное уточняйте у эксперта.</div>
    `;
  }

  // ---------------- SI-assistant: complaints and suggestions ----------------
  function renderAssistant(state) {
    return `
      <div class="glass-card-3d p-3 flex items-center gap-2.5 border-[var(--si-bubble-line)]">
        ${SF.avatar(SF.MASCOTS.assistant, { size: 40, kind: 'si' })}
        <div>
          <div class="text-xs font-bold text-ink">SmartFlow</div>
          <div class="text-[10px] text-si">SI-ассистент · жалобы и предложения</div>
        </div>
      </div>
      <div class="glass-card-3d p-3 flex flex-col space-y-2.5 min-h-[280px] max-h-[460px] overflow-y-auto" id="chat-scroll">
        ${state.chats.assistant.map(m => m.sender === 'me'
          ? `<div class="flex justify-end"><div class="chat-bubble-human">${SF.formatChatMarkdown(m.text)}</div></div>`
          : `<div class="flex items-end gap-1.5"><img src="${SF.MASCOTS.assistant}" alt="SI" class="mascot-avatar" /><div class="chat-bubble-si">${SF.formatChatMarkdown(m.text)}</div></div>`
        ).join('')}
      </div>
      <form onsubmit="SF.actions.sendFeedback(event)" class="flex items-center gap-2">
        <input type="text" name="text" data-keep="assistant-input" maxlength="2000" autocomplete="off" placeholder="Жалоба, предложение или вопрос..." class="flex-1 bg-card border border-line-2 rounded-xl px-3 py-2.5 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]" />
        <button type="submit" class="p-2.5 rounded-xl btn-3d-tiffany flex items-center justify-center" aria-label="Отправить"><i data-lucide="send" class="w-4 h-4"></i></button>
      </form>
    `;
  }

  // ---------------- Actions ----------------
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
      showToast(err.status === 401 ? 'Войдите заново через Telegram' : 'Не отправилось. Проверьте интернет и попробуйте ещё раз');
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
      showToast('Не получилось отправить запрос. Попробуйте ещё раз');
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
    s.addAssistantMessage('me', text);
    let saved = false;
    if (SF.data.signedIn()) {
      try {
        await api().sendFeedback(text);
        saved = true;
      } catch (err) {}
    }
    s.addAssistantMessage('ai', saved
      ? 'Спасибо, записал! Передам команде SmartFlow. Если это жалоба на SI или человека — мы проверим переписку.'
      : 'Не получилось отправить: нет связи с сервером. Попробуйте ещё раз чуть позже.');
    SF.scrollToBottom('chat-scroll');
  };

  // ---------------- Screen ----------------
  SF.screens.chats = {
    title(route, state) {
      if (route.screen !== 'chat') return 'Чаты';
      if (route.slug === ASSISTANT) return 'SI-ассистент';
      const card = state.remote.cards[route.slug];
      return card ? `${card.roleTitle} · ${card.name}` : 'Чат';
    },
    render(route, state) {
      if (route.screen !== 'chat') return renderList(state);
      return route.slug === ASSISTANT ? renderAssistant(state) : renderChat(state, route.slug);
    },
    afterRender(route, state) {
      if (route.screen !== 'chat') {
        SF.data.myChats();
        return;
      }
      SF.scrollToBottom('chat-scroll');
      if (route.slug === ASSISTANT) return;
      const slug = route.slug;
      if (SF.data.isMissing(state, slug)) return;
      SF.data.cardBySlug(slug);
      SF.data.chatMessages(slug);
      const chat = (state.remote.chats || []).find(c => c.slug === slug);
      if (chat) store().markChatSeen(slug, chat.lastActivity);
      SF.data.poll(`chat:${slug}`, () => {
        SF.data.chatMessages(slug);
        SF.data.myChats();
      });
    }
  };
})(window);
