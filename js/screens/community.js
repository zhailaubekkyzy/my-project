// screens/community.js - «Комьюнити» (owner's decision 21 Nov.: instead of «Инкубатор», like Skool).
// The frame only for now. Planned (each its own pull request, see docs/ARCHITECTURE.md, «Комьюнити»):
// communities of experts with a feed, members, courses, points, levels and return triggers.
// Only a business profile creates communities (it has the analytics), as many as it wants;
// everyone joins. A simple group conversation is a different thing: it lives in «Чаты».
// No made-up communities or numbers here: an honest empty screen until the real ones exist.

(function (window) {
  const SF = window.SF;
  const store = () => window.funnelStore;

  function renderList() {
    const business = store().isBusinessView();
    return `
      ${SF.emptyState('buddy', 'Сообщества экспертов', 'Здесь будут сообщества: лента, курсы, участники и уровни. Вступайте бесплатно или по ссылке эксперта.')}

      ${business ? `
        <button onclick="SF.showToast('Создание сообществ появится в следующих версиях')" class="w-full glass-card-3d p-3.5 flex items-center gap-3 text-left">
          <span class="w-10 h-10 rounded-2xl bg-[#81D8D0]/20 flex items-center justify-center text-brand flex-shrink-0"><i data-lucide="plus" class="w-5 h-5"></i></span>
          <span class="flex-1">
            <span class="block text-sm font-bold text-ink">Создать сообщество ${SF.soonBadge()}</span>
            <span class="block text-[11px] text-muted leading-snug">Своё сообщество с курсами и аналитикой. Сколько угодно сообществ.</span>
          </span>
        </button>
      ` : ''}

      <div class="space-y-2">
        ${SF.sectionTitle('users', 'Мои сообщества')}
        <div class="text-xs text-muted px-1">Пока нет сообществ.</div>
      </div>
    `;
  }

  SF.screens.community = {
    title() {
      return 'Комьюнити';
    },
    render() {
      return renderList();
    }
  };
})(window);
