// screens/chats.js - Chats: with SI-consultants (soft red) and with people (Tiffany).
// The main SI chat (Елена) uses store.clientSession and the demo replies of js/ai-engine.js;
// other chats are simple threads in store.chats.threads. Real SI replies come with OpenAI.

(function (window) {
  const SF = window.SF;
  const showToast = SF.showToast;
  const scrollToBottom = SF.scrollToBottom;
  const MAIN_SI_CHAT = 'si-elena';
  let activeVoicePlaybackId = null;

  function store() {
    return window.funnelStore;
  }

  function lastMessage(state, chat) {
    const msgs = chat.id === MAIN_SI_CHAT ? state.clientSession.messages : (state.chats.threads[chat.id] || []);
    const last = msgs[msgs.length - 1];
    return last ? last.text.replace(/\*\*/g, '').replace(/\n/g, ' ') : (chat.subtitle || '');
  }

  // ---------------- List ----------------
  function row(state, chat) {
    const si = chat.kind === 'si';
    return `
      <button onclick="SF.actions.openChat('${SF.js(chat.id)}')" class="w-full p-3 rounded-2xl flex items-center gap-3 text-left border ${si ? 'bg-[var(--si-bubble)] border-[var(--si-bubble-line)]' : 'bg-[var(--human-bubble)] border-[var(--human-bubble-line)]'}">
        ${SF.avatar(chat.photoUrl, { size: 44, kind: si ? 'si' : 'human' })}
        <span class="flex-1 min-w-0">
          <span class="flex items-center gap-1.5">
            <span class="text-sm font-bold text-ink truncate">${SF.esc(chat.title)}</span>
            <span class="text-[10px] ${si ? 'text-si' : 'text-brand'} font-semibold whitespace-nowrap">${SF.esc(chat.roleTitle || '')}</span>
          </span>
          <span class="block text-[11px] text-muted truncate">${SF.esc(lastMessage(state, chat))}</span>
        </span>
        ${chat.unread ? `<span class="min-w-5 h-5 px-1.5 rounded-full ${si ? 'bg-[var(--sf-si-red)] text-white' : 'bg-[#81D8D0] text-[#08302c]'} text-[10px] font-bold flex items-center justify-center">${chat.unread}</span>` : ''}
      </button>`;
  }

  function renderList(state) {
    const siChats = state.chats.list.filter(c => c.kind === 'si');
    const humanChats = state.chats.list.filter(c => c.kind === 'human');
    return `
      <div class="space-y-2">
        <div class="flex items-center gap-1.5 px-1 text-[11px] font-bold uppercase tracking-wider text-si"><span class="si-dot"></span>С SI</div>
        ${siChats.map(c => row(state, c)).join('')}
      </div>
      <div class="space-y-2">
        <div class="flex items-center gap-1.5 px-1 text-[11px] font-bold uppercase tracking-wider text-brand"><i data-lucide="user" class="w-3.5 h-3.5"></i>С людьми</div>
        ${humanChats.length ? humanChats.map(c => row(state, c)).join('') : '<div class="text-xs text-muted px-1">Пока нет переписок с людьми.</div>'}
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div class="p-3 rounded-2xl bg-card border border-line text-xs text-muted flex items-center gap-2"><i data-lucide="calendar" class="w-4 h-4"></i>Календарь ${SF.soonBadge()}</div>
        <div class="p-3 rounded-2xl bg-card border border-line text-xs text-muted flex items-center gap-2"><i data-lucide="tag" class="w-4 h-4"></i>Мои офферы ${SF.soonBadge()}</div>
      </div>
    `;
  }

  // ---------------- Platform offer banner above an SI chat ----------------
  // One offer at a time, shown by the platform (not by the SI), can be hidden.
  function renderBanner(state, chatId) {
    const banner = state.chats.banner[chatId];
    if (!banner || banner.hidden) return '';
    const c = state.marketplace.consultants.find(x => x.id === banner.consultantId);
    if (!c) return '';
    const isCta = banner.type === 'cta';
    return `
      <div class="sticky top-0 z-10 p-3 rounded-2xl bg-card border ${isCta ? 'border-[#81D8D0]' : 'border-line-2'} shadow-lg space-y-2">
        <div class="flex items-start gap-2">
          <img src="${SF.MASCOTS.buddy}" alt="" class="w-8 h-8 flex-shrink-0" />
          <div class="flex-1 min-w-0">
            <div class="text-[10px] text-muted">${isCta ? 'Готовы начать?' : `Бадди подобрал под вашу цель · ${SF.esc(banner.reason || '')}`}</div>
            <div class="text-xs font-bold text-ink">${SF.esc(c.priceLabel)}${isCta ? '' : ` · ${SF.esc(c.name)}`}</div>
          </div>
        </div>
        <div class="flex gap-2">
          ${isCta
            ? `<button onclick="SF.actions.openBuy('${SF.js(c.id)}')" class="flex-1 py-2 rounded-xl btn-3d-tiffany text-xs">Оплатить</button>`
            : `<button onclick="SF.openIn('marketplace', 'consultant', { id: '${SF.js(c.id)}' })" class="flex-1 py-2 rounded-xl btn-3d-tiffany text-xs">Посмотреть</button>`}
          <button onclick="SF.actions.hideBanner('${SF.js(chatId)}')" class="px-3 py-2 rounded-xl btn-3d-dark text-xs">Не интересно</button>
        </div>
      </div>`;
  }

  // ---------------- Main SI chat (Елена) ----------------
  function renderMainSiChat(state) {
    const session = state.clientSession;
    return `
      ${renderBanner(state, MAIN_SI_CHAT)}

      <div class="glass-card-3d p-3 border-[var(--si-bubble-line)] flex items-center justify-between gap-2">
        <div class="flex items-center gap-2.5 min-w-0">
          ${SF.avatar(session.expertAvatar, { size: 40, kind: 'si' })}
          <div class="min-w-0">
            <div class="text-xs font-bold text-ink truncate">SI-консультант · ${SF.esc(session.expertName)}</div>
            <div class="text-[10px] text-si">Онлайн • слушает аудио и текст 🎙️</div>
          </div>
        </div>
        <button onclick="window.triggerHumanContact()" class="px-2.5 py-1.5 rounded-xl btn-3d-tiffany text-[11px] flex items-center gap-1 flex-shrink-0">
          <i data-lucide="user" class="w-3.5 h-3.5"></i>
          <span>Связаться с человеком</span>
        </button>
      </div>

      <div class="flex gap-1.5 overflow-x-auto pb-1 text-xs">
        <button onclick="window.sendPredefinedMessage('Хочу записаться на диагностическую сессию к Елене')" class="px-2.5 py-1.5 rounded-xl btn-3d-tiffany text-xs whitespace-nowrap">📅 Записаться на разбор</button>
        <button onclick="window.sendPredefinedMessage('Покажите кейсы и отзывы ваших клиентов')" class="px-2.5 py-1.5 rounded-xl btn-3d-dark text-xs whitespace-nowrap">🏆 Кейсы и результаты</button>
        <button onclick="window.sendPredefinedMessage('Сколько стоит работа с Еленой и какие форматы?')" class="px-2.5 py-1.5 rounded-xl btn-3d-dark text-xs whitespace-nowrap">💰 Стоимость и рассрочка</button>
      </div>

      <div class="glass-card-3d p-3 flex flex-col space-y-2.5 min-h-[320px] max-h-[460px] overflow-y-auto" id="client-chat-scroll">
        ${session.messages.map(msg => `
          <div class="flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'} space-y-1">
            ${msg.isVoice ? `
              <div class="audio-voice-box max-w-[85%]">
                <div class="flex items-center gap-2">
                  <button onclick="window.toggleVoicePlay('${SF.js(msg.id)}')" class="w-8 h-8 rounded-full bg-[#81D8D0] text-[#090e17] flex items-center justify-center shadow-md" aria-label="Слушать">
                    <i data-lucide="play" class="w-4 h-4"></i>
                  </button>
                  <div>
                    <div class="text-xs font-bold text-ink">Голосовое <span class="text-[9px] text-brand font-mono">${SF.esc(msg.duration)}</span></div>
                    <div class="text-[9px] text-muted">SI-расшифровка голоса</div>
                  </div>
                </div>
                <div class="audio-waveform" id="waveform-${SF.esc(msg.id)}">
                  ${[2, 4, 6, 3, 5, 7, 4, 2, 5, 3].map(h => `<span class="waveform-bar h-${h}"></span>`).join('')}
                </div>
                <div class="text-[11px] text-ink-2 bg-card p-2 rounded-xl border border-line">
                  <span class="text-brand font-semibold">Расшифровка:</span> ${SF.esc(msg.text)}
                </div>
              </div>
            ` : (msg.sender === 'user' ? `
              <div class="chat-bubble-human">${SF.formatChatMarkdown(msg.text)}</div>
            ` : `
              <div class="flex items-end gap-1.5 w-full">
                <img src="${SF.MASCOTS.consultant}" alt="SI" class="mascot-avatar" />
                <div class="chat-bubble-si">${SF.formatChatMarkdown(msg.text)}</div>
              </div>
            `)}
            ${msg.quickReplies && msg.quickReplies.length ? `
              <div class="flex flex-wrap gap-1.5 pt-1">
                ${msg.quickReplies.map(qr => `
                  <button onclick="window.handleQuickReplyTap('${SF.js(qr)}')" class="text-[11px] px-2.5 py-1 rounded-xl bg-card text-brand border border-[#81D8D0]/50 shadow-sm font-semibold">${SF.esc(qr)}</button>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `).join('')}

        <div id="ai-typing-indicator" class="hidden flex items-end gap-1.5">
          <img src="${SF.MASCOTS.consultant}" alt="SI" class="mascot-avatar" />
          <div class="typing-dots">
            <span class="text-[10px] text-si font-medium mr-1.5" id="ai-action-status">SI формирует ответ...</span>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-between text-[10px] text-muted px-1">
        <span class="flex items-center gap-1.5"><i data-lucide="mic" class="w-3 h-3 text-brand"></i>SI слушает голосовые сообщения</span>
        <button onclick="window.clearClientChat()" class="text-faint hover:text-rose-400">Очистить чат</button>
      </div>

      <form onsubmit="window.handleClientSendMessage(event)" class="flex items-center gap-2">
        <button type="button" id="record-mic-btn" onclick="window.recordVoiceInteractive()" title="Записать голосовое сообщение" class="p-2.5 rounded-xl btn-3d-dark flex items-center justify-center">
          <i data-lucide="mic" class="w-4 h-4"></i>
        </button>
        <input type="text" id="client-chat-input" placeholder="Напишите текст или отправьте войс..." class="flex-1 bg-card border border-line-2 rounded-xl px-3 py-2.5 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]" />
        <button type="submit" class="p-2.5 rounded-xl btn-3d-tiffany flex items-center justify-center" aria-label="Отправить">
          <i data-lucide="send" class="w-4 h-4"></i>
        </button>
      </form>
    `;
  }

  // ---------------- Other chats (SI-assistant, other SI-consultants, people) ----------------
  function renderThread(state, chat) {
    const si = chat.kind === 'si';
    const messages = state.chats.threads[chat.id] || [];
    return `
      ${si ? renderBanner(state, chat.id) : ''}
      <div class="glass-card-3d p-3 flex items-center gap-2.5 ${si ? 'border-[var(--si-bubble-line)]' : 'border-[var(--human-bubble-line)]'}">
        ${SF.avatar(chat.photoUrl, { size: 40, kind: si ? 'si' : 'human' })}
        <div class="min-w-0">
          <div class="text-xs font-bold text-ink truncate">${SF.esc(chat.title)}</div>
          <div class="text-[10px] ${si ? 'text-si' : 'text-brand'}">${SF.esc(chat.roleTitle || '')}${chat.subtitle ? ` · ${SF.esc(chat.subtitle)}` : ''}</div>
        </div>
      </div>

      <div class="glass-card-3d p-3 flex flex-col space-y-2.5 min-h-[320px] max-h-[460px] overflow-y-auto" id="thread-scroll">
        ${messages.map(msg => {
          const mine = msg.sender === 'me';
          if (mine) return `<div class="flex flex-col items-end"><div class="chat-bubble-human">${SF.formatChatMarkdown(msg.text)}</div><div class="text-[9px] text-faint px-1 mt-0.5">${SF.esc(msg.time)}</div></div>`;
          if (si) return `<div class="flex items-end gap-1.5"><img src="${chat.id === 'si-assistant' ? SF.MASCOTS.assistant : SF.MASCOTS.consultant}" alt="SI" class="mascot-avatar" /><div class="chat-bubble-si">${SF.formatChatMarkdown(msg.text)}</div></div>`;
          return `<div class="flex flex-col items-start"><div class="chat-bubble-expert">${SF.formatChatMarkdown(msg.text)}</div><div class="text-[9px] text-faint px-1 mt-0.5">${SF.esc(msg.time)}</div></div>`;
        }).join('')}
      </div>

      <form onsubmit="SF.actions.sendThreadMessage(event, '${SF.js(chat.id)}')" class="flex items-center gap-2">
        <input type="text" name="text" maxlength="1000" autocomplete="off" placeholder="${chat.id === 'si-assistant' ? 'Жалоба, предложение или вопрос...' : 'Сообщение...'}" class="flex-1 bg-card border border-line-2 rounded-xl px-3 py-2.5 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]" />
        <button type="submit" class="p-2.5 rounded-xl btn-3d-tiffany flex items-center justify-center" aria-label="Отправить">
          <i data-lucide="send" class="w-4 h-4"></i>
        </button>
      </form>
    `;
  }

  // Demo replies until real SI replies (OpenAI) and people's messages (bot) are connected
  function demoThreadReply(chat) {
    if (chat.id === 'si-assistant') {
      return 'Спасибо, записал! Передам команде SmartFlow. Если это жалоба на SI или человека — мы проверим переписку и ответим здесь.';
    }
    if (chat.kind === 'si') {
      return 'Спасибо за вопрос! Это демо: настоящие ответы этого SI-консультанта появятся после подключения OpenAI. Пока могу показать карточку и условия — нажмите «Посмотреть» в Маркетплейсе.';
    }
    return null; // people answer themselves
  }

  // ---------------- Actions ----------------
  SF.actions.openChat = (chatId) => {
    const s = store();
    if (!s.findChat(chatId)) return;
    s.markChatRead(chatId);
    SF.openIn('chats', 'chat', { id: chatId });
  };

  SF.actions.hideBanner = (chatId) => {
    store().hideChatBanner(chatId);
    showToast('Понял, больше не покажу это предложение');
  };

  SF.actions.sendThreadMessage = (e, chatId) => {
    e.preventDefault();
    const text = e.target.text.value.trim();
    if (!text) return;
    const s = store();
    const chat = s.findChat(chatId);
    s.addThreadMessage(chatId, 'me', text);
    scrollToBottom('thread-scroll');
    const reply = chat && demoThreadReply(chat);
    if (reply) {
      setTimeout(() => {
        s.addThreadMessage(chatId, 'ai', reply);
        scrollToBottom('thread-scroll');
      }, 700);
    } else if (chat && chat.kind === 'human') {
      showToast(`${chat.title} получит сообщение и ответит здесь`);
    }
  };

  // Which platform offer to show above the main SI chat after a message (rules: one at a time)
  function updateBanner(userText) {
    const t = userText.toLowerCase();
    if (/дорог|нет денег|не потяну/.test(t)) {
      store().setChatBanner(MAIN_SI_CHAT, { type: 'alternative', consultantId: 'mc-elena-mini', reason: 'возражение «дорого»' });
    } else if (/оплат|купить|записат|готов/.test(t)) {
      store().setChatBanner(MAIN_SI_CHAT, { type: 'cta', consultantId: 'mc-elena' });
    }
  }

  function executeClientChatExchange(userText) {
    store().sendClientMessage(userText);
    scrollToBottom('client-chat-scroll');

    // Save the dialogue in the expert's CRM on the server
    if (window.smartFlowApi) {
      window.smartFlowApi.sendClientChat('elena-mentor', { name: 'Клиент Telegram', message: userText }).catch(() => {});
    }

    const indicator = document.getElementById('ai-typing-indicator');
    const statusText = document.getElementById('ai-action-status');
    if (indicator) {
      if (statusText) statusText.innerText = 'SI-консультант формирует ответ...';
      indicator.classList.remove('hidden');
    }

    setTimeout(() => {
      if (indicator) indicator.classList.add('hidden');
      SF.withAiEngine((aiEngine) => {
        const reply = aiEngine.generateSellerResponse(userText, store().data.clientSession.messages);
        store().addAiSellerReply(reply.text, reply.quickReplies);
        updateBanner(userText);
        scrollToBottom('client-chat-scroll');
      });
    }, 900);
  }

  window.triggerHumanContact = () => {
    const s = store();
    s.registerDirectInquiry({
      leadName: s.data.me.displayName || 'Посетитель Telegram',
      leadUsername: s.data.me.username ? `@${s.data.me.username}` : '@client_direct',
      summary: 'Нажал(а) «Связаться с человеком» в чате SI-консультанта.',
      lastDirectMessage: 'Хочу пообщаться лично с Еленой по условиям программы.'
    });

    if (window.smartFlowApi) {
      window.smartFlowApi.requestHumanContact('elena-mentor', {
        reason: 'Клиент нажал кнопку «Связаться с человеком» в SmartFlow.',
        leadName: s.data.me.displayName || 'Посетитель Telegram',
        leadUsername: s.data.me.username ? `@${s.data.me.username}` : null
      }).catch(() => {});
    }

    showToast('Елена получила ваш запрос. Ответ придёт в чат «Елена Смирнова»');
  };

  window.sendPredefinedMessage = (text) => executeClientChatExchange(text);

  window.handleQuickReplyTap = (text) => {
    if (text.includes('аудио') || text.includes('🎙️')) {
      window.recordVoiceInteractive();
    } else {
      executeClientChatExchange(text);
    }
  };

  window.handleClientSendMessage = (e) => {
    e.preventDefault();
    const input = document.getElementById('client-chat-input');
    if (!input || !input.value.trim()) return;
    const text = input.value.trim();
    input.value = '';
    executeClientChatExchange(text);
  };

  window.clearClientChat = () => {
    store().clearClientChat();
    store().setChatBanner(MAIN_SI_CHAT, null);
    showToast('Чат очищен');
  };

  // Voice: recording is simulated until Whisper is connected on the server
  window.simulateUserVoice = (transcription, duration) => {
    store().sendClientVoiceMessage(transcription, duration);
    scrollToBottom('client-chat-scroll');

    const indicator = document.getElementById('ai-typing-indicator');
    const statusText = document.getElementById('ai-action-status');
    if (indicator && statusText) {
      statusText.innerText = '🎧 SI расшифровывает аудио...';
      indicator.classList.remove('hidden');
    }

    setTimeout(() => {
      if (statusText) statusText.innerText = 'SI-консультант формирует ответ...';
      setTimeout(() => {
        if (indicator) indicator.classList.add('hidden');
        SF.withAiEngine((aiEngine) => {
          const reply = aiEngine.generateSellerResponse(transcription, store().data.clientSession.messages);
          store().addAiSellerReply(reply.text, reply.quickReplies);
          scrollToBottom('client-chat-scroll');
        });
      }, 900);
    }, 1100);
  };

  let isRecordingAudio = false;
  let recordingTimer = null;
  let recordingSeconds = 0;

  window.recordVoiceInteractive = () => {
    const micBtn = document.getElementById('record-mic-btn');
    const input = document.getElementById('client-chat-input');

    if (!isRecordingAudio) {
      isRecordingAudio = true;
      recordingSeconds = 0;
      if (micBtn) {
        micBtn.classList.remove('btn-3d-dark');
        micBtn.classList.add('bg-rose-600', 'animate-pulse');
        micBtn.innerHTML = '<i data-lucide="square" class="w-4 h-4 text-white"></i>';
      }
      if (input) {
        input.disabled = true;
        input.placeholder = '🔴 Идёт запись голосового... [0:00] • Нажмите для отправки';
      }
      if (window.lucide) window.lucide.createIcons();

      recordingTimer = setInterval(() => {
        recordingSeconds++;
        if (input) {
          input.placeholder = `🔴 Идёт запись голосового... [0:${recordingSeconds < 10 ? '0' : ''}${recordingSeconds}] • Нажмите для отправки`;
        }
      }, 1000);
    } else {
      isRecordingAudio = false;
      clearInterval(recordingTimer);
      const durationStr = `0:${recordingSeconds < 10 ? '0' : ''}${Math.max(2, recordingSeconds)}`;

      if (micBtn) {
        micBtn.classList.remove('bg-rose-600', 'animate-pulse');
        micBtn.classList.add('btn-3d-dark');
        micBtn.innerHTML = '<i data-lucide="mic" class="w-4 h-4"></i>';
      }
      if (input) {
        input.disabled = false;
        input.placeholder = 'Напишите текст или отправьте войс...';
      }
      if (window.lucide) window.lucide.createIcons();

      const samplePhrases = [
        'Здравствуйте! У меня проект в IT, команда 15 человек. Хочу понять, как выстроить систему делегирования и освободить время.',
        'Добрый день! Скажите, а какие гарантии дает Елена и как проходит стратегическая сессия?',
        'Здравствуйте! Подскажите, есть ли возможность созвониться лично с Еленой на этой неделе?'
      ];
      window.simulateUserVoice(samplePhrases[Math.floor(Math.random() * samplePhrases.length)], durationStr);
    }
  };

  window.toggleVoicePlay = (id) => {
    const waveform = document.getElementById('waveform-' + id);
    if (!waveform) return;
    if (activeVoicePlaybackId === id) {
      waveform.classList.remove('waveform-playing');
      activeVoicePlaybackId = null;
    } else {
      document.querySelectorAll('.waveform-playing').forEach(el => el.classList.remove('waveform-playing'));
      waveform.classList.add('waveform-playing');
      activeVoicePlaybackId = id;
      setTimeout(() => {
        waveform.classList.remove('waveform-playing');
        activeVoicePlaybackId = null;
      }, 4000);
    }
  };

  // ---------------- Screen ----------------
  SF.screens.chats = {
    title(route, state) {
      if (route.screen !== 'chat') return 'Чаты';
      const chat = state.chats.list.find(c => c.id === route.id);
      return chat ? (chat.kind === 'si' ? `${chat.roleTitle} · ${chat.title}` : chat.title) : 'Чат';
    },
    render(route, state) {
      if (route.screen !== 'chat') return renderList(state);
      const chat = state.chats.list.find(c => c.id === route.id);
      if (!chat) return SF.emptyState('assistant', 'Чат не найден', 'Вернитесь к списку чатов.');
      return chat.id === MAIN_SI_CHAT ? renderMainSiChat(state) : renderThread(state, chat);
    },
    afterRender(route) {
      if (route.screen === 'chat') {
        scrollToBottom(route.id === MAIN_SI_CHAT ? 'client-chat-scroll' : 'thread-scroll');
      }
    }
  };
})(window);
