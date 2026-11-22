// store.js - App state. Only real data: everything shown about consultants, chats and clients
// comes from the server (js/data.js). Saved on the device as a cache for a fast first screen.

const STORAGE_KEY = 'smartflow_tma_v5'; // v5: real data only, no demo content

const defaultData = {
  appName: 'SmartFlow',
  appSlogan: 'From idea to selling. Faster.',

  // Telegram login and the server session
  auth: {
    status: 'checking', // 'checking' | 'authenticated' | 'expired' | 'offline'
    internalUserId: null,
    error: null
  },

  // Navigation: the open tab and a stack of screens inside every tab (last = visible).
  ui: {
    tab: 'buddy',
    routes: {
      community: [{ screen: 'list' }],
      marketplace: [{ screen: 'list' }],
      buddy: [{ screen: 'home' }],
      chats: [{ screen: 'list' }],
      profile: [{ screen: 'view' }]
    },
    marketplaceFilter: 'all'
  },

  // The person using the app (from the server after login)
  me: {
    id: null,
    displayName: '',
    username: null,
    photoUrl: null,
    hasUploadedPhoto: false,
    supportCode: null,       // short number for support, e.g. SF-48213 (shown in Profile)
    staffRole: null,         // 'owner' | 'support' | null — opens the support panel
    profile: {
      displayName: '',
      headline: '',
      bio: '',
      regalia: '',
      results: '',
      links: [],
      offerButton: null,
      language: 'ru',
      businessAgreedAt: null // set when the person accepts the business-profile terms (Office)
    }
  },

  // My SI-consultants (server projects), shown in the Office; also the SI-sellers of businesses
  // where I am the assistant (assisting: true — only clients and "Мне написали")
  office: {
    consultants: [],
    currentBusinessId: null   // the business open in the Office (Профиль → «Мои бизнесы»), remembered on this phone
  },

  // Data loaded from the server (js/data.js). null = not loaded yet.
  remote: {
    marketplace: null,       // listed consultant cards
    partners: null,          // [{ id, count }] people with the «SMARTFLOW PARTNER» badge
    niches: null,            // { sections, niches: [{ id, section, name, experts, templates }] } — filters of the Marketplace
    cards: {},               // consultant cards by slug (also unlisted, opened by link)
    profiles: {},            // public profiles by user id
    chats: null,             // my chats with SI-consultants (as a client)
    messages: {},            // { [slug]: { messages, siPaused } }
    clients: {},             // { [projectId]: [...] } my consultants' clients
    inquiries: {},           // { [projectId]: [...] } "Мне написали"
    clientMessages: {},      // { [clientId]: [...] }
    analytics: {},           // { [projectId]: live numbers }
    brain: null,             // my SI-brain materials (only their text is stored)
    myFeedback: null,        // my messages to support with the team's answers
    business: null,          // my business: members, and the businesses I assist
    funnel: {},              // { ["businessId|days"]: { counts, statuses } } Office → Воронка
    peopleChats: null,       // my conversations with people (Chats tab)
    personThreads: {},       // { [userId]: { thread, person, messages, canWrite } }
    businesses: null,        // { businesses: [...], max } — my businesses (up to 3), the main one first
    products: {},            // { [businessId]: [...] } — products of a business
    sellerFunnel: {},        // { ['projectId|days']: { counts } } — the funnel of one AI-продавец
    puzzle: {},              // { [projectId]: { access, items, done, total, notes } } — «пазл» of an SI-продавец
    sellerFunnelLists: {},   // { ['projectId|days|status']: { clients, done } }
    groups: null,            // my group conversations and invitations (Chats tab)
    groupThreads: {},        // { [groupId]: { group, members, messages, pinned, invitedBy } }
    // Communities (tab «Комьюнити»): the catalog, mine, and per community / post
    communities: { catalog: null, mine: null, view: {}, feed: {}, post: {}, waiting: {}, members: {} },
    calendar: {},            // { [businessId | 'own']: { settings, hosts, meetings, role } } Office → Календарь
    funnelLists: {},         // { ["businessId|days|status"]: { clients, done } } portions of 30
    cardReviews: {},         // { [projectId]: { count, average, reviews } } отзывы на карточке
    myReviews: {},           // { [slug]: { canReview, review } } мой отзыв в чате
    projectReviews: {},      // { [projectId]: [reviews] } Офис → Аналитика
    buddyCalendar: {},       // { days | 'YYYY-MM': { from, to, items } } Бадди → календарь
    broadcasts: {},          // { [projectId]: { broadcasts, limits } } Офис → «Рассылки»
    projectLinks: {},        // { [projectId]: { links, max, withoutLink, plainUrl } } ссылки с меткой
    referral: null,          // { url, brought, partner } моё приглашение в SmartFlow
    funnelSteps: {},         // { ["projectId|days"]: { steps, bought, total, stopStepId } } Воронка → «По шагам»
    funnelStepLists: {},     // { ["projectId|days|stepId"]: { clients, done } } portions of 30
    clientCards: {},         // { [clientId]: { funnel_status, last_objection, events } }
    notifications: null,     // { list, unread } unread Buddy messages (the red dot on the Buddy button)
    buddy: null              // { messages, unread, usage } the conversation with Buddy
  },

  // This copy of SmartFlow from the server at sign-in: { env, appLink, features } (see app-info.js)
  app: null,

  // When the support team last pressed "Очистить данные на телефоне" (see setAuth)
  deviceResetSeen: null,

  // Chats that live only in the app
  chats: {
    seen: {},                // { [slug]: lastActivity seen } for unread marks
    hiddenBanners: {},       // { [slug]: true } "Не интересно" on the buy banner
    assistant: [
      { id: 'a-1', sender: 'ai', text: 'Здравствуйте! Это поддержка SmartFlow. Напишите сюда жалобу, предложение или вопрос — передам команде и помогу разобраться.' }
    ]
  }
};

