import { useSyncExternalStore } from 'react';
import { api, getToken, setToken, clearToken } from './api';
import { mapLead, toLeadCreate } from './backend';

const KEY_USER = 'stepsolar_user';

function loadUser() {
  try {
    const raw = localStorage.getItem(KEY_USER);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

let state = { user: loadUser(), leads: [], users: [], loading: false, hydrated: false, error: null };
const listeners = new Set();
let pollTimer = null;

function emit() {
  listeners.forEach((l) => l());
}

function setState(patch) {
  state = { ...state, ...patch };
  emit();
}

function subscribe(l) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getSnapshot() {
  return state;
}

export function useStore() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useAuth() {
  return state.user;
}

export async function refreshLeads() {
  try {
    const raw = await api.leads();
    const leads = raw.map(mapLead).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    setState({ leads, hydrated: true, error: null });
  } catch (e) {
    setState({ hydrated: true, error: e.message });
  }
}

export async function refreshUsers() {
  try {
    const users = await api.users();
    setState({ users });
  } catch (e) {
    /* non-fatal */
  }
}

export async function hydrate() {
  if (!getToken()) return;
  setState({ loading: true });
  await Promise.all([refreshLeads(), refreshUsers()]);
  setState({ loading: false });
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refreshLeads, 30000);
}

export async function login(email, password) {
  const res = await api.login(email, password);
  setToken(res.access_token);
  const user = { id: res.id, email: res.email, full_name: res.full_name, role: res.role };
  localStorage.setItem(KEY_USER, JSON.stringify(user));
  setState({ user });
  await hydrate();
  return user;
}

export function logout() {
  clearToken();
  localStorage.removeItem(KEY_USER);
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  setState({ user: null, leads: [], users: [], hydrated: false, error: null });
}

async function after(fn) {
  await fn();
  await refreshLeads();
}

export const store = {
  async addLead(draft) {
    await api.createLead(toLeadCreate(draft));
    await refreshLeads();
  },

  async updateLead(id, patch) {
    await api.updateLead(id, patch);
    await refreshLeads();
  },

  async setLeadStage(id, stageKey) {
    const lead = state.leads.find((l) => l.id === id);
    if (!lead) return;
    const stages = lead.stages.map((s) =>
      s.key === stageKey
        ? { ...s, status: 'Completed', updatedAt: new Date().toISOString(), notes: s.notes || '' }
        : s,
    );
    await api.updateLead(id, { stages });
    await refreshLeads();
  },

  async setStageStatus(id, stageKey, status) {
    const lead = state.leads.find((l) => l.id === id);
    if (!lead) return;
    const stages = lead.stages.map((s) =>
      s.key === stageKey ? { ...s, status, updatedAt: new Date().toISOString(), notes: s.notes || '' } : s,
    );
    await api.updateLead(id, { stages });
    await refreshLeads();
  },

  async assignLead(id, assignedTo) {
    await api.assignLead(id, { assigned_to: assignedTo });
    await refreshLeads();
  },

  async addComment(id, text) {
    await after(() => api.comments(id, text));
  },

  async addTask(id, data) {
    await after(() => api.tasks(id, data));
  },

  async updateTask(id, taskId, patch) {
    await after(() => api.patchTask(id, taskId, patch));
  },

  async removeTask(id, taskId) {
    await after(() => api.deleteTask(id, taskId));
  },

  async saveQuotation(id, quotation) {
    await api.updateLead(id, { quotation });
    await refreshLeads();
  },

  async setQuotationStatus(id, status) {
    await after(() => api.quotationStatus(id, status));
  },

  async createInvoice(id) {
    await after(() => api.createInvoice(id));
  },

  async recordPayment(id, data) {
    await after(() => api.addPayment(id, data));
  },

  async removePayment(id, paymentId) {
    await after(() => api.deletePayment(id, paymentId));
  },

  async saveSurvey(id, survey) {
    await after(() => api.saveSurvey(id, survey));
  },

  async saveSolar(id, solar) {
    await after(() => api.saveSolar(id, solar));
  },

  async uploadDoc(id, stageKey, file) {
    await after(() => api.uploadDoc(id, stageKey, file));
  },

  async deleteDoc(id, stageKey, docId) {
    await after(() => api.deleteDoc(id, stageKey, docId));
  },

  async convertToProject() {
    throw new Error('Projects are derived from the solar pipeline automatically.');
  },
};

export function resetStore() {
  logout();
}
