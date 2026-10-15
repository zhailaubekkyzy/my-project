// ui.js - Shared helpers and small building blocks used by every screen.
// Screens live in js/screens/*.js and register themselves in window.SF.screens.

(function (window) {
  const SF = window.SF = window.SF || {};
  SF.screens = SF.screens || {};
  SF.actions = SF.actions || {};

  const MASCOTS = {
    assistant: 'images/mascots/si-assistant.webp',
    buddy: 'images/mascots/si-buddy.webp',
    consultant: 'images/mascots/si-consultant.webp'
  };
  const PERSON_PLACEHOLDER = 'images/avatar-person.svg';

  // Everything typed by people (names, bios, messages) goes through esc() before innerHTML.
  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Value for an inline onclick="...('${js(x)}')" argument
  function js(value) {
    return esc(String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
  }

  function formatMoney(amount) {
    if (typeof amount === 'string') return amount;
    if (!amount) return 'Бесплатно';
    return new Intl.NumberFormat('ru-RU').format(amount) + ' ₽';
  }

  function formatChatMarkdown(text) {
    return esc(text)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br/>');
  }

  // Photo URL as the browser needs it (server photos live on the API host)
  function photoSrc(url, fallback = MASCOTS.consultant) {
    const api = window.smartFlowApi;
    return esc((api && url ? api.mediaUrl(url) : url) || fallback);
  }

  /**
   * Round photo. kind: 'si' adds the red SI dot, 'human' a Tiffany ring.
   */
  function avatar(url, { size = 40, kind = 'human', fallback } = {}) {
    const fb = fallback || (kind === 'si' ? MASCOTS.consultant : PERSON_PLACEHOLDER);
    const ring = kind === 'si' ? 'border-[var(--si-bubble-line)]' : 'border-[#81D8D0]';
    return `
      <span class="relative inline-block flex-shrink-0" style="width:${size}px;height:${size}px">
        <img src="${photoSrc(url, fb)}" alt="" loading="lazy"
          onerror="this.onerror=null;this.src='${fb}'"
          class="w-full h-full rounded-full object-cover border-2 ${ring} bg-card" />
        ${kind === 'si' ? '<span class="si-dot absolute -bottom-0.5 -right-0.5 border-2 border-card" style="width:12px;height:12px"></span>' : ''}
      </span>`;
  }

  function siLabel(text = 'SI') {
    return `<span class="inline-flex items-center gap-1 text-si font-semibold"><span class="si-dot"></span>${esc(text)}</span>`;
  }

  function sectionTitle(icon, text, extra = '') {
    return `
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
          ${icon ? `<i data-lucide="${icon}" class="w-4 h-4 text-brand"></i>` : ''}${text}
        </h2>
        ${extra}
      </div>`;
  }

  function emptyState(mascot, title, text) {
    return `
      <div class="glass-card-3d p-5 text-center space-y-2">
        <img src="${MASCOTS[mascot]}" alt="" class="w-20 h-20 mx-auto" />
        <div class="text-sm font-bold text-ink">${title}</div>
        <div class="text-xs text-muted leading-relaxed">${text}</div>
      </div>`;
  }

  // "Скоро" marker for parts of the plan that are not connected yet (see docs/ARCHITECTURE.md)
  function soonBadge(text = 'скоро') {
    return `<span class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-raised text-faint border border-line">${text}</span>`;
  }

  /**
   * Trust percent of a profile and what would raise it (shown in Profile and Buddy).
   */
  function trustScore(me) {
    const p = me.profile || {};
    const checks = [
      { done: me.hasUploadedPhoto || Boolean(me.photoUrl), points: 20, tip: 'Добавьте своё фото' },
      { done: Boolean(p.headline), points: 10, tip: 'Напишите, чем вы занимаетесь, одной строкой' },
      { done: Boolean(p.bio), points: 15, tip: 'Расскажите о себе' },
      { done: Boolean(p.regalia), points: 15, tip: 'Добавьте регалии и сертификаты' },
      { done: Boolean(p.results), points: 20, tip: 'Добавьте результаты и кейсы' },
      { done: (p.links || []).length > 0, points: 10, tip: 'Добавьте ссылки на соцсети' },
      { done: Boolean(p.offerButton), points: 10, tip: 'Добавьте кнопку с вашим оффером' }
    ];
    const score = checks.reduce((sum, c) => sum + (c.done ? c.points : 0), 0);
    return { score, tips: checks.filter(c => !c.done).map(c => c.tip) };
  }

  function progressBar(percent, color = 'bg-[#81D8D0]') {
    return `
      <div class="w-full h-2 rounded-full bg-sunken border border-line overflow-hidden">
        <div class="h-full rounded-full ${color}" style="width:${Math.max(0, Math.min(100, percent))}%"></div>
      </div>`;
  }

  // All notifications come from SI-Buddy
  function showToast(msg) {
    const existing = document.getElementById('app-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'fixed bottom-24 left-1/2 -translate-x-1/2 z-50 max-w-[90vw] pl-1.5 pr-4 py-1.5 rounded-2xl bg-card border border-[#81D8D0]/60 text-ink text-xs font-semibold shadow-2xl flex items-center gap-2';
    toast.innerHTML = `<img src="${MASCOTS.buddy}" alt="" class="w-7 h-7 flex-shrink-0" /><span></span>`;
    toast.querySelector('span').textContent = SF.clientScreen !== false && SF.t ? SF.t(msg) : msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2800);
  }

  // "SMARTFLOW PARTNER": a gold medal with rays, a turquoise ring and a red ribbon; the partner's own photo inside
  function partnerMedal(photoUrl, count, { size = 96 } = {}) {
    const inner = Math.round(size * 0.62);
    return `
      <div class="flex flex-col items-center gap-1.5" data-no-tr>
        <div class="relative" style="width:${size}px;height:${size + Math.round(size * 0.28)}px">
          <div class="absolute left-1/2 -translate-x-1/2 top-0" style="width:${Math.round(size * 0.36)}px;height:${Math.round(size * 0.34)}px;background:linear-gradient(90deg,#b5121b,#e0313b 50%,#b5121b);clip-path:polygon(0 0,100% 0,78% 100%,22% 100%)"></div>
          <div class="absolute left-0 rounded-full shadow-lg flex items-center justify-center" style="top:${Math.round(size * 0.28)}px;width:${size}px;height:${size}px;background:repeating-conic-gradient(from 0deg,#f7d774 0deg 5deg,#c9962b 5deg 10deg);">
            <div class="rounded-full flex items-center justify-center" style="width:${Math.round(size * 0.78)}px;height:${Math.round(size * 0.78)}px;background:radial-gradient(circle,#f3cf6a,#b8862a);box-shadow:inset 0 0 0 ${Math.max(2, Math.round(size * 0.03))}px #3fc1b5">
              <img src="${photoSrc(photoUrl, PERSON_PLACEHOLDER)}" alt="" onerror="this.onerror=null;this.src='${PERSON_PLACEHOLDER}'" class="rounded-full object-cover bg-card" style="width:${inner}px;height:${inner}px;filter:sepia(.35) saturate(1.15)" />
            </div>
          </div>
        </div>
        <div class="text-[11px] font-extrabold tracking-[0.18em] text-amber-600">SMARTFLOW PARTNER</div>
        ${count !== undefined && count !== null ? `<div class="text-[11px] text-muted">${lang() === 'en' ? 'People came: ' : 'Пришло людей: '}<b class="text-ink">${count}</b></div>` : ''}
      </div>`;
  }
  const lang = () => (SF.lang ? SF.lang() : 'ru');

  // Stars of a review: ★★★★☆ (Tiffany — it is about people)
  function stars(rating, cls = 'text-[11px]') {
    const n = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
    return `<span class="${cls} text-brand tracking-tight" aria-label="${n} из 5">${'★'.repeat(n)}<span class="text-faint">${'★'.repeat(5 - n)}</span></span>`;
  }

  function openModal(innerHtml) {
    const modal = document.getElementById('modal-container');
    if (!modal) return;
    modal.innerHTML = `
      <div class="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-3" onclick="SF.closeModal()">
        <div class="glass-card-3d w-full max-w-md p-5 space-y-3 max-h-[88vh] overflow-y-auto" onclick="event.stopPropagation()">
          ${innerHtml}
        </div>
      </div>`;
    if (window.lucide) window.lucide.createIcons();
    if (SF.clientScreen !== false && SF.translateDom) SF.translateDom(modal);
  }

  function closeModal() {
    const modal = document.getElementById('modal-container');
    if (modal) modal.innerHTML = '';
  }

  // External links open through Telegram when possible (stays inside the Telegram app)
  function openLink(url) {
    const tg = window.Telegram?.WebApp;
    if (!/^https?:\/\//i.test(url || '')) return;
    if (tg && tg.openLink && tg.initData) {
      tg.openLink(url);
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }

  function copyText(text, okMessage = 'Ссылка скопирована') {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => showToast(okMessage)).catch(() => showToast(text));
    } else {
      showToast(text);
    }
  }

  // "Не отправилось (код K7P2)": the code of a server or connection failure, for support
  function withErrorCode(text, err) {
    const code = err && err.errorCode;
    return code && (err.status >= 500 || err.status === 0) ? `${text} (код ${code})` : text;
  }

  function scrollToBottom(elementId) {
    setTimeout(() => {
      const el = document.getElementById(elementId);
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);
  }

  // A voice message in a chat: "▶ 0:18" and the transcript under it. path: where the server gives the
  // recording (private, loaded with the session), e.g. /api/chat/<slug>/voice/<id>
  const voiceLabel = (s) => `${Math.floor((s || 0) / 60)}:${String((s || 0) % 60).padStart(2, '0')}`;
  function voiceContent(msg, path) {
    const transcript = msg.text && msg.text !== 'Голосовое сообщение' ? msg.text : '';
    return `
      <button onclick="SF.playVoice(this, '${js(path)}')" class="flex items-center gap-1.5 text-xs font-semibold">
        <span data-voice-icon>▶</span><span>🎤 ${voiceLabel(msg.voiceSeconds)}</span>
      </button>
      ${transcript ? `<div class="text-[11px] opacity-80 mt-1 italic">${esc(transcript)}</div>` : ''}`;
  }

  let playing = null;
  async function playVoice(button, path) {
    if (playing && playing.path === path) {
      playing.audio.pause();
      playing.button.querySelector('[data-voice-icon]').textContent = '▶';
      playing = null;
      return;
    }
    if (playing) {
      playing.audio.pause();
      playing.button.querySelector('[data-voice-icon]').textContent = '▶';
    }
    const icon = button.querySelector('[data-voice-icon]');
    icon.textContent = '…';
    try {
      const blob = await window.smartFlowApi.getPrivateBlob(path);
      const audio = new Audio(URL.createObjectURL(blob));
      playing = { path, audio, button };
      audio.onended = () => { icon.textContent = '▶'; playing = null; };
      await audio.play();
      icon.textContent = '⏸';
    } catch (err) {
      icon.textContent = '▶';
      showToast('Не получилось проиграть голосовое');
    }
  }

  Object.assign(SF, {
    MASCOTS,
    voiceContent,
    playVoice,
    esc,
    js,
    formatMoney,
    formatChatMarkdown,
    photoSrc,
    avatar,
    siLabel,
    sectionTitle,
    emptyState,
    soonBadge,
    trustScore,
    progressBar,
    showToast,
    openModal,
    stars,
    partnerMedal,
    closeModal,
    openLink,
    copyText,
    withErrorCode,
    scrollToBottom
  });
})(window);
