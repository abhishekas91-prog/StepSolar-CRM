const KEY_TOKEN = 'stepsolar_token';

export function getToken() {
  return localStorage.getItem(KEY_TOKEN);
}

export function setToken(t) {
  if (t) localStorage.setItem(KEY_TOKEN, t);
}

export function clearToken() {
  localStorage.removeItem(KEY_TOKEN);
}

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 2000;

async function request(path, { method = 'GET', body, formData, raw } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload;
  if (formData) {
    payload = formData;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      res = await fetch(`/api${path}`, { method, headers, body: payload });
    } catch (_) {
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_BASE_MS * (attempt + 1)));
        continue;
      }
      throw new Error('Cannot reach the server. Check your connection.');
    }
    // 503 = Render free-tier cold start — retry with backoff
    if (res.status === 503 && attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_BASE_MS * (attempt + 1)));
      continue;
    }
    break;
  }

  if (res.status === 401) {
    clearToken();
    if (!window.location.hash.includes('/login')) {
      window.location.hash = '#/login';
    }
    throw new Error('Session expired — please sign in again.');
  }

  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (typeof j.detail === 'string') msg = j.detail;
      else if (Array.isArray(j.detail)) msg = j.detail.map((d) => d.msg).join('; ');
      else if (j.message) msg = j.message;
    } catch (e) {
      /* keep default */
    }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }

  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  if (raw) return res;
  return res.text();
}

export const api = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  me: () => request('/auth/me'),
  meta: () => request('/crm/meta'),

  leads: (limit = 2000) => request(`/crm/leads?limit=${limit}`),
  getLead: (id) => request(`/crm/leads/${id}`),
  createLead: (data) => request('/crm/leads', { method: 'POST', body: data }),
  updateLead: (id, patch) => request(`/crm/leads/${id}`, { method: 'PATCH', body: patch }),
  deleteLead: (id) => request(`/crm/leads/${id}`, { method: 'DELETE' }),

  users: () => request('/crm/users'),
  assignLead: (id, data) => request(`/crm/leads/${id}/assign`, { method: 'POST', body: data }),
  comments: (id, text) => request(`/crm/leads/${id}/comments`, { method: 'POST', body: { text } }),
  tasks: (id, data) => request(`/crm/leads/${id}/tasks`, { method: 'POST', body: data }),
  patchTask: (id, taskId, data) => request(`/crm/leads/${id}/tasks/${taskId}`, { method: 'PATCH', body: data }),
  deleteTask: (id, taskId) => request(`/crm/leads/${id}/tasks/${taskId}`, { method: 'DELETE' }),

  quotationStatus: (id, status) => request(`/crm/leads/${id}/quotation/status`, { method: 'POST', body: { status } }),
  createInvoice: (id) => request(`/crm/leads/${id}/invoice`, { method: 'POST' }),
  addPayment: (id, data) => request(`/crm/leads/${id}/invoice/payments`, { method: 'POST', body: data }),
  deletePayment: (id, pid) => request(`/crm/leads/${id}/invoice/payments/${pid}`, { method: 'DELETE' }),

  saveSurvey: (id, data) => request(`/crm/leads/${id}/survey`, { method: 'POST', body: data }),
  saveSolar: (id, data) => request(`/crm/leads/${id}/solar`, { method: 'POST', body: data }),
  roi: (data) => request('/crm/solar/roi', { method: 'POST', body: data }),

  inventory: () => request('/crm/inventory'),
  whatsappLogs: () => request('/crm/whatsapp/logs'),
  whatsappConfig: () => request('/crm/whatsapp/config'),
  adminUsers: () => request('/admin/users'),

  uploadDoc: (id, stageKey, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request(`/crm/leads/${id}/stages/${stageKey}/documents`, { method: 'POST', formData: fd });
  },
  deleteDoc: (id, stageKey, docId) => request(`/crm/leads/${id}/stages/${stageKey}/documents/${docId}`, { method: 'DELETE' }),
  docUrl: (id, stageKey, docId) => `/api/crm/leads/${id}/stages/${stageKey}/documents/${docId}`,
};
