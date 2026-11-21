// screens/groups.js - Group conversations in «Чаты» (owner's decisions 21 Nov.).
// A plain conversation of several people; anyone can create one. (A community with a feed, courses
// and points is a different thing — tab «Комьюнити», business profile only.)
// Screens of the Chats tab (called from screens/chats.js):
//   group       { id }    the conversation (an invitation: «Вступить / Отказаться»)
//   group-new             name + people → «Создать»
//   group-info  { id }    photo, name, link, members, «Без звука», leave, complaint
//   group-add   { id }    add people (the owner or an admin)
//   group-join  { code }  an invitation link: t.me/<bot>/app?startapp=J_<code>
// Messages: text, voice (1.5 min), photo, round video (30 s), a reply, @mentions, reactions, one pinned message.
// No notification about reactions: marks on the right («@» and ❤️) lead to where I was mentioned or got a reaction.
// «Новые сообщения» shows where I stopped; «Кратко» — the only SI here — retells what I missed from that place,
// on request only (server/services/group-service.js). People: a tap on a person opens their profile.

(function (window) {
  const SF = window.SF;
  const showToast = SF.showToast;
  const store = () => window.funnelStore;
  const api = () => window.smartFlowApi;
  let sending = false;
  let replyTo = null; // { groupId, id, senderName, text }
  // This visit of a group: where I stopped («Новые сообщения») and the marks on the right. The server
  // tells them once per visit (opening marks them seen), so they are kept here until I tap them.
  let visit = { groupId: null, newFrom: null, mentions: [], reactions: [], done: new Set(), scrolled: false };
  let mentionPick = []; // [{ id, name }] picked from the members while typing «@»

  function startVisit(groupId) {
    visit = { groupId, newFrom: null, mentions: [], reactions: [], done: new Set(), scrolled: false };
    mentionPick = [];
    // The copy kept on the phone holds the last visit's marks: only the fresh answer counts
    const cached = store().data.remote.groupThreads[groupId];
    if (cached) { cached.newFrom = null; cached.marks = null; }
    SF.data.invalidate(`group:${groupId}`);
  }

  // What each server answer adds to this visit (polling brings new marks while the group is open)
  function takeMarks(groupId, data) {
    if (visit.groupId !== groupId || !data) return;
    if (data.newFrom && !visit.newFrom) visit.newFrom = data.newFrom;
    const add = (list, ids) => (ids || []).forEach(id => { if (!list.includes(id) && !visit.done.has(id)) list.push(id); });
    add(visit.mentions, data.marks && data.marks.mentions);
    add(visit.reactions, data.marks && data.marks.reactions);
  }

  const isAdmin = (g) => g && ['owner', 'admin'].includes(g.role);
  const msgTime = (iso) => (iso ? new Date(iso).toLocaleTimeString(SF.locale(), { hour: '2-digit', minute: '2-digit' }) : '');
  const ROLE_LABEL = { owner: 'создатель', admin: 'админ' };
  // «3 участн.»: the number apart, so the word is translated (js/i18n.js)
  const members = (n) => `<span data-no-tr>${Number(n) || 0}</span> <span>участн.</span>`;

  function groupAvatar(photoUrl, size = 44) {
    if (photoUrl) return SF.avatar(photoUrl, { size, kind: 'human' });
    return `
      <span class="flex-shrink-0 rounded-full bg-[#81D8D0]/20 border-2 border-[#81D8D0] text-brand flex items-center justify-center" style="width:${size}px;height:${size}px">
        <i data-lucide="users" style="width:${Math.round(size * 0.45)}px;height:${Math.round(size * 0.45)}px"></i>
      </span>`;
  }

  // ---------------- In the Chats list ----------------
  function listRow(g) {
    const preview = g.invited ? 'Приглашение в группу'
      : g.lastMessage ? `${g.lastFromMe ? 'Вы: ' : g.lastSenderName ? `${g.lastSenderName}: ` : ''}${g.lastMessage}` : `${g.memberCount} участн.`;
    return `
      <button onclick="SF.actions.openGroup('${SF.js(g.id)}')" class="w-full p-3 rounded-2xl flex items-center gap-3 text-left bg-card border border-line">
        ${groupAvatar(g.photoUrl)}
        <span class="flex-1 min-w-0">
          <span class="flex items-center gap-1 text-sm font-bold text-ink min-w-0"><span class="truncate">${SF.esc(g.name)}</span>${g.muted ? '<span class="text-[10px] text-faint">🔕</span>' : ''}</span>
          <span class="block text-[11px] text-muted truncate">${SF.esc(preview)}</span>
        </span>
        ${g.mentioned ? '<span class="text-xs font-bold text-brand">@</span>' : ''}
        ${g.reacted ? '<span class="text-xs">❤️</span>' : ''}
        ${g.unread || g.invited ? '<span class="w-2.5 h-2.5 rounded-full bg-[#81D8D0]"></span>' : ''}
      </button>`;
  }

  SF.actions.openGroup = (groupId) => {
    startVisit(groupId);
    SF.openIn('chats', 'group', { id: groupId });
  };
  SF.actions.newGroup = () => {
    if (!SF.data.signedIn()) return showToast('Откройте приложение в Telegram, чтобы создать группу');
    picker = { selected: new Map(), query: '', results: null };
    SF.push('group-new', {}, 'chats');
  };

  // ---------------- Messages ----------------
  const fileUrls = new Map();
  const filePath = (groupId, fileId) => `/api/groups/${encodeURIComponent(groupId)}/files/${encodeURIComponent(fileId)}`;

  function quoteBlock(q, mine) {
    if (!q) return '';
    const text = q.kind && q.kind !== 'text' ? ({ voice: '🎤 Голосовое', photo: '📷 Фото', video: '🎥 Видео' }[q.kind] || q.text) : q.text;
    return `
      <button onclick="SF.actions.scrollToGroupMessage('${SF.js(q.id)}')" class="block w-full text-left mb-1 pl-2 border-l-2 ${mine ? 'border-[#0d9488]' : 'border-[#81D8D0]'}">
        <span class="block text-[10px] font-bold text-brand truncate">${SF.esc(q.senderName)}</span>
        <span class="block text-[10px] opacity-75 truncate">${SF.esc(text)}</span>
      </button>`;
  }

  function reactionsRow(groupId, m) {
    if (!m.reactions || !m.reactions.length) return '';
    return `
      <div class="flex flex-wrap gap-1 mt-1 ${m.mine ? 'justify-end' : ''}">
        ${m.reactions.map(r => `
          <button onclick="SF.actions.reactGroup('${SF.js(groupId)}', '${SF.js(m.id)}', '${SF.js(r.emoji)}')" class="px-1.5 py-0.5 rounded-full text-[11px] border ${r.mine ? 'bg-[#81D8D0]/25 border-[#81D8D0]' : 'bg-card border-line'}">${r.emoji} ${r.count}</button>`).join('')}
      </div>`;
  }

  function messageBody(groupId, m) {
    const path = m.fileId ? filePath(groupId, m.fileId) : '';
    const src = m.fileId && fileUrls.get(m.fileId) ? `src="${fileUrls.get(m.fileId)}"` : '';
    if (m.deleted) return '<span class="italic opacity-60">Сообщение удалено</span>';
    if (m.kind === 'photo' && m.fileId) {
      return `<img data-dm-file="${SF.esc(path)}" data-file-id="${SF.esc(m.fileId)}" ${src} alt="Фото" onclick="event.stopPropagation(); SF.actions.openPhoto(this)" class="rounded-xl max-w-[220px] max-h-[280px] min-w-[80px] min-h-[80px] object-cover bg-sunken" />`;
    }
    if (m.kind === 'voice' && m.fileId) return `<span onclick="event.stopPropagation()">${SF.voiceContent({ text: '', voiceSeconds: m.seconds }, path)}</span>`;
    return SF.formatChatMarkdown(m.text);
  }

  // Shades of the people in the group shown now: by the order of members, so up to 7 never share one
  let tones = new Map();
  const toneOf = (userId) => tones.get(userId) || SF.personTone(userId);

  // run: { first, last } — messages of one person in a row stay close together (name over the first,
  // photo by the last); a new person starts a bit further away (owner's decision 21 Nov., like WhatsApp)
  function groupMessage(groupId, m, run = { first: true, last: true, gap: '' }) {
    const tone = m.mine ? '' : toneOf(m.sender.id);
    const avatar = m.mine ? '' : run.last
      ? `<button onclick="SF.actions.openPersonProfile('${SF.js(m.sender.id)}')" class="mt-auto">${SF.avatar(m.sender.photoUrl, { size: 26, kind: 'human', userId: m.sender.id })}</button>`
      : '<span class="flex-shrink-0" style="width:26px"></span>';
    const showName = !m.mine && run.first;
    const time = `<div class="text-[9px] opacity-60 text-right mt-0.5">${msgTime(m.createdAt)}</div>`;
    const menu = m.deleted ? '' : `onclick="SF.actions.groupMessageMenu('${SF.js(groupId)}', '${SF.js(m.id)}')"`;
    if (m.kind === 'video' && m.fileId && !m.deleted) {
      const path = filePath(groupId, m.fileId);
      const src = fileUrls.get(m.fileId) ? `src="${fileUrls.get(m.fileId)}"` : '';
      return `
        <div id="gm-${SF.esc(m.id)}" class="flex ${m.mine ? 'justify-end' : 'justify-start'} gap-1.5 ${run.gap}">
          ${avatar}
          <div class="flex flex-col items-center">
            ${showName ? `<div class="text-[10px] font-bold person-name ${tone} self-start">${SF.esc(m.sender.displayName)}</div>` : ''}
            <video data-dm-file="${SF.esc(path)}" data-file-id="${SF.esc(m.fileId)}" ${src} playsinline preload="metadata" onclick="SF.actions.toggleCircle(this)"
              class="w-40 h-40 rounded-full object-cover bg-sunken border-2 ${m.mine ? 'border-[#81D8D0]' : 'border-line'}"></video>
            <button ${menu} class="text-[9px] text-faint mt-0.5">🎥 0:${String(m.seconds || 0).padStart(2, '0')} · ${msgTime(m.createdAt)} · ···</button>
            ${reactionsRow(groupId, m)}
          </div>
        </div>`;
    }
    return `
      <div id="gm-${SF.esc(m.id)}" class="flex ${m.mine ? 'justify-end' : 'justify-start'} gap-1.5 ${run.gap}">
        ${avatar}
        <div class="max-w-[80%] min-w-0">
          <div ${menu} class="${m.mine ? 'chat-bubble-mine ml-auto' : `chat-bubble-person ${tone}`} !max-w-full w-fit ${m.kind === 'photo' ? '!p-1' : ''} cursor-pointer">
            ${showName ? `<div class="text-[10px] font-bold person-name ${m.kind === 'photo' ? 'px-1' : ''}">${SF.esc(m.sender.displayName)}</div>` : ''}
            ${quoteBlock(m.replyTo, m.mine)}
            ${messageBody(groupId, m)}
            <div class="${m.kind === 'photo' ? 'px-1' : ''}">${time}</div>
          </div>
          ${reactionsRow(groupId, m)}
        </div>
      </div>`;
  }

  function loadFiles() {
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

  // A person: their profile (writing to them is there)
  SF.actions.openPersonProfile = (userId) => {
    if (userId === store().data.me.id) return SF.go('profile');
    SF.openIn('marketplace', 'person', { id: userId });
  };

  // A mark on the right: to the next place where I was mentioned or got a reaction
  SF.actions.nextGroupMark = (kind) => {
    const list = kind === 'reactions' ? visit.reactions : visit.mentions;
    const id = list.shift();
    if (!id) return;
    visit.done.add(id);
    SF.actions.scrollToGroupMessage(id);
    store().notify();
  };

  SF.actions.scrollToGroupMessage = (messageId) => {
    const el = document.getElementById(`gm-${messageId}`);
    if (!el) return showToast('Это сообщение было давно — выше в переписке');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('opacity-60');
    setTimeout(() => el.classList.remove('opacity-60'), 900);
  };

  // A tap on a message: reactions, «Ответить», «Закрепить», «Удалить», «Пожаловаться»
  SF.actions.groupMessageMenu = (groupId, messageId) => {
    const data = store().data.remote.groupThreads[groupId];
    const m = data && data.messages.find(x => x.id === messageId);
    if (!m) return;
    const admin = isAdmin(data.group);
    const pinned = data.pinned && data.pinned.id === m.id;
    const item = (onclick, icon, label, cls = 'text-ink-2') => `
      <button onclick="SF.closeModal(); ${onclick}" class="w-full text-left px-3 py-2.5 rounded-xl text-sm ${cls} hover:bg-sunken flex items-center gap-2"><span class="w-5 text-center">${icon}</span>${label}</button>`;
    SF.openModal(`
      <div class="flex justify-between gap-1">
        ${(data.reactions || []).map(e => `
          <button onclick="SF.closeModal(); SF.actions.reactGroup('${SF.js(groupId)}', '${SF.js(m.id)}', '${SF.js(e)}')" class="flex-1 py-2 rounded-xl text-xl ${m.reactions.some(r => r.mine && r.emoji === e) ? 'bg-[#81D8D0]/25' : 'hover:bg-sunken'}">${e}</button>`).join('')}
      </div>
      <div class="space-y-0.5">
        ${item(`SF.actions.replyGroup('${SF.js(groupId)}', '${SF.js(m.id)}')`, '↩️', 'Ответить')}
        ${m.kind === 'text' ? item(`SF.copyText(${SF.esc(JSON.stringify(m.text))}, 'Текст скопирован')`, '📋', 'Скопировать') : ''}
        ${admin ? item(`SF.actions.pinGroup('${SF.js(groupId)}', ${pinned ? 'null' : `'${SF.js(m.id)}'`})`, '📌', pinned ? 'Открепить' : 'Закрепить') : ''}
        ${m.mine || admin ? item(`SF.actions.deleteGroupMessage('${SF.js(groupId)}', '${SF.js(m.id)}')`, '🗑', 'Удалить', 'text-rose-500') : ''}
        ${!m.mine ? item(`SF.actions.reportGroup('${SF.js(groupId)}', '${SF.js(m.id)}')`, '⚠️', 'Пожаловаться', 'text-rose-500') : ''}
      </div>
    `);
  };

  async function reload(groupId) {
    SF.data.invalidate(`group:${groupId}`);
    SF.data.invalidate('groups');
    await Promise.all([SF.data.groupMessages(groupId), SF.data.groups()]);
  }

  async function call(method, groupId, path, body, okToast) {
    try {
      const res = await api().groupCall(method, groupId, path, body);
      if (okToast) showToast(okToast);
      return res || {};
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не получилось', err));
      return null;
    }
  }

  SF.actions.reactGroup = async (groupId, messageId, emoji) => {
    // Show it at once; the server's answer replaces it
    const data = store().data.remote.groupThreads[groupId];
    const m = data && data.messages.find(x => x.id === messageId);
    if (m) {
      const had = m.reactions.find(r => r.mine);
      let list = m.reactions.map(r => (r.mine ? { ...r, count: r.count - 1, mine: false } : r)).filter(r => r.count > 0);
      if (!had || had.emoji !== emoji) {
        const same = list.find(r => r.emoji === emoji);
        list = same ? list.map(r => (r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r)) : [...list, { emoji, count: 1, mine: true }];
      }
      store().setRemote(`groupThreads.${groupId}`, { ...data, messages: data.messages.map(x => (x.id === messageId ? { ...x, reactions: list } : x)) });
    }
    await call('POST', groupId, `/messages/${encodeURIComponent(messageId)}/react`, { emoji });
    await reload(groupId);
  };

  SF.actions.replyGroup = (groupId, messageId) => {
    const data = store().data.remote.groupThreads[groupId];
    const m = data && data.messages.find(x => x.id === messageId);
    if (!m) return;
    const text = m.kind === 'text' ? m.text : ({ voice: '🎤 Голосовое', photo: '📷 Фото', video: '🎥 Видео' }[m.kind] || '');
    replyTo = { groupId, id: m.id, senderName: m.mine ? 'Вы' : m.sender.displayName, text };
    store().notify();
    setTimeout(() => document.querySelector('[data-keep="group-input"]')?.focus(), 50);
  };

  SF.actions.cancelReply = () => {
    replyTo = null;
    store().notify();
  };

  SF.actions.pinGroup = async (groupId, messageId) => {
    if (await call('PUT', groupId, '/pin', { messageId }, messageId ? 'Сообщение закреплено' : 'Откреплено')) await reload(groupId);
  };

  SF.actions.deleteGroupMessage = async (groupId, messageId) => {
    if (!window.confirm('Удалить сообщение у всех?')) return;
    if (await call('DELETE', groupId, `/messages/${encodeURIComponent(messageId)}`, undefined, 'Удалено')) await reload(groupId);
  };

  SF.actions.reportGroup = async (groupId, messageId) => {
    const reason = window.prompt(messageId
      ? 'Что не так с этим сообщением? Жалоба уйдёт команде SmartFlow вместе с последними сообщениями группы.'
      : 'Что случилось? Жалоба уйдёт команде SmartFlow вместе с последними сообщениями группы.');
    if (reason === null) return;
    await call('POST', groupId, '/report', { messageId: messageId || null, reason }, 'Жалоба отправлена команде. Спасибо!');
  };

  // «Кратко» by SI: what I missed, in a few points — a card under the header (not a window: new messages
  // re-draw the screen and would close it), stays while I read and scroll
  const summaries = {}; // { [groupId]: { loading } | { text, messages } }
  SF.actions.groupSummary = async (groupId) => {
    if (summaries[groupId] && summaries[groupId].loading) return;
    summaries[groupId] = { loading: true };
    store().notify();
    try {
      const res = await api().groupCall('POST', groupId, '/summary', {});
      summaries[groupId] = { text: res.summary, messages: res.messages };
    } catch (err) {
      delete summaries[groupId];
      showToast(SF.withErrorCode(err.message || 'Не получилось', err));
    }
    store().notify();
  };

  SF.actions.closeGroupSummary = (groupId) => {
    delete summaries[groupId];
    store().notify();
  };

  function summaryCard(groupId) {
    const sm = summaries[groupId];
    if (!sm) return '';
    return `
      <div class="p-3 rounded-2xl bg-[var(--si-bubble)] border border-[var(--si-bubble-line)] space-y-1.5">
        <div class="flex items-center justify-between gap-2">
          <span class="flex items-center gap-1.5 text-xs font-bold text-ink"><span class="si-dot"></span><span>Кратко: что вы пропустили</span></span>
          ${sm.loading ? '' : `<button onclick="SF.actions.closeGroupSummary('${SF.js(groupId)}')" class="p-1 text-faint" aria-label="Закрыть"><i data-lucide="x" class="w-4 h-4"></i></button>`}
        </div>
        ${sm.loading
          ? '<div class="typing-dots"><span class="text-[10px] text-muted font-medium mr-1.5">SI читает переписку</span><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>'
          : `<div class="text-xs text-ink-2 leading-relaxed whitespace-pre-line" data-no-tr>${SF.esc(sm.text)}</div>
             <div class="text-[10px] text-faint">${SF.esc(String(sm.messages))} <span>сообщ. · SI может ошибаться — важное проверьте в переписке</span></div>`}
      </div>`;
  }

  // ---------------- Sending ----------------
  SF.actions.sendGroup = async (e, groupId) => {
    e.preventDefault();
    const input = e.target.text;
    const text = input.value.trim();
    if (!text || sending) return;
    sending = true;
    input.value = '';
    const reply = replyTo && replyTo.groupId === groupId ? replyTo : null;
    replyTo = null;
    // Mentions still in the text (a picked «@Имя» erased again is not sent)
    const mentionIds = [...new Set(mentionPick.filter(p => text.includes(`@${p.name}`)).map(p => p.id))];
    mentionPick = [];
    hideMentionList();
    const data = store().data.remote.groupThreads[groupId];
    if (data) {
      const me = store().data.me;
      store().setRemote(`groupThreads.${groupId}`, {
        ...data,
        messages: [...data.messages, {
          id: `tmp_${Date.now()}`, kind: 'text', text, mine: true, reactions: [], createdAt: new Date().toISOString(),
          sender: { id: me.id, displayName: me.displayName, photoUrl: me.photoUrl },
          replyTo: reply ? { id: reply.id, senderName: reply.senderName, text: reply.text, kind: 'text' } : null
        }]
      });
      SF.scrollToBottom('chat-scroll');
    }
    try {
      await api().groupCall('POST', groupId, '/messages', { text, replyTo: reply ? reply.id : null, mentionIds });
      SF.askWriteAccess(null, { auto: true });
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не отправилось. Попробуйте ещё раз', err));
    } finally {
      sending = false;
      await reload(groupId);
      SF.scrollToBottom('chat-scroll');
    }
  };

  // «@» in the input: the members to pick from, right above it (drawn directly, so typing is not interrupted)
  function hideMentionList() {
    const box = document.getElementById('mention-list');
    if (box) box.innerHTML = '';
  }

  SF.actions.groupInput = (input, groupId) => {
    const before = input.value.slice(0, input.selectionStart || input.value.length);
    const match = before.match(/(^|\s)@([^\s@]{0,30})$/);
    const box = document.getElementById('mention-list');
    if (!box) return;
    if (!match) return hideMentionList();
    const q = match[2].toLowerCase();
    const meId = store().data.me.id;
    const data = store().data.remote.groupThreads[groupId];
    const people = ((data && data.members) || []).filter(m => !m.invited && m.id !== meId && m.displayName.toLowerCase().includes(q)).slice(0, 6);
    if (!people.length) return hideMentionList();
    box.innerHTML = `
      <div class="p-1.5 rounded-xl bg-card border border-line shadow-lg space-y-0.5">
        ${people.map(m => `
          <button type="button" onmousedown="event.preventDefault()" onclick="SF.actions.pickMention('${SF.js(groupId)}', '${SF.js(m.id)}')" class="w-full px-2 py-1.5 rounded-lg flex items-center gap-2 text-left hover:bg-sunken">
            ${SF.avatar(m.photoUrl, { size: 24, kind: 'human' })}<span class="text-xs text-ink truncate">${SF.esc(m.displayName)}</span>
          </button>`).join('')}
      </div>`;
  };

  SF.actions.pickMention = (groupId, userId) => {
    const input = document.querySelector('[data-keep="group-input"]');
    const data = store().data.remote.groupThreads[groupId];
    const m = data && data.members.find(x => x.id === userId);
    if (!input || !m) return;
    const caret = input.selectionStart || input.value.length;
    const before = input.value.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${m.displayName} `);
    input.value = before + input.value.slice(caret);
    input.focus();
    input.setSelectionRange(before.length, before.length);
    mentionPick.push({ id: m.id, name: m.displayName });
    hideMentionList();
  };

  async function sendFile(groupId, kind, blob, seconds) {
    sending = true;
    const reply = replyTo && replyTo.groupId === groupId ? replyTo : null;
    replyTo = null;
    showToast(kind === 'photo' ? 'Отправляю фото…' : kind === 'video' ? 'Отправляю видео…' : 'Отправляю голосовое…');
    try {
      await api().sendGroupFile(groupId, kind, blob, seconds, reply ? reply.id : '');
      SF.askWriteAccess(null, { auto: true });
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не отправилось. Попробуйте ещё раз', err));
    } finally {
      sending = false;
      await reload(groupId);
      SF.scrollToBottom('chat-scroll');
    }
  }

  SF.actions.sendGroupPhoto = async (groupId) => {
    if (sending || !window.sfMedia) return;
    try {
      const blob = await window.sfMedia.pickChatPhoto();
      if (blob) await sendFile(groupId, 'photo', blob, '');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не отправилось', err));
    }
  };

  // Voice (1.5 min) or a round video (30 s): the same recording window as private conversations
  SF.actions.recordGroup = (groupId, kind) => {
    if (sending) return;
    SF.recordClip(kind, (blob, seconds) => sendFile(groupId, kind, blob, seconds));
  };

  // ---------------- Screen: the conversation ----------------
  function renderInvited(data, groupId) {
    const g = data.group;
    return `
      <div class="glass-card-3d p-5 text-center space-y-3">
        <div class="flex justify-center">${groupAvatar(g.photoUrl, 72)}</div>
        <div class="text-base font-extrabold text-ink">${SF.esc(g.name)}</div>
        <div class="text-xs text-muted">${data.invitedBy ? `<b class="text-ink" data-no-tr>${SF.esc(data.invitedBy.displayName)}</b> <span>приглашает вас в группу</span>` : '<span>Вас пригласили в группу</span>'}</div>
        <div class="text-[11px] text-faint">${members(g.memberCount)}</div>
        <div class="grid grid-cols-2 gap-2">
          <button onclick="SF.actions.answerGroup('${SF.js(groupId)}', false)" class="py-2.5 rounded-xl bg-sunken border border-line text-xs text-ink-2">Отказаться</button>
          <button onclick="SF.actions.answerGroup('${SF.js(groupId)}', true)" class="py-2.5 rounded-xl btn-3d-tiffany text-xs">Вступить</button>
        </div>
      </div>`;
  }

  SF.actions.answerGroup = async (groupId, accept) => {
    const res = await call('POST', groupId, '/answer', { accept }, accept ? 'Вы в группе 🙂' : 'Приглашение отклонено');
    if (!res) return;
    if (accept) {
      store().setRemote(`groupThreads.${groupId}`, res);
      SF.data.invalidate('groups');
      SF.data.groups();
    } else {
      SF.data.invalidate('groups');
      await SF.data.groups();
      SF.back();
    }
  };

  function renderGroup(state, groupId) {
    if (!SF.data.signedIn()) return SF.emptyState('assistant', 'Откройте приложение в Telegram', 'Группы доступны после входа через Telegram.');
    if (SF.data.isMissing(state, `group:${groupId}`)) return SF.emptyState('assistant', 'Группа не найдена', 'Возможно, вы вышли из неё или вас удалили.');
    const data = state.remote.groupThreads[groupId];
    if (!data) return '<div class="text-xs text-muted">Загружаю…</div>';
    if (data.group.invited) return renderInvited(data, groupId);
    const g = data.group;
    const reply = replyTo && replyTo.groupId === groupId ? replyTo : null;
    const canRecord = window.sfMedia && window.sfMedia.canRecord();
    if (visit.groupId !== groupId) startVisit(groupId);
    takeMarks(groupId, data);
    tones = new Map(data.members.map((x, i) => [x.id, SF.personTone(x.id, i)]));
    // «Новые сообщения»: before the first message from others after where I stopped
    const firstNew = visit.newFrom ? data.messages.find(m => !m.mine && m.createdAt > visit.newFrom) : null;
        return `
      <div class="glass-card-3d p-3 flex items-center justify-between gap-2">
        <button onclick="SF.push('group-info', { id: '${SF.js(groupId)}' })" class="flex items-center gap-2.5 min-w-0 text-left">
          ${groupAvatar(g.photoUrl, 40)}
          <span class="min-w-0">
            <span class="block text-xs font-bold text-ink truncate">${SF.esc(g.name)}</span>
            <span class="block text-[10px] text-faint truncate">${members(g.memberCount)}${g.muted ? ' · 🔕' : ''} · <span>подробнее</span></span>
          </span>
        </button>
        ${data.summaryAvailable && data.missed >= 3 ? `
          <button onclick="SF.actions.groupSummary('${SF.js(groupId)}')" class="flex-shrink-0 px-2.5 py-1.5 rounded-xl btn-3d-dark text-[11px] flex items-center gap-1.5" aria-label="Кратко: что я пропустил"><span class="si-dot"></span><span>Кратко</span><span class="text-faint" data-no-tr>${data.missed}</span></button>` : ''}
      </div>

      ${summaryCard(groupId)}

      ${data.pinned ? `
        <button onclick="SF.actions.scrollToGroupMessage('${SF.js(data.pinned.id)}')" class="w-full px-3 py-2 rounded-xl bg-card border border-line text-left flex items-center gap-2">
          <span>📌</span>
          <span class="min-w-0">
            <span class="block text-[10px] font-bold text-brand">Закреплено</span>
            <span class="block text-[11px] text-ink-2 truncate">${SF.esc(data.pinned.text || ({ voice: '🎤 Голосовое', photo: '📷 Фото', video: '🎥 Видео' }[data.pinned.kind] || ''))}</span>
          </span>
        </button>` : ''}

      <div class="relative flex flex-col chat-fill">
        <div class="glass-card-3d p-3 flex flex-col flex-1 min-h-0 overflow-y-auto" id="chat-scroll">
          ${!data.messages.length ? '<div class="m-auto text-center text-xs text-muted px-4 leading-relaxed">Напишите первым — поздоровайтесь с группой 🙂</div>' : ''}
          ${data.messages.map((m, i, all) => {
            const prev = all[i - 1];
            const next = all[i + 1];
            const sameAs = (a, b) => a && b && a.sender.id === b.sender.id;
            const first = !sameAs(prev, m) || m === firstNew;
            const last = !sameAs(m, next) || next === firstNew;
            const run = { first, last, gap: i === 0 || m === firstNew ? '' : first ? 'mt-3' : 'mt-0.5' };
            return `${m === firstNew ? `<div id="group-new-divider" class="flex items-center gap-2 ${i ? 'mt-3' : ''} mb-2 text-[10px] font-bold text-brand"><span class="flex-1 h-px bg-[#81D8D0]"></span><span>Новые сообщения</span><span class="flex-1 h-px bg-[#81D8D0]"></span></div>` : ''}${groupMessage(groupId, m, run)}`;
          }).join('')}
        </div>
        ${visit.mentions.length || visit.reactions.length ? `
          <div class="absolute right-2 bottom-2 flex flex-col gap-1.5">
            ${visit.mentions.length ? `<button onclick="SF.actions.nextGroupMark('mentions')" class="relative w-10 h-10 rounded-full bg-card border-2 border-[#81D8D0] shadow-lg text-brand font-extrabold text-base" aria-label="Где меня отметили">@<span class="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-[#81D8D0] text-[#08302c] text-[9px] font-bold flex items-center justify-center" data-no-tr>${visit.mentions.length}</span></button>` : ''}
            ${visit.reactions.length ? `<button onclick="SF.actions.nextGroupMark('reactions')" class="relative w-10 h-10 rounded-full bg-card border-2 border-[#81D8D0] shadow-lg text-base" aria-label="Реакции на мои сообщения">❤️<span class="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-[#81D8D0] text-[#08302c] text-[9px] font-bold flex items-center justify-center" data-no-tr>${visit.reactions.length}</span></button>` : ''}
          </div>` : ''}
      </div>

      ${reply ? `
        <div class="px-3 py-2 rounded-xl bg-card border border-[#81D8D0] flex items-center gap-2">
          <span class="flex-1 min-w-0 pl-2 border-l-2 border-[#81D8D0]">
            <span class="block text-[10px] font-bold text-brand truncate">Ответ: ${SF.esc(reply.senderName)}</span>
            <span class="block text-[11px] text-ink-2 truncate">${SF.esc(reply.text)}</span>
          </span>
          <button onclick="SF.actions.cancelReply()" class="p-1 text-faint" aria-label="Отменить ответ"><i data-lucide="x" class="w-4 h-4"></i></button>
        </div>` : ''}

      <div id="mention-list"></div>
      <form onsubmit="SF.actions.sendGroup(event, '${SF.js(groupId)}')" class="flex items-center gap-1.5">
        <button type="button" onclick="SF.actions.sendGroupPhoto('${SF.js(groupId)}')" class="p-2.5 rounded-xl btn-3d-dark flex items-center justify-center" aria-label="Отправить фото"><i data-lucide="image" class="w-4 h-4"></i></button>
        <input type="text" name="text" data-keep="group-input" maxlength="2000" autocomplete="off" placeholder="Сообщение... (@ — отметить)" oninput="SF.actions.groupInput(this, '${SF.js(groupId)}')" class="flex-1 min-w-0 bg-card border border-line-2 rounded-xl px-3 py-2.5 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]" />
        ${canRecord ? `
          <button type="button" onclick="SF.actions.recordGroup('${SF.js(groupId)}', 'voice')" class="p-2.5 rounded-xl btn-3d-dark flex items-center justify-center" aria-label="Записать голосовое"><i data-lucide="mic" class="w-4 h-4"></i></button>
          <button type="button" onclick="SF.actions.recordGroup('${SF.js(groupId)}', 'video')" class="p-2.5 rounded-xl btn-3d-dark flex items-center justify-center" aria-label="Записать видео-кружок"><i data-lucide="circle-play" class="w-4 h-4"></i></button>` : ''}
        <button type="submit" class="p-2.5 rounded-xl btn-3d-tiffany flex items-center justify-center" aria-label="Отправить"><i data-lucide="send" class="w-4 h-4"></i></button>
      </form>
    `;
  }

  // ---------------- People picker: a new group, adding people ----------------
  let picker = { selected: new Map(), query: '', results: null };
  let pickerTimer = null;

  SF.actions.groupPickerSearch = (value) => {
    picker.query = String(value || '').trim();
    clearTimeout(pickerTimer);
    const q = picker.query.replace(/^@/, '');
    if (q.length < 2) {
      picker.results = null;
      store().notify();
      return;
    }
    pickerTimer = setTimeout(async () => {
      try {
        const res = await api().searchPeople(q);
        if (picker.query.replace(/^@/, '') === q) picker.results = res.people || [];
      } catch (err) {
        picker.results = [];
      }
      store().notify();
    }, 350);
  };

  SF.actions.groupPickerToggle = (id, name, photoUrl) => {
    if (picker.selected.has(id)) picker.selected.delete(id);
    else if (picker.selected.size >= 49) return showToast('В группе может быть до 50 человек');
    else picker.selected.set(id, { id, displayName: name, photoUrl: photoUrl || null });
    store().notify();
  };

  function pickerHtml(state, exclude = new Set()) {
    const known = (state.remote.peopleChats || []).map(c => c.person).filter(p => !exclude.has(p.id));
    const found = (picker.results || []).filter(p => !exclude.has(p.id));
    const list = picker.query.replace(/^@/, '').length >= 2 ? found : known;
    const row = (p) => {
      const on = picker.selected.has(p.id);
      return `
        <button type="button" onclick="SF.actions.groupPickerToggle('${SF.js(p.id)}', ${SF.esc(JSON.stringify(p.displayName))}, ${SF.esc(JSON.stringify(p.photoUrl || ''))})" class="w-full p-2.5 rounded-2xl flex items-center gap-3 text-left bg-card border ${on ? 'border-[#81D8D0]' : 'border-line'}">
          ${SF.avatar(p.photoUrl, { size: 36, kind: 'human', userId: p.id })}
          <span class="flex-1 min-w-0">
            <span class="block text-xs font-bold text-ink truncate">${SF.esc(p.displayName)}</span>
            <span class="block text-[10px] text-muted truncate">${SF.esc(p.headline || (p.username ? `@${p.username}` : ''))}</span>
          </span>
          <span class="w-5 h-5 rounded-full border-2 flex items-center justify-center text-[11px] ${on ? 'bg-[#81D8D0] border-[#81D8D0] text-[#08302c]' : 'border-line-2'}">${on ? '✓' : ''}</span>
        </button>`;
    };
    return `
      ${picker.selected.size ? `
        <div class="flex flex-wrap gap-1.5">
          ${[...picker.selected.values()].map(p => `
            <button type="button" onclick="SF.actions.groupPickerToggle('${SF.js(p.id)}')" class="pl-1 pr-2 py-1 rounded-full bg-[#81D8D0]/20 border border-[#81D8D0] text-[11px] text-ink flex items-center gap-1">
              ${SF.avatar(p.photoUrl, { size: 20, kind: 'human' })}${SF.esc(p.displayName)} ✕
            </button>`).join('')}
        </div>` : ''}
      <div class="relative">
        <i data-lucide="search" class="w-4 h-4 text-faint absolute left-3 top-1/2 -translate-y-1/2"></i>
        <input type="search" data-keep="group-picker" value="${SF.esc(picker.query)}" oninput="SF.actions.groupPickerSearch(this.value)" placeholder="Найти человека: имя, @ник" autocomplete="off"
          class="w-full bg-card border border-line-2 rounded-xl pl-9 pr-3 py-2.5 text-xs text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]" />
      </div>
      <div class="space-y-2">
        ${picker.query.replace(/^@/, '').length >= 2 && picker.results === null ? '<div class="text-xs text-muted px-1">Ищу…</div>' : ''}
        ${!picker.query && known.length ? SF.sectionTitle('', 'Мои переписки') : ''}
        ${list.map(row).join('')}
        ${picker.results && !found.length ? '<div class="text-xs text-muted px-1">Никого не нашли. Попробуйте имя или @ник.</div>' : ''}
        ${!picker.query && !known.length ? '<div class="text-xs text-muted px-1">Найдите людей по имени в поиске выше.</div>' : ''}
      </div>`;
  }

  function renderNew(state) {
    return `
      <div class="glass-card-3d p-3.5 space-y-2.5">
        <label class="block text-[11px] font-bold text-muted uppercase tracking-wider">Название группы</label>
        <input type="text" id="group-name" data-keep="group-name" maxlength="60" placeholder="Например: Йога по утрам" autocomplete="off"
          class="w-full bg-card border border-line-2 rounded-xl px-3 py-2.5 text-sm text-ink placeholder-faint focus:outline-none focus:border-[#81D8D0]" />
        <div class="text-[10px] text-faint leading-snug">Каждый, кого вы добавите, получит приглашение и сам решит, вступать ли. Позже можно позвать и по ссылке.</div>
      </div>
      ${SF.sectionTitle('user-plus', `Кого пригласить${picker.selected.size ? ` · ${picker.selected.size}` : ''}`)}
      ${pickerHtml(state)}
      <button onclick="SF.actions.createGroup()" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm sticky bottom-0">Создать группу</button>
    `;
  }

  SF.actions.createGroup = async () => {
    const name = (document.getElementById('group-name')?.value || '').trim();
    if (!name) return showToast('Напишите название группы');
    if (sending) return;
    sending = true;
    try {
      const res = await api().createGroup(name, [...picker.selected.keys()]);
      picker = { selected: new Map(), query: '', results: null };
      SF.data.invalidate('groups');
      SF.data.groups();
      SF.openIn('chats', 'group', { id: res.groupId });
      showToast(res.invited ? `Группа создана. Приглашения: ${res.invited}` : 'Группа создана');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не получилось', err));
    } finally {
      sending = false;
    }
  };

  function renderAdd(state, groupId) {
    const data = state.remote.groupThreads[groupId];
    if (!data) return '<div class="text-xs text-muted">Загружаю…</div>';
    const exclude = new Set(data.members.map(m => m.id));
    return `
      ${pickerHtml(state, exclude)}
      <button onclick="SF.actions.addToGroup('${SF.js(groupId)}')" class="w-full py-3 rounded-2xl btn-3d-tiffany text-sm sticky bottom-0">Пригласить${picker.selected.size ? ` (${picker.selected.size})` : ''}</button>
    `;
  }

  SF.actions.addToGroup = async (groupId) => {
    if (!picker.selected.size) return showToast('Выберите, кого пригласить');
    const res = await call('POST', groupId, '/invite', { userIds: [...picker.selected.keys()] });
    if (!res) return;
    picker = { selected: new Map(), query: '', results: null };
    showToast(res.invited ? `Приглашения отправлены: ${res.invited}` : 'Эти люди уже в группе или не могут быть приглашены');
    await reload(groupId);
    SF.back();
  };

  SF.actions.openAddToGroup = (groupId) => {
    picker = { selected: new Map(), query: '', results: null };
    SF.push('group-add', { id: groupId });
  };

  // ---------------- Screen: about the group ----------------
  function renderInfo(state, groupId) {
    const data = state.remote.groupThreads[groupId];
    if (!data) return '<div class="text-xs text-muted">Загружаю…</div>';
    const g = data.group;
    const admin = isAdmin(g);
    const meId = store().data.me.id;
    // A tap anywhere on a person opens their profile (writing to them is there); the owner / admins
    // have a small «…» menu on the right
    const memberRow = (m) => {
      const me = m.id === meId;
      const canRemove = !me && admin && m.role !== 'owner' && (g.role === 'owner' || m.role === 'member');
      const menu = !me && ((g.role === 'owner' && !m.invited) || canRemove);
      return `
        <div class="p-2.5 rounded-2xl bg-card border border-line flex items-center gap-2.5">
          <button onclick="SF.actions.openPersonProfile('${SF.js(m.id)}')" class="flex-1 min-w-0 flex items-center gap-2.5 text-left">
            ${SF.avatar(m.photoUrl, { size: 36, kind: 'human', userId: m.id })}
            <span class="flex-1 min-w-0">
              <span class="flex items-center gap-1 text-xs font-bold text-ink min-w-0"><span class="truncate">${SF.esc(m.displayName)}${me ? ' (вы)' : ''}</span>${SF.partnerBadge(m.id, 12)}</span>
              <span class="block text-[10px] text-muted truncate">${m.invited ? 'приглашён(а)' : ROLE_LABEL[m.role] || SF.esc(m.headline || '')}</span>
            </span>
          </button>
          ${menu ? `
            <details class="relative flex-shrink-0">
              <summary class="list-none p-1.5 rounded-lg btn-3d-dark cursor-pointer" aria-label="Ещё"><i data-lucide="more-horizontal" class="w-3.5 h-3.5"></i></summary>
              <div class="absolute right-0 mt-1 z-20 w-44 p-1.5 rounded-xl bg-card border border-line shadow-lg space-y-1">
                ${g.role === 'owner' && !m.invited ? `<button onclick="SF.actions.setGroupRole('${SF.js(groupId)}', '${SF.js(m.id)}', '${m.role === 'admin' ? 'member' : 'admin'}')" class="w-full text-left px-2.5 py-2 rounded-lg text-xs text-ink-2 hover:bg-sunken">${m.role === 'admin' ? 'Снять админа' : 'Сделать админом'}</button>` : ''}
                ${canRemove ? `<button onclick="SF.actions.removeFromGroup('${SF.js(groupId)}', '${SF.js(m.id)}', ${SF.esc(JSON.stringify(m.displayName))})" class="w-full text-left px-2.5 py-2 rounded-lg text-xs text-rose-500 hover:bg-sunken">${m.invited ? 'Отменить приглашение' : 'Удалить из группы'}</button>` : ''}
              </div>
            </details>` : ''}
        </div>`;
    };
    return `
      <div class="glass-card-3d p-4 text-center space-y-2">
        <button ${admin ? `onclick="SF.actions.changeGroupPhoto('${SF.js(groupId)}')"` : ''} class="relative inline-block" ${admin ? 'aria-label="Изменить фото"' : ''}>
          ${groupAvatar(g.photoUrl, 84)}
          ${admin ? '<span class="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-card border border-line-2 flex items-center justify-center text-ink-2 shadow"><i data-lucide="camera" class="w-3.5 h-3.5"></i></span>' : ''}
        </button>
        <div class="text-base font-extrabold text-ink flex items-center justify-center gap-1.5">
          <span data-no-tr>${SF.esc(g.name)}</span>
          ${admin ? `<button onclick="SF.actions.renameGroup('${SF.js(groupId)}')" class="p-1 text-faint" aria-label="Переименовать"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>` : ''}
        </div>
        <div class="text-[11px] text-muted">${members(g.memberCount)} · <span>до 50</span></div>
      </div>

      ${admin ? `
        <div class="grid grid-cols-2 gap-2">
          <button onclick="SF.actions.openAddToGroup('${SF.js(groupId)}')" class="py-2.5 rounded-xl btn-3d-tiffany text-xs flex items-center justify-center gap-1.5"><i data-lucide="user-plus" class="w-3.5 h-3.5"></i>Добавить</button>
          <button onclick="SF.actions.shareGroupLink('${SF.js(groupId)}')" class="py-2.5 rounded-xl btn-3d-dark text-xs flex items-center justify-center gap-1.5"><i data-lucide="share-2" class="w-3.5 h-3.5"></i>Ссылка-приглашение</button>
        </div>` : ''}

      <label class="glass-card-3d p-3 flex items-center justify-between gap-3 text-xs cursor-pointer">
        <span>
          <span class="block text-ink-2 font-semibold">Без звука</span>
          <span class="block text-[10px] text-faint leading-snug">Не присылать уведомления о новых сообщениях этой группы.</span>
        </span>
        <input type="checkbox" ${g.muted ? 'checked' : ''} onchange="SF.actions.muteGroup('${SF.js(groupId)}', this.checked)" class="w-5 h-5 accent-[#0d9488] flex-shrink-0" />
      </label>

      <div class="space-y-2">
        ${SF.sectionTitle('users', 'Участники')}
        ${data.members.map(memberRow).join('')}
      </div>

      <div class="grid grid-cols-2 gap-2">
        <button onclick="SF.actions.reportGroup('${SF.js(groupId)}', null)" class="py-2.5 rounded-xl bg-sunken border border-line text-xs text-rose-500">Пожаловаться</button>
        <button onclick="SF.actions.leaveGroup('${SF.js(groupId)}')" class="py-2.5 rounded-xl bg-sunken border border-line text-xs text-ink-2">Выйти из группы</button>
      </div>
    `;
  }

  SF.actions.changeGroupPhoto = async (groupId) => {
    if (!window.sfMedia) return;
    try {
      const res = await window.sfMedia.choosePhoto((blob) => api().uploadGroupPhoto(groupId, blob));
      if (!res) return;
      if (!res.savedOnServer) return showToast('Не сохранилось. Попробуйте ещё раз');
      showToast('Фото группы обновлено');
      await reload(groupId);
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не сохранилось', err));
    }
  };

  SF.actions.renameGroup = async (groupId) => {
    const current = store().data.remote.groupThreads[groupId]?.group?.name || '';
    const name = window.prompt('Новое название группы', current);
    if (name === null || !name.trim() || name.trim() === current) return;
    if (await call('PUT', groupId, '', { name: name.trim() }, 'Название изменено')) await reload(groupId);
  };

  SF.actions.shareGroupLink = async (groupId) => {
    const data = store().data.remote.groupThreads[groupId];
    const code = data && data.group.inviteCode;
    if (!code) return;
    const link = SF.appLink(`J_${code}`);
    const text = `Присоединяйтесь к группе «${data.group.name}» в SmartFlow: ${link}`;
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    SF.copyText(text, 'Ссылка-приглашение скопирована');
  };

  SF.actions.muteGroup = async (groupId, muted) => {
    if (await call('PUT', groupId, '/mute', { muted }, muted ? 'Без звука' : 'Уведомления включены')) await reload(groupId);
  };

  SF.actions.setGroupRole = async (groupId, userId, role) => {
    if (await call('PUT', groupId, `/members/${encodeURIComponent(userId)}`, { role }, role === 'admin' ? 'Теперь админ' : 'Больше не админ')) await reload(groupId);
  };

  SF.actions.removeFromGroup = async (groupId, userId, name) => {
    if (!window.confirm(`Удалить ${name} из группы? По ссылке-приглашению вернуться не получится.`)) return;
    if (await call('DELETE', groupId, `/members/${encodeURIComponent(userId)}`, undefined, 'Готово')) await reload(groupId);
  };

  SF.actions.leaveGroup = async (groupId) => {
    if (!window.confirm('Выйти из группы? Переписка у вас пропадёт.')) return;
    if (!await call('POST', groupId, '/leave', undefined, 'Вы вышли из группы')) return;
    SF.data.invalidate('groups');
    await SF.data.groups();
    store().data.ui.routes.chats = store().data.ui.routes.chats.slice(0, 1);
    store().notify();
  };

  // ---------------- Screen: an invitation link ----------------
  const previews = {};
  function renderJoin(state, code) {
    if (!SF.data.signedIn()) return SF.emptyState('assistant', 'Откройте приложение в Telegram', 'Вступить в группу можно после входа через Telegram.');
    const p = previews[code];
    if (!p) return '<div class="text-xs text-muted">Загружаю…</div>';
    if (p.error) return SF.emptyState('assistant', 'Ссылка не работает', SF.esc(p.error));
    return `
      <div class="glass-card-3d p-5 text-center space-y-3">
        <div class="flex justify-center">${groupAvatar(p.photoUrl, 72)}</div>
        <div class="text-base font-extrabold text-ink" data-no-tr>${SF.esc(p.name)}</div>
        <div class="text-xs text-muted"><span>Группа в SmartFlow</span> · ${members(p.memberCount)}</div>
        ${p.removed ? '<div class="text-xs text-muted">Вас удалили из этой группы — вступить по ссылке нельзя.</div>'
          : p.isMember ? `<button onclick="SF.actions.openGroup('${SF.js(p.groupId)}')" class="w-full py-2.5 rounded-xl btn-3d-tiffany text-xs">Открыть группу</button>`
          : `<button onclick="SF.actions.joinGroup('${SF.js(code)}')" class="w-full py-2.5 rounded-xl btn-3d-tiffany text-xs">Вступить</button>`}
      </div>`;
  }

  async function loadPreview(code) {
    if (previews[code] || !SF.data.signedIn()) return;
    previews[code] = null;
    try {
      previews[code] = await api().previewGroupLink(code);
    } catch (err) {
      previews[code] = { error: err.message || 'Ссылка-приглашение устарела' };
    }
    store().notify();
  }

  SF.actions.joinGroup = async (code) => {
    try {
      const res = await api().joinGroupLink(code);
      store().setRemote(`groupThreads.${res.group.id}`, res);
      SF.data.invalidate('groups');
      SF.data.groups();
      SF.openIn('chats', 'group', { id: res.group.id });
      showToast('Вы в группе 🙂');
    } catch (err) {
      showToast(SF.withErrorCode(err.message || 'Не получилось', err));
    }
  };

  // ---------------- Wiring for screens/chats.js ----------------
  SF.groups = {
    owns: (screen) => String(screen || '').startsWith('group'),
    listRow,
    unreadCount: (state) => (state.remote.groups || []).filter(g => g.unread || g.invited).length,
    title(route, state) {
      if (route.screen === 'group-new') return 'Новая группа';
      if (route.screen === 'group-add') return 'Добавить людей';
      if (route.screen === 'group-join') return 'Приглашение в группу';
      if (route.screen === 'group-info') return 'О группе';
      return state.remote.groupThreads[route.id]?.group?.name || 'Группа';
    },
    render(route, state) {
      if (route.screen === 'group-new') return renderNew(state);
      if (route.screen === 'group-add') return renderAdd(state, route.id);
      if (route.screen === 'group-info') return renderInfo(state, route.id);
      if (route.screen === 'group-join') return renderJoin(state, route.code);
      return renderGroup(state, route.id);
    },
    afterRender(route) {
      if (route.screen === 'group-join') return loadPreview(route.code);
      if (route.screen === 'group-new') return SF.data.peopleChats();
      if (route.screen === 'group-add') {
        SF.data.peopleChats();
        return SF.data.groupMessages(route.id);
      }
      if (route.screen === 'group-info') return SF.data.groupMessages(route.id, 15000);
      const groupId = route.id;
      SF.data.groupMessages(groupId);
      // With «Новые сообщения»: to where I stopped once, then the reading place stays (my own message
      // scrolls down by itself); without it — to the bottom, as in any chat
      const divider = document.getElementById('group-new-divider');
      if (!divider) {
        SF.scrollToBottom('chat-scroll');
      } else if (!visit.scrolled) {
        visit.scrolled = true;
        setTimeout(() => divider.scrollIntoView({ block: 'start' }), 60);
      }
      loadFiles();
      SF.data.poll(`group:${groupId}`, () => {
        SF.data.groupMessages(groupId, 4000);
        SF.data.groups(4000);
      });
    }
  };
})(window);
