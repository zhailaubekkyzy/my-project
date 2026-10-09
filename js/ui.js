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
    toast.querySelector('span').textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2800);
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

  Object.assign(SF, {
    MASCOTS,
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
    closeModal,
    openLink,
    copyText,
    withErrorCode,
    scrollToBottom
  });
})(window);
