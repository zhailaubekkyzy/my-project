// data.js - Loads real data from the server into store.data.remote.
// Screens call SF.data.ensure(...) after rendering: a request is made only if the data is
// missing or older than maxAge, and never twice at the same time.

(function (window) {
  const SF = window.SF;
  const inFlight = {};
  const loadedAt = {};

  const store = () => window.funnelStore;
  const api = () => window.smartFlowApi;
  const signedIn = () => api() && api().isSignedIn();

  /**
   * key: cache key; loader: async () => void (writes to the store); maxAgeMs: refresh interval.
   */
  function ensure(key, loader, maxAgeMs = 30000) {
    if (inFlight[key]) return inFlight[key];
    if (loadedAt[key] && Date.now() - loadedAt[key] < maxAgeMs) return Promise.resolve();
    inFlight[key] = Promise.resolve()
      .then(loader)
      // false = skipped (not signed in yet): try again on the next render, after login
      .then(result => { if (result !== false) loadedAt[key] = Date.now(); })
      .catch(err => console.warn(`[SmartFlow data] ${key}:`, err.message))
      .finally(() => { delete inFlight[key]; });
    return inFlight[key];
  }

  function invalidate(prefix) {
    Object.keys(loadedAt).forEach(k => { if (k.startsWith(prefix)) delete loadedAt[k]; });
  }

  // 404 from the server: remember it, so the screen says "не найдено" instead of loading forever
  async function orMissing(key, fn) {
    try {
      return await fn();
    } catch (err) {
      if (err.status === 404) store().setRemote(`missing.${key}`, true);
      else throw err;
    }
  }

  const loaders = {
    marketplace: () => ensure('marketplace', async () => {
      const res = await api().getMarketplace();
      store().setRemote('marketplace', res.consultants || []);
    }),

    // A consultant card opened by link: listed (by project id) or any active one (by slug)
    cardById: (id) => ensure(`card:${id}`, () => orMissing(id, async () => {
      const res = await api().getMarketplaceCard(id);
      store().setRemote(`cards.${res.consultant.slug}`, res.consultant);
    }), 60000),

    cardBySlug: (slug) => ensure(`card:${slug}`, () => orMissing(slug, async () => {
      if (!signedIn()) return false;
      const res = await api().getConsultantBySlug(slug);
      store().setRemote(`cards.${slug}`, res.consultant);
    }), 60000),

    profile: (userId) => ensure(`profile:${userId}`, () => orMissing(userId, async () => {
      const res = await api().getPublicProfile(userId);
      store().setRemote(`profiles.${userId}`, res.profile);
    }), 60000),

    myChats: () => ensure('chats', async () => {
      if (!signedIn()) return false;
      const res = await api().getMyChats();
      store().setRemote('chats', res.chats || []);
    }, 15000),

    chatMessages: (slug, maxAge = 5000) => ensure(`messages:${slug}`, async () => {
      if (!signedIn()) return false;
      const res = await api().getChatMessages(slug);
      store().setRemote(`messages.${slug}`, { messages: res.messages || [], siPaused: Boolean(res.siPaused) });
    }, maxAge),

    // Office: everything about one of my consultants
    clients: (projectId) => ensure(`clients:${projectId}`, async () => {
      if (!signedIn()) return false;
      store().setRemote(`clients.${projectId}`, await api().getClients(projectId));
    }, 15000),

    inquiries: (projectId) => ensure(`inquiries:${projectId}`, async () => {
      if (!signedIn()) return false;
      store().setRemote(`inquiries.${projectId}`, await api().getHumanInquiries(projectId));
    }, 15000),

    allInquiries: () => Promise.all(store().data.office.consultants.map(c => loaders.inquiries(c.id))),

    analytics: (projectId) => ensure(`analytics:${projectId}`, async () => {
      if (!signedIn()) return false;
      const res = await api().getProjectAnalytics(projectId);
      store().setRemote(`analytics.${projectId}`, res.live || {});
    }, 15000),

    clientMessages: (projectId, clientId) => ensure(`clientMessages:${clientId}`, async () => {
      if (!signedIn()) return false;
      store().setRemote(`clientMessages.${clientId}`, await api().getMessages(projectId, clientId));
    }, 5000),

    // SI-brain: my materials and which consultants know them
    brain: () => ensure('brain', async () => {
      if (!signedIn()) return false;
      const res = await api().getBrainMaterials();
      store().setRemote('brain', res.materials || []);
    }, 60000),

    // My messages to support and the team's answers
    myFeedback: (maxAge = 30000) => ensure('myFeedback', async () => {
      if (!signedIn()) return false;
      const res = await api().getMyFeedback();
      store().setRemote('myFeedback', res.feedback || []);
    }, maxAge),

    // My consultants again (after creating or editing one)
    myConsultants: () => ensure('consultants', async () => {
      if (!signedIn()) return false;
      const res = await api().getProjects();
      store().setServerConsultants(res.owned || []);
      store().saveData();
    }, 0)
  };

  // Keeps an open chat fresh (new SI or expert messages) while it is on screen
  let poller = null;
  function poll(key, fn, everyMs = 6000) {
    if (poller && poller.key === key) return;
    stopPolling();
    poller = { key, timer: setInterval(fn, everyMs) };
  }
  function stopPolling() {
    if (poller) clearInterval(poller.timer);
    poller = null;
  }

  // Waiting "Мне написали" requests across all my consultants
  function waitingInquiries(state) {
    return state.office.consultants.flatMap(c =>
      (state.remote.inquiries[c.id] || [])
        .filter(i => i.status === 'waiting')
        .map(i => ({ ...i, consultant: c }))
    );
  }

  // Chats with a new SI/expert message I have not opened yet
  function isUnread(state, chat) {
    const fromOther = /^\[(SI|Эксперт)\]/.test(chat.lastMessage || '');
    return fromOther && state.chats.seen[chat.slug] !== chat.lastActivity;
  }

  const isMissing = (state, key) => Boolean(state.remote.missing && state.remote.missing[key]);

  SF.data = { isMissing, ensure, invalidate, ...loaders, poll, stopPolling, waitingInquiries, isUnread, signedIn };
})(window);
