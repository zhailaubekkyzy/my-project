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

    // Conversations with people (Chats tab) and one conversation
    peopleChats: (maxAge = 15000) => ensure('peopleChats', async () => {
      if (!signedIn()) return false;
      store().setRemote('peopleChats', (await api().getPeopleChats()).chats || []);
    }, maxAge),

    personMessages: (userId, maxAge = 5000) => ensure(`person:${userId}`, () => orMissing(`person:${userId}`, async () => {
      if (!signedIn()) return false;
      store().setRemote(`personThreads.${userId}`, await api().getPersonMessages(userId));
    }), maxAge),

    chatMessages: (slug, maxAge = 5000) => ensure(`messages:${slug}`, async () => {
      if (!signedIn()) return false;
      const res = await api().getChatMessages(slug);
      store().setRemote(`messages.${slug}`, {
        messages: res.messages || [],
        siPaused: Boolean(res.siPaused),
        contactShared: Boolean(res.contactShared),
        broadcastsOff: Boolean(res.broadcastsOff),
        altOffers: res.altOffers || [],
        tools: res.tools || { contact: false, receipt: false }
      });
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

    // Office → Воронка: counts per status (counted by the server on request). days: '7' | '30' | 'all'
    funnel: (businessId, days) => ensure(`funnel:${businessId}|${days}`, async () => {
      if (!signedIn()) return false;
      const res = await api().getFunnel({ businessId, days: days === 'all' ? '' : days });
      store().setRemote(`funnel.${businessId}|${days}`, { counts: res.counts || {}, statuses: res.statuses || {} });
    }, 15000),

    // The first 30 clients of one status (more by "Показать ещё")
    funnelList: (businessId, days, status) => ensure(`funnelList:${businessId}|${days}|${status}`, async () => {
      if (!signedIn()) return false;
      const res = await api().getFunnel({ businessId, days: days === 'all' ? '' : days, status });
      const clients = res.clients || [];
      store().setRemote(`funnelLists.${businessId}|${days}|${status}`, { clients, done: clients.length < (res.pageSize || 30) });
    }, 15000),

    // Office → Воронка → «По шагам»: one SI-seller, and the first 30 clients of one step
    funnelSteps: (projectId, days) => ensure(`funnelSteps:${projectId}|${days}`, async () => {
      if (!signedIn()) return false;
      const res = await api().getFunnelSteps({ projectId, days: days === 'all' ? '' : days });
      store().setRemote(`funnelSteps.${projectId}|${days}`, { steps: res.steps || [], bought: res.bought || 0, total: res.total || 0, stopStepId: res.stopStepId || null });
    }, 15000),

    funnelStepList: (projectId, days, stepId) => ensure(`funnelStepList:${projectId}|${days}|${stepId}`, async () => {
      if (!signedIn()) return false;
      const res = await api().getFunnelSteps({ projectId, days: days === 'all' ? '' : days, step: stepId });
      const clients = res.clients || [];
      store().setRemote(`funnelStepLists.${projectId}|${days}|${stepId}`, { clients, done: clients.length < (res.pageSize || 30) });
    }, 15000),

    // Office → Календарь. key: business id, or 'own' (the owner's business is created when needed)
    calendar: (key) => ensure(`calendar:${key}`, async () => {
      if (!signedIn()) return false;
      store().setRemote(`calendar.${key}`, await api().getCalendar(key === 'own' ? '' : key));
    }, 30000),

    // A client card in the Office: funnel status and the event journal
    clientCard: (projectId, clientId) => ensure(`clientCard:${clientId}`, async () => {
      if (!signedIn()) return false;
      store().setRemote(`clientCards.${clientId}`, await api().getClient(projectId, clientId));
    }, 15000),

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

    // Buddy: my notifications (the bot sends the same to Telegram)
    notifications: (maxAge = 15000) => ensure('notifications', async () => {
      if (!signedIn()) return false;
      const res = await api().getNotifications();
      store().setRemote('notifications', { list: res.notifications || [], unread: Number(res.unread) || 0 });
    }, maxAge),

    // The conversation with Buddy; also keeps the red dot on the Buddy button fresh
    buddy: (maxAge = 15000) => ensure('buddy', async () => {
      if (!signedIn()) return false;
      const res = await api().getBuddyMessages();
      store().setRemote('buddy', { messages: res.messages || [], unread: Number(res.unread) || 0, usage: res.usage || null });
      store().setRemote('notifications', { list: [], unread: Number(res.unread) || 0 });
    }, maxAge),

    // Reviews: on a card (public), mine in a chat, all of my SI-seller in the Office
    cardReviews: (projectId) => ensure(`cardReviews:${projectId}`, async () => {
      store().setRemote(`cardReviews.${projectId}`, await api().getCardReviews(projectId));
    }, 60000),

    myReview: (slug) => ensure(`myReview:${slug}`, async () => {
      if (!signedIn()) return false;
      store().setRemote(`myReviews.${slug}`, await api().getMyReview(slug));
    }, 30000),

    projectReviews: (projectId) => ensure(`projectReviews:${projectId}`, async () => {
      if (!signedIn()) return false;
      const res = await api().getProjectReviews(projectId);
      store().setRemote(`projectReviews.${projectId}`, res.reviews || []);
    }, 30000),
    // Buddy's calendar for a period. key: 'days' (today + 2 days) or 'YYYY-MM' (a month); from/to: ISO
    buddyCalendar: (key, from, to, maxAge = 30000) => ensure(`buddyCalendar:${key}`, async () => {
      if (!signedIn()) return false;
      const res = await api().getBuddyCalendar(from, to);
      store().setRemote(`buddyCalendar.${key}`, { from, to, items: res.items || [] });
    }, maxAge),

    // Broadcasts of an SI-seller: history and limits
    broadcasts: (projectId) => ensure(`broadcasts:${projectId}`, async () => {
      if (!signedIn()) return false;
      store().setRemote(`broadcasts.${projectId}`, await api().getBroadcasts(projectId));
    }, 15000),

    // Links with a source of one SI-seller; my invitation link and how many people came from me
    projectLinks: (projectId) => ensure(`projectLinks:${projectId}`, async () => {
      if (!signedIn()) return false;
      store().setRemote(`projectLinks.${projectId}`, await api().getProjectLinks(projectId));
    }, 30000),

    referral: () => ensure('referral', async () => {
      if (!signedIn()) return false;
      store().setRemote('referral', await api().getReferral());
    }, 60000),

    // My business: owner + assistant
    business: () => ensure('business', async () => {
      if (!signedIn()) return false;
      store().setRemote('business', await api().getBusiness());
    }, 30000),

    // My consultants and the ones I assist, refreshed once a minute while the Office is open
    officeLists: () => ensure('officeLists', async () => {
      if (!signedIn()) return false;
      const res = await api().getProjects();
      store().setServerConsultants(res.owned || [], res.assisting || []);
      store().saveData();
    }, 60000),

    // My consultants again (after creating or editing one)
    myConsultants: () => ensure('consultants', async () => {
      if (!signedIn()) return false;
      const res = await api().getProjects();
      store().setServerConsultants(res.owned || [], res.assisting || []);
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
    const fromOther = /^\[(SI|Эксперт|Помощник)\]/.test(chat.lastMessage || '');
    return fromOther && state.chats.seen[chat.slug] !== chat.lastActivity;
  }

  const isMissing = (state, key) => Boolean(state.remote.missing && state.remote.missing[key]);

  SF.data = { isMissing, ensure, invalidate, ...loaders, poll, stopPolling, waitingInquiries, isUnread, signedIn };
})(window);