const clone = (value) => JSON.parse(JSON.stringify(value));

// Link that opens this copy's Mini App on a screen: t.me/<bot>/app?startapp=<param>.
// The working bot until the server has told its own (the test copy has another bot).
const DEFAULT_APP_LINK = 'https://t.me/smartflow_ai_support_bot/app';
function appLink(param) {
  const base = window.funnelStore?.data?.app?.appLink || DEFAULT_APP_LINK;
  return param ? `${base}?startapp=${param}` : base;
}
window.SF = window.SF || {};
window.SF.appLink = appLink;
// A risky change switched on for this person (Railway: FEATURES + BETA_USERS)
window.SF.feature = (name) => Boolean(window.funnelStore?.data?.app?.features?.includes(name));

class Store {
  constructor() {
    this.data = this.loadData();
    this.listeners = [];
  }

  loadData() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        // Sections added later get their defaults; every open starts on the Buddy screen.
        const data = { ...clone(defaultData), ...JSON.parse(saved) };
        data.ui = clone(defaultData.ui);
        data.remote = { ...clone(defaultData.remote), ...(data.remote || {}) };
        return data;
      }
    } catch (e) {
      console.warn('Failed to load from localStorage', e);
    }
    return clone(defaultData);
  }

  persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch (e) {
      console.warn('Failed to save to localStorage', e);
    }
  }

  saveData() {
    this.persist();
    this.notify();
  }

  resetToDefault() {
    this.data = clone(defaultData);
    this.saveData();
  }

  subscribe(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  notify() {
    this.listeners.forEach(cb => {
      try {
        cb(this.data);
      } catch (err) {
        console.error('Store listener error:', err);
      }
    });
  }

  // ---------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------
  setAuth(authData) {
    // The support team asked to clear this person's cache: start from a clean state once
    const resetAt = authData.user?.clientResetAt;
    if (resetAt && resetAt !== this.data.deviceResetSeen) {
      const hadSeen = this.data.deviceResetSeen !== null;
      const ui = this.data.ui;
      this.data = clone(defaultData);
      this.data.ui = ui;
      this.data.deviceResetSeen = resetAt;
      if (hadSeen && window.SF && window.SF.showToast) setTimeout(() => window.SF.showToast('Поддержка обновила приложение на этом телефоне'), 500);
    }
    this.data.auth = { status: 'authenticated', internalUserId: authData.user?.id || null, error: null };
    if (authData.app) this.data.app = authData.app;
    if (authData.user) this.applyServerUser(authData.user);
    if (authData.projects?.owned) this.setServerConsultants(authData.projects.owned, authData.projects.assisting || []);
    this.saveData();
  }

  setSessionExpired(err) {
    this.data.auth.status = 'expired';
    this.data.auth.error = err?.message || 'Сессия Telegram Mini App истекла';
    this.saveData();
  }

  setAuthOffline(msg = 'Нет связи с сервером') {
    this.data.auth.status = 'offline';
    this.data.auth.error = msg;
    this.saveData();
  }

  // ---------------------------------------------------------------
  // Navigation (not saved: every open starts on the Buddy screen)
  // ---------------------------------------------------------------
  currentRoute(tab = this.data.ui.tab) {
    const stack = this.data.ui.routes[tab] || [];
    return stack[stack.length - 1] || {};
  }

  setTab(tab) {
    if (this.data.ui.tab === tab) {
      // Tapping the open tab again returns to its first screen
      this.data.ui.routes[tab] = this.data.ui.routes[tab].slice(0, 1);
    }
    this.data.ui.tab = tab;
    this.notify();
  }

  pushRoute(route, tab = this.data.ui.tab) {
    this.data.ui.tab = tab;
    this.data.ui.routes[tab].push(route);
    this.notify();
  }

  // Replace the visible screen's parameters (e.g. the selected sub-tab)
  patchRoute(patch) {
    Object.assign(this.currentRoute(), patch);
    this.notify();
  }

  popRoute() {
    const stack = this.data.ui.routes[this.data.ui.tab];
    if (stack.length > 1) {
      stack.pop();
      this.notify();
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------
  // Me & profile
  // ---------------------------------------------------------------
  applyServerUser(user) {
    const me = this.data.me;
    me.id = user.id || me.id;
    me.displayName = user.displayName || me.displayName;
    me.username = user.username || null;
    me.photoUrl = user.photoUrl || null;
    me.hasUploadedPhoto = Boolean(user.hasUploadedPhoto);
    if (user.supportCode) me.supportCode = user.supportCode;
    if (user.staffRole !== undefined) me.staffRole = user.staffRole;
    if (user.hiddenFromSearch !== undefined) me.hiddenFromSearch = Boolean(user.hiddenFromSearch);
    if (user.profile) me.profile = { ...me.profile, ...user.profile };
  }

  updateProfile(profile) {
    this.data.me.profile = { ...this.data.me.profile, ...profile };
    if (profile.displayName) this.data.me.displayName = profile.displayName;
    this.saveData();
  }

  setMyPhoto(photoUrl) {
    this.data.me.photoUrl = photoUrl;
    this.data.me.hasUploadedPhoto = true;
    this.saveData();
  }

  isBusinessActive() {
    return Boolean(this.data.me.profile.businessAgreedAt);
  }

  // Business profile turned on and not switched to the personal view (Профиль → «Бизнес-профиль»).
  // Only the view: SI-sellers, clients and notifications work the same in the personal view.
  isBusinessView() {
    return (this.isBusinessActive() || this.isAssistant()) && !this.data.me.profile.personalMode;
  }

  // I am the assistant in someone's business: the Office opens without the owner's terms
  isAssistant() {
    return this.data.office.consultants.some(c => c.assisting);
  }

  // ---------------------------------------------------------------
  // Office: my SI-consultants (server projects)
  // ---------------------------------------------------------------
  setServerConsultants(projects, assisting = []) {
    const assisted = assisting.map(p => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      roleTitle: p.role_title || 'SI-консультант',
      photoUrl: p.photo_url || null,
      link: appLink(p.slug),
      assisting: true,
      ownerName: p.owner_name || '',
      businessId: p.business_id || null
    }));
    this.data.office.consultants = projects.map(p => {
      const settings = p.custom_ai_settings || {};
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        roleTitle: p.role_title || 'SI-консультант',
        photoUrl: p.photo_url || null,
        link: appLink(p.slug),
        goal: settings.goal || '',
        instructions: settings.instructions || '',
        methodology: settings.methodology || '',
        clientLimit: settings.clientLimit || 40,
        scenarios: Array.isArray(settings.scenarios) ? settings.scenarios : [],
        steps: Array.isArray(settings.steps) ? settings.steps : [],
        // The niche of the card and its «Вопросы и ответы» (migration 034)
        nicheId: p.niche_id || null,
        faq: Array.isArray(p.faq) ? p.faq : [],
        // The puzzle the buyers of this seller's funnel fill in (the author decides it)
        puzzle: settings.puzzle && Array.isArray(settings.puzzle.pieces) ? settings.puzzle : { pieces: [], release: { mode: 'required' } },
        category: p.category || settings.category || 'sales',
        offer: p.offer || '',
        description: p.description || '',
        priceLabel: p.price_label || '',
        priceMode: p.price_mode || 'fixed',
        ctaKind: p.cta_kind || 'buy',
        ctaLabel: p.cta_label || '',
        paymentUrl: p.payment_url || '',
        accessUrl: p.access_url || '',
        trialDays: Number(p.trial_days) || 0,
        isListed: Boolean(p.is_listed),
        // A ready-made funnel connected to this SI-seller: its name and steps only
        readyFunnel: p.ready_funnel || null,
        // Which of my businesses it belongs to and which product it sells («Бизнес-режим 2.0»)
        businessId: p.business_id || null,
        productId: p.product_id || null
      };
    }).concat(assisted);
  }

  // The business open in the Office (chosen in Профиль, up to 3): the one remembered on this phone if it is
  // still mine, otherwise the main one. null — no business yet.
  currentBusinessId() {
    const list = (this.data.remote.businesses && this.data.remote.businesses.businesses) || [];
    const saved = this.data.office.currentBusinessId;
    if (saved && list.some(b => b.id === saved)) return saved;
    return list.length ? list[0].id : null;
  }

  currentBusiness() {
    const id = this.currentBusinessId();
    const list = (this.data.remote.businesses && this.data.remote.businesses.businesses) || [];
    return list.find(b => b.id === id) || null;
  }

  setCurrentBusiness(businessId) {
    this.data.office.currentBusinessId = businessId;
    this.saveData();
  }

  // My own SI-sellers of the business open in the Office (one without a business — in the main one)
  consultantsOfCurrent() {
    const id = this.currentBusinessId();
    const list = (this.data.remote.businesses && this.data.remote.businesses.businesses) || [];
    const mainId = list.length ? list[0].id : null;
    return this.ownConsultants().filter(c => (c.businessId || mainId) === id || !id);
  }

  // Only my own SI-sellers (without the ones I assist in someone else's business)
  ownConsultants() {
    return this.data.office.consultants.filter(c => !c.assisting);
  }

  findOfficeConsultant(id) {
    return this.data.office.consultants.find(c => c.id === id);
  }

  updateOfficeConsultant(id, patch) {
    const c = this.findOfficeConsultant(id);
    if (!c) return null;
    Object.assign(c, patch);
    this.saveData();
    return c;
  }

  // ---------------------------------------------------------------
  // Server data cache (js/data.js writes here)
  // ---------------------------------------------------------------
  setRemote(path, value) {
    const keys = path.split('.');
    let target = this.data.remote;
    for (const k of keys.slice(0, -1)) {
      if (!target[k]) target[k] = {};
      target = target[k];
    }
    const last = keys[keys.length - 1];
    // Polling returns the same data most of the time: re-render only when something changed
    if (JSON.stringify(target[last]) === JSON.stringify(value)) return;
    target[last] = value;
    this.saveData();
  }

  // ---------------------------------------------------------------
  // Chats
  // ---------------------------------------------------------------
  markChatSeen(slug, lastActivity) {
    if (lastActivity && this.data.chats.seen[slug] !== lastActivity) {
      this.data.chats.seen[slug] = lastActivity;
      this.persist();
    }
  }

  hideBuyBanner(slug) {
    this.data.chats.hiddenBanners[slug] = true;
    this.saveData();
  }

  // unsent: did not reach the server (shown until the support chat is loaded from the server)
  addAssistantMessage(sender, text, { unsent = false } = {}) {
    this.data.chats.assistant.push({ id: `a-${Date.now()}-${sender}`, sender, text, ...(unsent ? { unsent: true } : {}) });
    this.saveData();
  }
}

window.funnelStore = new Store();
