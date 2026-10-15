// screens/chats.js - Chats: with SI-consultants (soft red) and with people (Tiffany).
// People find anyone in SmartFlow with the search at the top and write right here (screen 'person').
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

  // Search in the Chats tab: my chats (SI-sellers and people) and anyone in SmartFlow
  let searchQuery = '';
  let searchTimer = null;
  let searchResults = { q: '', people: null };
  const norm = (v) => String(v || '').toLowerCase();

  SF.actions.searchChats = (value) => {
    searchQuery = String(value || '').trim();
    clearTimeout(searchTimer);
    const q = searchQuery.replace(/^@/, '');
    if (q.length < 2) {
      searchResults = { q: '', people: null };
      store().notify();
      return;
    }
    store().notify();
    searchTimer = setTimeout(async () => {
      try {
        const res = await api().searchPeople(q);
        if (searchQuery.replace(/^@/, '') === q) searchResults = { q, people: res.people || [] };
      } catch (err) {
        searchResults = { q, people: [] };
      }
      store().notify();
    }, 350);
  };

  function personRow(c) {
    const preview = c.needsMyAnswer ? 'Хочет с вами пообщаться'
      : `${c.lastFromMe ? 'Вы: ' : ''}${c.lastMessage}`;
    return row({
      onclick: `SF.actions.openPerson('${SF.js(c.person.id)}')`,
      kind: 'human',
      photoUrl: c.person.photoUrl,
      title: c.person.displayName,
      preview,
      unread: c.unread || c.needsMyAnswer
    });
  }

  function renderList(state) {
    const chats = state.remote.chats;
    const people = state.remote.peopleChats || [];
    const assistantList = assistantMessages(state);
    const lastAssistant = assistantList[assistantList.length - 1];
    const q = norm(searchQuery.replace(/^@/, ''));
    const searchBox = SF.data.signedIn() ? `
      <div class="relative">
        <i data-lucide="search" class="w-4 h-4 text-faint absolute left-3 top-1/2 -translate-y-1/2"></i>
        <input type="search" data-keep="chats-search" value="${SF.esc(searchQuery)}" oninput="SF.actions.searchChats(this.value)" placeholder="Найти чат или человека: имя, @ник, чем занимается" autocomplete="off"
          class="w-full bg-card border border-line-2 rounded-xl pl-9 pr-3 py-2.5 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]" />
      </div>` : '';

    // One list, newest first: SI-sellers and people together
    const items = [
      ...(chats || []).map(c => ({ at: c.lastActivity, title: c.name, html: () => row({
        onclick: `SF.actions.openChat('${SF.js(c.slug)}')`,
        kind: 'si',
        photoUrl: c.photoUrl,
        title: c.name,
        preview: stripPrefix(c.lastMessage),
        unread: SF.data.isUnread(state, c)
      }) })),
      ...people.map(c => ({ at: c.lastActivity, title: c.person.displayName, username: c.person.username, html: () => personRow(c) }))
    ].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));

    if (q.length >= 2 || q.length === 1) {
      const mine = items.filter(i => norm(i.title).includes(q) || norm(i.username).includes(q));
      const known = new Set(people.map(c => c.person.id));
      const found = (searchResults.people || []).filter(p => !known.has(p.id));
      return `
        ${searchBox}
        ${mine.length ? `${SF.sectionTitle('', 'Мои чаты')}<div class="space-y-2">${mine.map(i => i.html()).join('')}</div>` : ''}
        ${q.length >= 2 ? `
          ${SF.sectionTitle('', 'Люди в SmartFlow')}
          <div class="space-y-2">
            ${searchResults.people === null ? '<div class="text-xs text-muted px-1">Ищу…</div>' : ''}
            ${found.map(p => `
              <div class="w-full p-3 rounded-2xl flex items-center gap-3 bg-card border border-line">
                ${SF.avatar(p.photoUrl, { size: 44, kind: 'human' })}
                <span class="flex-1 min-w-0">
                  <span class="block text-sm font-bold text-ink truncate">${SF.esc(p.displayName)}</span>
                  <span class="block text-[11px] text-muted truncate">${SF.esc(p.headline || (p.username ? `@${p.username}` : ''))}</span>
                </span>
                <span class="flex flex-col gap-1 flex-shrink-0">
                  <button onclick="SF.openIn('marketplace', 'person', { id: '${SF.js(p.id)}' })" class="px-2.5 py-1 rounded-lg btn-3d-dark text-[11px]">Профиль</button>
                  <button onclick="SF.actions.openPerson('${SF.js(p.id)}')" class="px-2.5 py-1 rounded-lg btn-3d-tiffany text-[11px]">Написать</button>
                </span>
              </div>`).join('')}
            ${searchResults.people && !found.length && !mine.length ? '<div class="text-xs text-muted px-1">Никого не нашли. Попробуйте имя, @ник или слово о том, чем человек занимается.</div>' : ''}
          </div>` : ''}
      `;
    }

    return `
      ${searchBox}
      <div class="space-y-2">
        ${chats === null && SF.data.signedIn() ? '<div class="text-xs text-muted px-1">Загружаю…</div>' : ''}
        ${items.map(i => i.html()).join('')}
        ${chats && !items.length ? `
          <div class="glass-card-3d p-4 space-y-2 text-center">
            <div class="text-sm font-bold text-ink">Пока нет переписок</div>
            <div class="text-xs text-muted leading-relaxed">Найдите человека по имени в поиске выше — и напишите ему. Или найдите SI-продавца в Маркетплейсе.</div>
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

  // ---------------- Conversation with a person ----------------
  const msgTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '');

  // Files of a conversation (photo, round video, voice) come with the session, so they are
  // fetched as blobs; the object URLs are kept while the app is open (re-renders reuse them).
  const fileUrls = new Map();
  const filePath = (userId, fileId) => `/api/people/${encodeURIComponent(userId)}/files/${encodeURIComponent(fileId)}`;

  function personMessage(m, userId) {
    const time = `<div class="text-[9px] opacity-60 text-right mt-0.5">${msgTime(m.createdAt)}</div>`;
    const side = m.mine ? 'justify-end' : 'justify-start';
    const path = m.fileId ? filePath(userId, m.fileId) : '';
    const src = m.fileId && fileUrls.get(m.fileId) ? `src="${fileUrls.get(m.fileId)}"` : '';
    if (m.kind === 'video' && m.fileId) {
      return `
        <div class="flex ${side}">
          <div class="flex flex-col items-center">
            <video data-dm-file="${SF.esc(path)}" data-file-id="${SF.esc(m.fileId)}" ${src} playsinline preload="metadata" onclick="SF.actions.toggleCircle(this)"
              class="w-44 h-44 rounded-full object-cover bg-sunken border-2 ${m.mine ? 'border-[#81D8D0]' : 'border-line'}"></video>
            <div class="text-[9px] text-faint mt-0.5">🎥 0:${String(m.seconds || 0).padStart(2, '0')} · ${msgTime(m.createdAt)}</div>
          </div>
        </div>`;
    }
    if (m.kind === 'photo' && m.fileId) {
      return `
        <div class="flex ${side}">
          <div class="${m.mine ? 'chat-bubble-human' : 'chat-bubble-expert'} !p-1">
            <img data-dm-file="${SF.esc(path)}" data-file-id="${SF.esc(m.fileId)}" ${src} alt="Фото" onclick="SF.actions.openPhoto(this)" class="rounded-xl max-w-[220px] max-h-[280px] min-w-[80px] min-h-[80px] object-cover bg-sunken" />
            <div class="px-1">${time}</div>
          </div>
        </div>`;
    }
    if (m.kind === 'voice' && m.fileId) {
      return `
        <div class="flex ${side}">
          <div class="${m.mine ? 'chat-bubble-human' : 'chat-bubble-expert'}">${SF.voiceContent({ text: '', voiceSeconds: m.seconds }, path)}${time}</div>
        </div>`;
    }
    return `
      <div class="flex ${side}">
        <div class="${m.mine ? 'chat-bubble-human' : 'chat-bubble-expert'}">${SF.formatChatMarkdown(m.text)}${time}</div>
      </div>`;
  }

  // After a render: load the photos and videos that are not loaded yet
  function loadPersonFiles() {
    document.querySelectorAll('[data-dm-file]:not([src])').forEach(async (el) => {
      const id = el.dataset.fileId;
      if (el.dataset.loading) return;
      el.dataset.loading = '1';
      try {
        if (!fileUrls.has(id)) fileUrls.set(id, URL.createObjectURL(await api().getPrivateBlob(el.dataset.dmFile)));
        el.src = fileUrls.get(id);
      } catch (err) {
        el.dataset.loading = '';
      }
    });
  }

  SF.actions.toggleCircle = (video) => {
    if (video.paused) {
      document.querySelectorAll('video[data-dm-file]').forEach(v => { if (v !== video) v.pause(); });
      video.muted = false;
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  };

  SF.actions.openPhoto = (img) => {
    if (!img.src) return;
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-3';
    overlay.innerHTML = `<img src="${img.src}" alt="Фото" class="max-w-full max-h-full rounded-xl" />`;
    overlay.onclick = () => overlay.remove();
    document.body.appendChild(overlay);
  };

  SF.actions.sendPersonPhoto = async (userId) => {
    if (sending || !window.sfMedia) return;
    try {
      const blob = await window.sfMedia.pickChatPhoto();
      if (!blob) return;
      await sendPersonFile(userId, 'photo', blob, '');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не отправилось', err));
    }
  };

  async function sendPersonFile(userId, kind, blob, seconds) {
    sending = true;
    showToast(kind === 'photo' ? 'Отправляю фото…' : kind === 'video' ? 'Отправляю видео…' : 'Отправляю голосовое…');
    try {
      await api().sendPersonFile(userId, kind, blob, seconds);
      SF.askWriteAccess();
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не отправилось. Попробуйте ещё раз', err));
    } finally {
      sending = false;
      await reloadPerson(userId);
      SF.scrollToBottom('chat-scroll');
    }
  }

  // Recording a voice (1.5 min) or a round video (30 s): a small window over the screen, so new
  // messages arriving meanwhile do not interrupt it. The limit is a quiet timer.
  let personRec = null;
  SF.actions.recordPerson = async (userId, kind) => {
    if (personRec || sending || !window.sfMedia) return;
    const max = kind === 'video' ? 30 : 90;
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4';
    overlay.innerHTML = `
      <div class="w-full max-w-sm p-4 rounded-3xl bg-card border border-line space-y-3 text-center">
        ${kind === 'video'
          ? '<video data-rec-preview playsinline muted class="mx-auto w-56 h-56 rounded-full object-cover bg-sunken border-4 border-[#81D8D0]" style="transform: scaleX(-1)"></video>'
          : '<div class="mx-auto w-20 h-20 rounded-full bg-[#81D8D0]/20 flex items-center justify-center text-3xl">🎤</div>'}
        <div class="text-xs text-ink flex items-center justify-center gap-1.5"><span class="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span><span data-rec-timer>0:00</span><span class="text-faint">/ ${Math.floor(max / 60)}:${String(max % 60).padStart(2, '0')}</span></div>
        <div class="flex gap-2">
          <button data-rec-cancel class="flex-1 py-2.5 rounded-xl bg-sunken border border-line text-xs text-ink-2">Отмена</button>
          <button data-rec-send class="flex-1 py-2.5 rounded-xl btn-3d-tiffany text-xs">Отправить</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const timerEl = overlay.querySelector('[data-rec-timer]');
    const close = () => { overlay.remove(); personRec = null; };
    const finish = async () => {
      if (!personRec || personRec.finishing) return;
      personRec.finishing = true;
      const result = await personRec.controller.stop();
      close();
      if (result && result.blob.size) await sendPersonFile(userId, kind, result.blob, result.seconds);
    };
    try {
      const options = {
        maxSeconds: max,
        onTick: (sec) => { timerEl.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; },
        onLimit: () => finish()
      };
      personRec = { finishing: false };
      personRec.controller = kind === 'video'
        ? await window.sfMedia.recordVideo({ ...options, preview: overlay.querySelector('[data-rec-preview]') })
        : await window.sfMedia.recordVoice(options);
    } catch (err) {
      close();
      showToast(kind === 'video'
        ? 'Нет доступа к камере. Разрешите камеру и микрофон для Telegram в настройках телефона.'
        : 'Нет доступа к микрофону. Разрешите микрофон для Telegram в настройках телефона.');
      return;
    }
    overlay.querySelector('[data-rec-cancel]').onclick = () => { if (personRec) personRec.controller.cancel(); close(); };
    overlay.querySelector('[data-rec-send]').onclick = finish;
  };

  function renderPerson(state, userId) {
    if (!SF.data.signedIn()) {
      return SF.emptyState('assistant', 'Откройте приложение в Telegram', 'Переписка доступна после входа через Telegram.');
    }
    if (SF.data.isMissing(state, `person:${userId}`)) return SF.emptyState('assistant', 'Человек не найден', 'Возможно, ссылка устарела.');
    const data = state.remote.personThreads[userId];
    if (!data) return '<div class="text-xs text-muted">Загружаю…</div>';
    const p = data.person;
    const t = data.thread;
    const name = SF.esc(p.displayName);
    return `
      <div class="glass-card-3d p-3 flex items-center justify-between gap-2">
        <button onclick="SF.openIn('marketplace', 'person', { id: '${SF.js(p.id)}' })" class="flex items-center gap-2.5 min-w-0 text-left">
          ${SF.avatar(p.photoUrl, { size: 40, kind: 'human' })}
          <span class="min-w-0">
            <span class="block text-xs font-bold text-ink truncate">${name}</span>
            <span class="block text-[10px] text-faint truncate">${SF.esc(p.headline || 'Открыть профиль')}</span>
          </span>
        </button>
        ${t ? `
          <details class="relative flex-shrink-0">
            <summary class="list-none p-2 rounded-xl btn-3d-dark cursor-pointer" aria-label="Ещё"><i data-lucide="more-horizontal" class="w-4 h-4"></i></summary>
            <div class="absolute right-0 mt-1 z-20 w-48 p-1.5 rounded-xl bg-card border border-line shadow-lg space-y-1">
              ${t.blockedByMe
                ? `<button onclick="SF.actions.answerPerson('${SF.js(p.id)}', 'unblock')" class="w-full text-left px-2.5 py-2 rounded-lg text-xs text-ink-2 hover:bg-sunken">Разблокировать</button>`
                : `<button onclick="SF.actions.answerPerson('${SF.js(p.id)}', 'block')" class="w-full text-left px-2.5 py-2 rounded-lg text-xs text-ink-2 hover:bg-sunken">Заблокировать</button>`}
              <button onclick="SF.actions.reportPerson('${SF.js(p.id)}')" class="w-full text-left px-2.5 py-2 rounded-lg text-xs text-rose-500 hover:bg-sunken">Пожаловаться</button>
            </div>
          </details>` : ''}
      </div>

      <div class="glass-card-3d p-3 flex flex-col space-y-2 min-h-[300px] max-h-[460px] overflow-y-auto" id="chat-scroll">
        ${!data.messages.length ? `<div class="m-auto text-center text-xs text-muted px-4 leading-relaxed">Напишите ${name} первым — например, поздоровайтесь и расскажите, чем вы занимаетесь 🙂</div>` : ''}
        ${data.messages.map(m => personMessage(m, p.id)).join('')}
      </div>

      ${t && t.needsMyAnswer ? `
        <div class="p-3 rounded-2xl bg-card border border-[#81D8D0] space-y-2">
          <div class="text-xs text-ink-2"><b>${name}</b> хочет с вами пообщаться.</div>
          <div class="flex gap-2">
            <button onclick="SF.actions.answerPerson('${SF.js(p.id)}', 'accept')" class="flex-1 py-2 rounded-xl btn-3d-tiffany text-xs">Принять</button>
            <button onclick="SF.actions.answerPerson('${SF.js(p.id)}', 'block')" class="flex-1 py-2 rounded-xl bg-sunken border border-line text-xs text-ink-2">Заблокировать</button>
          </div>
        </div>` : ''}
      ${t && t.waitingForAnswer ? `<div class="text-[10px] text-faint px-1">${name} увидит сообщение и решит, принять ли переписку. До ответа можно отправить до ${data.pendingLimit || 3} сообщений.</div>` : ''}

      ${t && t.blockedByMe ? `
        <div class="p-3 rounded-2xl bg-sunken border border-line text-xs text-ink-2 flex items-center justify-between gap-2">
          <span>Вы заблокировали ${name}.</span>
          <button onclick="SF.actions.answerPerson('${SF.js(p.id)}', 'unblock')" class="px-3 py-1.5 rounded-xl btn-3d-dark text-[11px]">Разблокировать</button>
        </div>` : data.canWrite ? `
        <form onsubmit="SF.actions.sendPerson(event, '${SF.js(p.id)}')" class="flex items-center gap-1.5">
          <button type="button" onclick="SF.actions.sendPersonPhoto('${SF.js(p.id)}')" class="p-2.5 rounded-xl btn-3d-dark flex items-center justify-center" aria-label="Отправить фото"><i data-lucide="image" class="w-4 h-4"></i></button>
          <input type="text" name="text" data-keep="person-input" maxlength="2000" autocomplete="off" placeholder="Сообщение..." class="flex-1 min-w-0 bg-card border border-line-2 rounded-xl px-3 py-2.5 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]" />
          ${window.sfMedia && window.sfMedia.canRecord() ? `
            <button type="button" onclick="SF.actions.recordPerson('${SF.js(p.id)}', 'voice')" class="p-2.5 rounded-xl btn-3d-dark flex items-center justify-center" aria-label="Записать голосовое"><i data-lucide="mic" class="w-4 h-4"></i></button>
            <button type="button" onclick="SF.actions.recordPerson('${SF.js(p.id)}', 'video')" class="p-2.5 rounded-xl btn-3d-dark flex items-center justify-center" aria-label="Записать видео-кружок"><i data-lucide="circle-play" class="w-4 h-4"></i></button>` : ''}
          <button type="submit" class="p-2.5 rounded-xl btn-3d-tiffany flex items-center justify-center" aria-label="Отправить">
            <i data-lucide="send" class="w-4 h-4"></i>
          </button>
        </form>` : ''}
    `;
  }

  SF.actions.openPerson = (userId) => {
    if (!SF.data.signedIn()) {
      showToast('Откройте приложение в Telegram, чтобы писать людям');
      return;
    }
    if (userId === store().data.me.id) {
      SF.go('profile');
      return;
    }
    SF.openIn('chats', 'person', { id: userId });
  };

  async function reloadPerson(userId) {
    SF.data.invalidate(`person:${userId}`);
    SF.data.invalidate('peopleChats');
    await Promise.all([SF.data.personMessages(userId), SF.data.peopleChats()]);
  }

  SF.actions.sendPerson = async (e, userId) => {
    e.preventDefault();
    const input = e.target.text;
    const text = input.value.trim();
    if (!text || sending) return;
    sending = true;
    input.value = '';
    const data = store().data.remote.personThreads[userId];
    if (data) {
      // Show it at once; the server's answer replaces it
      store().setRemote(`personThreads.${userId}`, { ...data, messages: [...data.messages, { id: `tmp_${Date.now()}`, text, mine: true, createdAt: new Date().toISOString() }] });
      SF.scrollToBottom('chat-scroll');
    }
    try {
      await api().sendPersonMessage(userId, text);
      SF.askWriteAccess(); // so the bot can tell about the answer
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не отправилось. Попробуйте ещё раз', err));
    } finally {
      sending = false;
      await reloadPerson(userId);
      SF.scrollToBottom('chat-scroll');
    }
  };

  SF.actions.answerPerson = async (userId, action) => {
    const name = store().data.remote.personThreads[userId]?.person?.displayName || 'этого человека';
    if (action === 'block' && !window.confirm(`Заблокировать ${name}? Он(а) больше не сможет вам писать и не найдёт вас в поиске.`)) return;
    try {
      const res = await api().answerPerson(userId, action);
      store().setRemote(`personThreads.${userId}`, res);
      SF.data.invalidate('peopleChats');
      SF.data.peopleChats();
      showToast(action === 'accept' ? 'Переписка принята' : action === 'block' ? 'Заблокировано' : 'Разблокировано');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не получилось', err));
    }
  };

  SF.actions.reportPerson = async (userId) => {
    const name = store().data.remote.personThreads[userId]?.person?.displayName || 'этого человека';
    const reason = window.prompt(`Что случилось? Жалоба на ${name} уйдёт команде SmartFlow вместе с последними сообщениями этой переписки, а человек будет заблокирован.`);
    if (reason === null) return;
    try {
      await api().reportPerson(userId, reason);
      await reloadPerson(userId);
      showToast('Жалоба отправлена команде. Спасибо!');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не отправилось', err));
    }
  };

  // ---------------- Chat with an SI-consultant ----------------
  function bubble(msg, consultant, slug) {
    if (msg.sender === 'client') {
      const body = msg.voiceId ? SF.voiceContent(msg, `/api/chat/${encodeURIComponent(slug)}/voice/${msg.voiceId}`) : SF.formatChatMarkdown(msg.text);
      return `<div class="flex justify-end"><div class="chat-bubble-human">${body}</div></div>`;
    }
    if (msg.isBroadcast) {
      const thread = store().data.remote.messages[slug] || {};
      return `
        <div class="flex flex-col items-start">
          <div class="text-[9px] text-brand font-semibold px-1 mb-0.5">📣 Рассылка · ${SF.esc(consultant?.author?.name || 'эксперт')}</div>
          <div class="chat-bubble-expert">${SF.formatChatMarkdown(msg.text)}</div>
          <button onclick="SF.actions.toggleBroadcasts('${SF.js(slug)}', ${thread.broadcastsOff ? 'false' : 'true'})" class="text-[9px] text-faint underline px-1 mt-0.5">${thread.broadcastsOff ? 'Снова присылать рассылки' : 'Не присылать рассылки'}</button>
        </div>`;
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

  SF.actions.toggleBroadcasts = async (slug, off) => {
    try {
      await api().setBroadcastsOff(slug, off);
      SF.data.invalidate(`messages:${slug}`);
      await SF.data.chatMessages(slug);
      showToast(off ? 'Больше не будем присылать рассылки. Переписка остаётся как была' : 'Рассылки снова включены');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не получилось', err));
    }
  };

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

  // After "Купили" (marked by the expert): a quiet invitation to leave a review, or my review
  function reviewLine(state, slug) {
    const r = state.remote.myReviews[slug];
    if (!r || !r.canReview) return '';
    if (r.review) {
      return `
        <button onclick="SF.actions.openReview('${SF.js(slug)}')" class="w-full py-1.5 px-3 rounded-xl bg-card border border-line text-[11px] text-ink-2 flex items-center justify-between gap-2">
          <span>Ваш отзыв: ${SF.stars(r.review.rating)}${r.review.hidden ? ' <span class="text-faint">· скрыт командой</span>' : ''}</span>
          <span class="text-brand font-semibold">Изменить</span>
        </button>`;
    }
    return `
      <button onclick="SF.actions.openReview('${SF.js(slug)}')" class="w-full py-1.5 rounded-xl bg-card border border-[#81D8D0] text-[11px] text-ink-2 flex items-center justify-center gap-1">
        <i data-lucide="star" class="w-3.5 h-3.5 text-brand"></i>Поделитесь впечатлением — оставьте отзыв
      </button>`;
  }

  let reviewDraft = { rating: 0 };
  SF.actions.openReview = (slug) => {
    const r = store().data.remote.myReviews[slug] || {};
    reviewDraft = { slug, rating: (r.review && r.review.rating) || 0, text: (r.review && r.review.text) || '' };
    renderReviewModal();
  };

  SF.actions.pickReviewStar = (n) => {
    const box = document.getElementById('review-text');
    if (box) reviewDraft.text = box.value;
    reviewDraft.rating = n;
    renderReviewModal();
  };

  function renderReviewModal() {
    const card = store().data.remote.cards[reviewDraft.slug];
    SF.openModal(`
      <h3 class="text-sm font-bold text-ink">Отзыв${card ? ` о «${SF.esc(card.name)}»` : ''}</h3>
      <div class="flex justify-center gap-1.5">
        ${[1, 2, 3, 4, 5].map(n => `<button onclick="SF.actions.pickReviewStar(${n})" class="text-3xl leading-none ${n <= reviewDraft.rating ? 'text-brand' : 'text-faint'}" aria-label="${n} из 5">★</button>`).join('')}
      </div>
      <textarea id="review-text" maxlength="1000" rows="4" placeholder="Что понравилось, что получилось? Пара предложений поможет другим." class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-xs text-ink">${SF.esc(reviewDraft.text || '')}</textarea>
      <div class="text-[10px] text-faint">Все увидят только ваше имя и первую букву фамилии. Отзыв можно изменить позже.</div>
      <div class="flex gap-2">
        <button onclick="SF.closeModal()" class="flex-1 py-2.5 rounded-xl btn-3d-dark text-xs">Отмена</button>
        <button onclick="SF.actions.sendReview()" class="flex-1 py-2.5 rounded-xl btn-3d-tiffany text-xs font-bold">Отправить</button>
      </div>`);
  }

  SF.actions.sendReview = async () => {
    const text = (document.getElementById('review-text') || {}).value || '';
    if (!reviewDraft.rating) {
      showToast('Поставьте оценку — от 1 до 5 звёзд');
      return;
    }
    try {
      const res = await api().saveReview(reviewDraft.slug, reviewDraft.rating, text);
      store().setRemote(`myReviews.${reviewDraft.slug}`, { canReview: res.canReview, review: res.review });
      SF.data.invalidate('cardReviews');
      SF.closeModal();
      showToast(res.created ? 'Спасибо за отзыв!' : 'Отзыв обновлён');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не отправилось. Попробуйте ещё раз', err));
    }
  };

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
      ${reviewLine(state, slug)}
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
      if (route.screen === 'person') return state.remote.personThreads[route.id]?.person?.displayName || 'Переписка';
      if (route.screen !== 'chat') return 'Чаты';
      if (route.slug === ASSISTANT) return 'Поддержка';
      const card = state.remote.cards[route.slug];
      return card ? card.name : 'Чат';
    },
    render(route, state) {
      if (route.screen === 'person') return renderPerson(state, route.id);
      if (route.screen !== 'chat') return renderList(state);
      return route.slug === ASSISTANT ? renderAssistant(state) : renderChat(state, route.slug);
    },
    afterRender(route, state) {
      if (route.screen === 'person') {
        const userId = route.id;
        SF.data.personMessages(userId);
        SF.scrollToBottom('chat-scroll');
        loadPersonFiles();
        SF.data.poll(`person:${userId}`, () => {
          SF.data.personMessages(userId, 4000);
          SF.data.peopleChats(4000);
        });
        return;
      }
      if (route.screen !== 'chat') {
        SF.data.myChats();
        SF.data.peopleChats();
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
      SF.data.myReview(slug);
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
