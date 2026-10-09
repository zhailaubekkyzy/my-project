// js/api-client.js - SmartFlow Backend API Client & Session Manager

(function (window) {
  // window.SMARTFLOW_API_BASE is injected by scripts/build-pages.js when the frontend is
  // hosted separately (Cloudflare Pages); otherwise the API is on the same origin.
  const API_BASE = window.SMARTFLOW_API_BASE || (
    window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
      ? window.location.origin
      : '' // Relative in full deployment
  );

  const TOKEN_KEY = 'smartflow_auth_token_v1';
  let sessionToken = localStorage.getItem(TOKEN_KEY) || null;
  let onSessionExpiredCallback = null;

  async function apiFetch(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    if (sessionToken) {
      headers['Authorization'] = `Bearer ${sessionToken}`;
    }

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers
      });

      const contentType = res.headers.get('content-type');
      let data = null;
      if (contentType && contentType.includes('application/json')) {
        data = await res.json();
      } else {
        data = await res.text();
      }

      if (!res.ok) {
        if (res.status === 401) {
          // Session expired or invalid
          console.warn('[SmartFlow API] 401 Unauthorized:', data);
          if (onSessionExpiredCallback) {
            onSessionExpiredCallback(data);
          }
        }
        const error = new Error(data?.message || `HTTP ${res.status}: ${res.statusText}`);
        error.status = res.status;
        error.data = data;
        throw error;
      }

      return data;
    } catch (err) {
      console.warn(`[SmartFlow API] Request failed for ${endpoint}:`, err.message);
      throw err;
    }
  }

  const apiClient = {
    getToken() {
      return sessionToken;
    },

    setToken(token) {
      sessionToken = token;
      if (token) {
        localStorage.setItem(TOKEN_KEY, token);
      } else {
        localStorage.removeItem(TOKEN_KEY);
      }
    },

    clearToken() {
      sessionToken = null;
      localStorage.removeItem(TOKEN_KEY);
    },

    onSessionExpired(callback) {
      onSessionExpiredCallback = callback;
    },

    // Auth endpoints
    async loginWithTelegram(initData, role = 'expert') {
      const res = await apiFetch('/api/auth/telegram', {
        method: 'POST',
        body: JSON.stringify({ initData, role })
      });
      if (res.token) {
        this.setToken(res.token);
      }
      return res;
    },

    async loginDev(role = 'expert', userId = null) {
      const res = await apiFetch('/api/auth/dev-login', {
        method: 'POST',
        body: JSON.stringify({ role, userId })
      });
      if (res.token) {
        this.setToken(res.token);
      }
      return res;
    },

    async getMe() {
      return await apiFetch('/api/auth/me');
    },

    // Projects endpoints
    async getProjects() {
      return await apiFetch('/api/projects');
    },

    async getProject(projectId) {
      return await apiFetch(`/api/projects/${projectId}`);
    },

    async updateProject(projectId, updateData) {
      return await apiFetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        body: JSON.stringify(updateData)
      });
    },

    async getProjectAnalytics(projectId) {
      return await apiFetch(`/api/projects/${projectId}/analytics`);
    },

    // CRM Clients & Messages
    async getClients(projectId) {
      return await apiFetch(`/api/projects/${projectId}/clients`);
    },

    async getMessages(projectId, clientId) {
      return await apiFetch(`/api/projects/${projectId}/conversations/${clientId}/messages`);
    },

    // The expert answers a client personally (SI pauses for this client)
    async sendMessage(projectId, clientId, text) {
      return await apiFetch(`/api/projects/${projectId}/conversations/${clientId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text })
      });
    },

    async setClientSi(projectId, clientId, enabled) {
      return await apiFetch(`/api/projects/${projectId}/clients/${clientId}/si`, {
        method: 'POST',
        body: JSON.stringify({ enabled })
      });
    },

    async getHumanInquiries(projectId) {
      return await apiFetch(`/api/projects/${projectId}/clients/inquiries/list`);
    },

    async resolveInquiry(projectId, inquiryId) {
      return await apiFetch(`/api/projects/${projectId}/clients/inquiries/${inquiryId}/resolve`, {
        method: 'POST'
      });
    },

    // Templates & Subscriptions
    async getTemplates() {
      return await apiFetch('/api/templates');
    },

    async getSubscriptions() {
      return await apiFetch('/api/subscriptions/my');
    },

    async cancelSubscription(subId, reason) {
      return await apiFetch(`/api/subscriptions/${subId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
    },

    // Marketplace and public profiles (no login needed)
    async getMarketplace() {
      return await apiFetch('/api/marketplace');
    },

    async getMarketplaceCard(projectId) {
      return await apiFetch(`/api/marketplace/consultants/${encodeURIComponent(projectId)}`);
    },

    async getPublicProfile(userId) {
      return await apiFetch(`/api/marketplace/profiles/${encodeURIComponent(userId)}`);
    },

    // My chats with SI-consultants (as a client)
    async getMyChats() {
      return await apiFetch('/api/chat');
    },

    async getConsultantBySlug(slug) {
      return await apiFetch(`/api/chat/${encodeURIComponent(slug)}`);
    },

    async getChatMessages(slug) {
      return await apiFetch(`/api/chat/${encodeURIComponent(slug)}/messages`);
    },

    // First visit by the consultant's link: the SI writes first
    async startChat(slug) {
      return await apiFetch(`/api/chat/${encodeURIComponent(slug)}/start`, { method: 'POST' });
    },

    async sendChatMessage(slug, text) {
      return await apiFetch(`/api/chat/${encodeURIComponent(slug)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text })
      });
    },

    async requestHuman(slug, reason) {
      return await apiFetch(`/api/chat/${encodeURIComponent(slug)}/human`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
    },

    async sendFeedback(text) {
      return await apiFetch('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({ text })
      });
    },

    // Profile & photos
    async getMyProfile() {
      return await apiFetch('/api/me/profile');
    },

    async updateMyProfile(profile) {
      return await apiFetch('/api/me/profile', {
        method: 'PUT',
        body: JSON.stringify(profile)
      });
    },

    // image: a Blob (already resized by js/media.js)
    async uploadMyPhoto(image) {
      return await apiFetch('/api/me/photo', {
        method: 'POST',
        headers: { 'Content-Type': image.type || 'image/jpeg' },
        body: image
      });
    },

    async uploadConsultantPhoto(projectId, image) {
      return await apiFetch(`/api/projects/${projectId}/photo`, {
        method: 'POST',
        headers: { 'Content-Type': image.type || 'image/jpeg' },
        body: image
      });
    },

    // ---------- SI-brain ----------
    async getBrainMaterials() {
      return await apiFetch('/api/brain/materials');
    },

    // file: a File/Blob (PDF, .docx, .txt). Pasted text is uploaded as a .txt Blob.
    async uploadBrainMaterial(file, { name, title = '', consultantIds = [] } = {}) {
      const query = new URLSearchParams({ name: name || file.name || 'material.txt', title, consultants: consultantIds.join(',') });
      return await apiFetch(`/api/brain/materials?${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file
      });
    },

    async setMaterialConsultants(materialId, consultantIds) {
      return await apiFetch(`/api/brain/materials/${encodeURIComponent(materialId)}/consultants`, {
        method: 'PUT',
        body: JSON.stringify({ consultantIds })
      });
    },

    async deleteBrainMaterial(materialId) {
      return await apiFetch(`/api/brain/materials/${encodeURIComponent(materialId)}`, { method: 'DELETE' });
    },

    async createProject(data) {
      return await apiFetch('/api/projects', {
        method: 'POST',
        body: JSON.stringify(data)
      });
    },

    // Server paths like /api/media/... live on the API host (Railway), not on the frontend host
    mediaUrl(path) {
      if (!path) return null;
      return path.startsWith('/api/') ? `${API_BASE}${path}` : path;
    },

    isSignedIn() {
      return Boolean(sessionToken);
    },

    async checkHealth() {
      return await apiFetch('/api/health');
    }
  };

  window.smartFlowApi = apiClient;
})(window);
