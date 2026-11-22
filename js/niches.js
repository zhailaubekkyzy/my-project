// js/niches.js - Ниши Маркетплейса и «Вопросы и ответы» (решения владелицы 22 нояб.), общие детали экранов.
//  - Фильтр «раздел → ниша» как в маркетплейсах: на «Специалисты» и «Шаблоны ИИ-продавцов»; разделы и ниши — только где что-то есть.
//  - Поле ниши: человек пишет, подсказки из списка; такой нет — сервер создаёт её в выбранном разделе.
//  - FAQ: редактор пар «вопрос — ответ» (строки добавляются без перерисовки экрана) и показ в карточке.

(function (window) {
  const SF = window.SF;
  const store = () => window.funnelStore;
  const esc = (v) => SF.esc(v);

  // Icons of the sections (the list itself comes from the server, niche-service.SECTIONS); named here so the
  // icon build (scripts/build-icons.js) keeps them
  const SECTION_ICONS = [
    { icon: 'heart-pulse' }, { icon: 'dumbbell' }, { icon: 'brain' }, { icon: 'sparkles' }, { icon: 'briefcase' },
    { icon: 'megaphone' }, { icon: 'wallet' }, { icon: 'graduation-cap' }, { icon: 'baby' }, { icon: 'palette' },
    { icon: 'laptop' }, { icon: 'sun' }, { icon: 'home' }, { icon: 'layout-grid' }
  ];
  void SECTION_ICONS;

  const catalog = () => store().data.remote.niches;
  const sections = () => (catalog() && catalog().sections) || [];
  const niches = () => (catalog() && catalog().niches) || [];
  const sectionLabel = (id) => (sections().find(s => s.id === id) || {}).label || '';

  /**
   * The filter: kind 'experts' | 'templates'; keys — the route keys for the section and the niche;
   * route — the current route. Clicking patches the route.
   */
  function filter(kind, route, { sec = 'sec', nic = 'nic' } = {}) {
    if (!catalog()) return '';
    const count = (n) => (kind === 'templates' ? n.templates : n.experts);
    const withItems = niches().filter(n => count(n) > 0);
    const used = sections().filter(s => withItems.some(n => n.section === s.id));
    if (!used.length) return '';
    const current = route[sec] || '';
    const chip = (active, onclick, label, icon) => `
      <button onclick="${onclick}" class="px-3 py-1.5 rounded-xl text-xs whitespace-nowrap border font-semibold flex items-center gap-1.5 ${active ? 'bg-[#81D8D0]/20 border-[#81D8D0] text-brand' : 'bg-card border-line text-muted'}">
        ${icon ? `<i data-lucide="${icon}" class="w-3.5 h-3.5"></i>` : ''}${label}</button>`;
    const inSection = current ? withItems.filter(n => n.section === current) : [];
    return `
      <div class="space-y-1.5">
        <div class="flex gap-1.5 overflow-x-auto pb-1">
          ${chip(!current, `SF.patch({ ${sec}: '', ${nic}: '' })`, 'Все', '')}
          ${used.map(s => chip(current === s.id, `SF.patch({ ${sec}: '${s.id}', ${nic}: '' })`, esc(s.label), s.icon)).join('')}
        </div>
        ${inSection.length > 1 ? `
          <div class="flex gap-1.5 overflow-x-auto pb-1">
            ${chip(!route[nic], `SF.patch({ ${nic}: '' })`, 'Все ниши', '')}
            ${inSection.map(n => chip(route[nic] === n.id, `SF.patch({ ${nic}: '${SF.js(n.id)}' })`, `${esc(n.name)} <span class="text-faint font-normal">${count(n)}</span>`, '')).join('')}
          </div>` : ''}
      </div>`;
  }

  /** Does an item with { niche: { id, section } } (or nicheId / nicheSection) pass the filter? */
  function matches(item, route, { sec = 'sec', nic = 'nic' } = {}) {
    const id = (item.niche && item.niche.id) || item.nicheId || null;
    const section = (item.niche && item.niche.section) || item.nicheSection || null;
    if (route[nic]) return id === route[nic];
    if (route[sec]) return section === route[sec];
    return true;
  }

  /**
   * The niche field of a form: the name with suggestions and the section (used only when the niche is new).
   * names: nicheName, nicheSection.
   */
  function field({ value = '', section = '', label = 'Ниша', hint = '', onName = '', onSection = '' } = {}) {
    const listId = `niche-list-${Math.random().toString(36).slice(2, 8)}`;
    const known = niches().find(n => n.name.toLowerCase() === String(value).toLowerCase());
    const sec = section || (known && known.section) || '';
    return `
      <div class="space-y-1.5">
        <label class="block space-y-1">
          <span class="font-semibold text-ink-2">${label}</span>
          <input name="nicheName" list="${listId}" maxlength="60" value="${esc(value)}" autocomplete="off" ${onName ? `oninput="${onName}"` : ''} placeholder="Например: Нутрициология, Йога, SMM"
            class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink" />
          <datalist id="${listId}">${niches().map(n => `<option value="${esc(n.name)}">${esc(sectionLabel(n.section))}</option>`).join('')}</datalist>
        </label>
        <label class="block space-y-1">
          <span class="text-[11px] text-muted">Раздел (если вашей ниши ещё нет в списке)</span>
          <select name="nicheSection" ${onSection ? `onchange="${onSection}"` : ''} class="w-full p-2.5 rounded-xl bg-sunken border border-line-2 text-ink">
            ${sections().map(s => `<option value="${s.id}" ${s.id === (sec || 'other') ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
          </select>
        </label>
        <span class="block text-[10px] text-faint">${hint || 'Начните писать — появятся подсказки. Нет вашей ниши — она создастся сама и сразу появится в фильтрах.'}</span>
      </div>`;
  }

  // ---------- «Вопросы и ответы» ----------
  const box = 'w-full p-2.5 rounded-xl bg-card border border-line-2 text-ink text-xs';
  function faqRow(item = {}) {
    return `
      <div class="faq-row p-2.5 rounded-xl bg-sunken border border-line space-y-1.5">
        <div class="flex items-center gap-1.5">
          <input data-faq="q" maxlength="200" value="${esc(item.q || '')}" placeholder="Вопрос: например «Есть рассрочка?»" class="${box}" />
          <button type="button" onclick="this.closest('.faq-row').remove()" class="p-1 text-faint flex-shrink-0" aria-label="Удалить"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>
        </div>
        <textarea data-faq="a" rows="2" maxlength="1000" placeholder="Ответ" class="${box}">${esc(item.a || '')}</textarea>
      </div>`;
  }

  /** The FAQ editor inside a form; read it back with readFaq(form). */
  function faqEditor(list = [], { max = 15 } = {}) {
    const rows = (list || []).length ? list : [{}];
    return `
      <div class="space-y-1.5" data-faq-editor data-max="${max}">
        <div class="space-y-1.5" data-faq-rows>${rows.map(faqRow).join('')}</div>
        <button type="button" onclick="SF.niches.addFaqRow(this)" class="w-full py-1.5 rounded-xl bg-card border border-dashed border-line-2 text-ink-2 text-[11px]">+ Вопрос</button>
      </div>`;
  }

  function addFaqRow(button) {
    const editor = button.closest('[data-faq-editor]');
    const rows = editor.querySelector('[data-faq-rows]');
    if (rows.children.length >= Number(editor.dataset.max || 15)) return SF.showToast(`До ${editor.dataset.max} вопросов`);
    rows.insertAdjacentHTML('beforeend', faqRow());
    if (window.lucide) window.lucide.createIcons();
    const inputs = rows.querySelectorAll('[data-faq="q"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  function readFaq(root) {
    return [...root.querySelectorAll('.faq-row')].map(r => ({
      q: r.querySelector('[data-faq="q"]').value.trim(),
      a: r.querySelector('[data-faq="a"]').value.trim()
    })).filter(x => x.q && x.a);
  }

  /** The FAQ on a card: questions open their answers (like on marketplaces). */
  function faqView(list, { askHint = '' } = {}) {
    if (!list || !list.length) return '';
    return `
      <div class="glass-card-3d p-4 space-y-2 text-xs">
        ${SF.sectionTitle('help-circle', 'Вопросы и ответы')}
        ${list.map(x => `
          <details class="rounded-xl bg-sunken border border-line">
            <summary class="p-2.5 font-semibold text-ink cursor-pointer">${esc(x.q)}</summary>
            <div class="px-2.5 pb-2.5 text-ink-2 whitespace-pre-line leading-snug">${esc(x.a)}</div>
          </details>`).join('')}
        ${askHint ? `<div class="text-[10px] text-faint leading-snug">${askHint}</div>` : ''}
      </div>`;
  }

  SF.niches = { filter, matches, field, faqEditor, addFaqRow, readFaq, faqView, sectionLabel };
})(window);
