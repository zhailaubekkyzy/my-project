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

  // My SI-consultants (server projects), shown in the Office
  office: {
    consultants: []
  },

  // Data loaded from the server (js/data.js). null = not loaded yet.
  remote: {
    marketplace: null,       // listed consultant cards
    cards: {},               // consultant cards by slug (also unlisted, opened by link)
    profiles: {},            // public profiles by user id
    chats: null,             // my chats with SI-consultants (as a client)
    messages: {},            // { [slug]: { messages, siPaused } }
    clients: {},             // { [projectId]: [...] } my consultants' clients
    inquiries: {},           // { [projectId]: [...] } "Мне написали"
    clientMessages: {},      // { [clientId]: [...] }
    analytics: {},           // { [projectId]: live numbers }
    brain: null,             // my SI-brain materials (only their text is stored)
    myFeedback: null         // my messages to support with the team's answers
  },

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
    if (authData.user) this.applyServerUser(authData.user);
    if (authData.projects?.owned) this.setServerConsultants(authData.projects.owned);
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

  // ---------------------------------------------------------------
  // Office: my SI-consultants (server projects)
  // ---------------------------------------------------------------
  setServerConsultants(projects) {
    this.data.office.consultants = projects.map(p => {
      const settings = p.custom_ai_settings || {};
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        roleTitle: p.role_title || 'SI-консультант',
        photoUrl: p.photo_url || null,
        link: `https://t.me/smartflow_ai_support_bot/app?startapp=${p.slug}`,
        goal: settings.goal || '',
        instructions: settings.instructions || '',
        clientLimit: settings.clientLimit || 40,
        category: p.category || settings.category || 'sales',
        offer: p.offer || '',
        description: p.description || '',
        priceLabel: p.price_label || '',
        paymentUrl: p.payment_url || '',
        trialDays: Number(p.trial_days) || 0,
        isListed: Boolean(p.is_listed)
      };
    });
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
