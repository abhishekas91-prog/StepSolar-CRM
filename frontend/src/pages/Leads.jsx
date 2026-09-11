import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, store } from '../lib/store';
import { SOURCES, STATES, CITIES, ROOF_TYPES, PROPERTY_TYPES, TIMELINES, PIPELINE, PIPELINE_MAP, leadCsv } from '../lib/backend';
import { formatDate, relativeDue } from '../lib/format';
import { Card, Icon, Modal, Badge, StageBadge, Avatar, useToast } from '../components/ui';
import WhatsAppChat from '../components/WhatsAppChat';

export default function Leads() {
  const state = useStore();
  const navigate = useNavigate();
  const toast = useToast();

  const [view, setView] = useState('table');
  const [filters, setFilters] = useState({ source: '', state: '', q: '' });
  const [sort, setSort] = useState({ key: 'createdAt', dir: 'desc' });
  const [newLead, setNewLead] = useState(false);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [waLead, setWaLead] = useState(null);

  const filtered = useMemo(() => {
    let list = [...state.leads];
    if (filters.source) list = list.filter((l) => l.source === filters.source);
    if (filters.state) list = list.filter((l) => l.state === filters.state);
    if (filters.q) {
      const q = filters.q.toLowerCase();
      list = list.filter((l) => (l.name || '').toLowerCase().includes(q) || (l.city || '').toLowerCase().includes(q) || (l.phone || '').includes(q) || (l.code || '').toLowerCase().includes(q));
    }
    const dir = sort.dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (sort.key === 'createdAt') return (new Date(a.createdAt) - new Date(b.createdAt)) * dir;
      return String(a[sort.key] || '').localeCompare(String(b[sort.key] || '')) * dir;
    });
    return list;
  }, [state.leads, filters, sort]);

  const byStage = useMemo(() => {
    const map = {};
    PIPELINE.forEach((s) => (map[s.key] = []));
    filtered.forEach((l) => {
      const key = map[l.currentStageKey] ? l.currentStageKey : PIPELINE[0].key;
      map[key].push(l);
    });
    return map;
  }, [filtered]);

  function nextTask(lead) {
    return (lead.tasks || []).filter((t) => t.status !== 'done').sort((a, b) => new Date(a.due_at || 0) - new Date(b.due_at || 0))[0];
  }

  function handleSort(key) {
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  }

  async function createLead() {
    setBusy(true);
    try {
      await store.addLead(draft);
      toast(`Lead ${draft.name} added to pipeline`);
      setNewLead(false);
      setDraft({});
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    const blob = new Blob([leadCsv(filtered)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stepsolar-leads.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${filtered.length} leads`);
  }

  if (!state.hydrated) return <div className="empty-state"><strong>Loading leads…</strong></div>;

  if (state.error && state.leads.length === 0) {
    return (
      <div className="empty-state">
        <strong>Could not load leads</strong>
        <div style={{ marginTop: 6 }}>{state.error}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="filter-bar card" style={{ marginBottom: 16 }}>
        <div className="view-toggle">
          <button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>
            <Icon name="table" size={14} /> Table
          </button>
          <button className={view === 'kanban' ? 'active' : ''} onClick={() => setView('kanban')}>
            <Icon name="project" size={14} /> Kanban
          </button>
        </div>

        <input className="input" placeholder="Search name / code / phone…" style={{ width: 220 }} value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
        <select className="select" style={{ width: 150 }} value={filters.source} onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}>
          <option value="">All Sources</option>
          {SOURCES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className="select" style={{ width: 140 }} value={filters.state} onChange={(e) => setFilters((f) => ({ ...f, state: e.target.value }))}>
          <option value="">All States</option>
          {STATES.map((s) => <option key={s}>{s}</option>)}
        </select>

        {Object.values(filters).filter(Boolean).length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => setFilters({ source: '', state: '', q: '' })}>Clear</button>
        )}

        <div style={{ flex: 1 }} />
        <button className="btn btn-outline btn-sm" onClick={exportCsv}>
          <Icon name="download" size={14} /> Export CSV
        </button>
        <button className="btn btn-primary" onClick={() => setNewLead(true)}>
          <Icon name="plus" size={15} /> New Lead
        </button>
      </div>

      {view === 'table' ? (
        <Card pad={false}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <Th onClick={() => handleSort('name')} sort={sort} k="name">Customer</Th>
                  <Th onClick={() => handleSort('city')} sort={sort} k="city">City / State</Th>
                  <Th onClick={() => handleSort('capacity')} sort={sort} k="capacity">kW</Th>
                  <Th onClick={() => handleSort('source')} sort={sort} k="source">Source</Th>
                  <Th onClick={() => handleSort('owner')} sort={sort} k="owner">Owner</Th>
                  <th>Next Task</th>
                  <Th onClick={() => handleSort('currentStageLabel')} sort={sort} k="currentStageLabel">Stage</Th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
               <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8}>
                      <div className="empty-state" style={{ padding: 36 }}>
                        <strong>{state.leads.length === 0 ? 'No leads yet' : 'No matching leads'}</strong>
                        <div>{state.leads.length === 0 ? 'Create a lead to start the pipeline.' : 'Try clearing search or filters.'}</div>
                      </div>
                    </td>
                  </tr>
                )}
                {filtered.map((l) => {
                  const t = nextTask(l);
                  return (
                    <tr key={l.id} className="clickable" onClick={() => navigate(`/leads/${l.id}`)}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Avatar name={l.name} />
                          <div>
                            <div className="cell-main">{l.name}</div>
                            <div className="cell-sub">{l.code} · {l.phone}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="cell-main">{l.city || '—'}</div>
                        <div className="cell-sub">{l.state || ''}</div>
                      </td>
                      <td>
                        {l.capacity ? <Badge tone="navy">{l.capacity} kW</Badge> : <span style={{ color: 'var(--slate-400)' }}>—</span>}
                      </td>
                      <td>{l.source}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Avatar name={l.owner} className="navy" />
                          <span>{l.owner}</span>
                        </div>
                      </td>
                      <td>
                        {t ? (
                          <>
                            <div className="cell-main">{t.title.length > 22 ? t.title.slice(0, 22) + '…' : t.title}</div>
                            <div className="cell-sub">{t.due_at ? relativeDue(t.due_at) : 'no due date'}</div>
                          </>
                        ) : <span style={{ color: 'var(--slate-400)' }}>—</span>}
                      </td>
                      <td><StageBadge stage={PIPELINE_MAP[l.currentStageKey] || { key: l.currentStageKey, color: 'slate' }} /></td>
                      <td>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                          <ActionBtn title="Call" tone="sky" icon="phone" onClick={() => { window.location.href = `tel:${l.phone}`; }} />
                          <ActionBtn title="WhatsApp" tone="green" icon="whatsapp" onClick={() => setWaLead(l)} />
                          <ActionBtn title="Open" tone="slate" icon="dots" onClick={() => navigate(`/leads/${l.id}`)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <KanbanView byStage={byStage} navigate={navigate} onWhatsApp={setWaLead} />
      )}

      <Modal
        open={newLead}
        onClose={() => setNewLead(false)}
        title="New Lead"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setNewLead(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={createLead} disabled={busy || !draft.name || !draft.phone || !draft.email}>
              {busy ? 'Creating…' : 'Create Lead'}
            </button>
          </>
        }
      >
        <NewLeadForm draft={draft} setDraft={setDraft} />
      </Modal>
      <WhatsAppChat lead={waLead} open={Boolean(waLead)} onClose={() => setWaLead(null)} />
    </div>
  );
}

function Th({ children, onClick, sort, k }) {
  return (
    <th onClick={onClick} className={sort.key === k ? 'sorted' : ''}>
      {children} <span className="sort">{sort.key === k ? (sort.dir === 'desc' ? '↓' : '↑') : '↕'}</span>
    </th>
  );
}

function ActionBtn({ title, icon, tone, onClick }) {
  const color = { sky: 'var(--sky-500)', green: 'var(--green-600)', slate: 'var(--slate-500)' }[tone];
  return (
    <button className="icon-btn" title={title} onClick={onClick} style={{ color }}>
      <Icon name={icon} size={14} />
    </button>
  );
}

function KanbanView({ byStage, navigate, onWhatsApp }) {
  return (
    <div className="kanban">
      {PIPELINE.map((s) => (
        <div key={s.key} className="kanban-col">
          <div className="kanban-col-head">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span className="heat-dot hot" style={{ background: { sky: '#0ea5e9', violet: '#8b5cf6', teal: '#14b8a6', amber: '#f59e0b', slate: '#94a3b8', green: '#15803d' }[s.color] }} />
              {s.label}
            </span>
            <span className="count">{byStage[s.key]?.length || 0}</span>
          </div>
          <div className="kanban-cards">
            {(byStage[s.key] || []).map((l) => (
              <div key={l.id} className="kanban-card" onClick={() => navigate(`/leads/${l.id}`)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--slate-900)' }}>{l.name}</div>
                  <span style={{ fontSize: 10.5, color: 'var(--slate-400)' }}>{l.code}</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--slate-500)', marginBottom: 6 }}>{l.city}, {l.state} · {l.source}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {l.capacity && <Badge tone="navy">{l.capacity} kW</Badge>}
                  <Badge tone="slate" noDot>{l.owner}</Badge>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  <button className="btn btn-sm btn-primary" style={{ flex: 1, padding: '4px 8px', fontSize: 11.5 }} onClick={(e) => { e.stopPropagation(); window.location.href = `tel:${l.phone}`; }}>
                    <Icon name="phone" size={12} /> Call
                  </button>
                  <button className="btn btn-sm btn-whatsapp" style={{ flex: 1, padding: '4px 8px', fontSize: 11.5 }} onClick={(e) => { e.stopPropagation(); onWhatsApp(l); }}>
                    <Icon name="whatsapp" size={12} /> WhatsApp
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function NewLeadForm({ draft, setDraft }) {
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const setNum = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  return (
    <div className="form-grid">
      <div className="field"><label>Full Name <span className="req">*</span></label><input className="input" value={draft.name || ''} onChange={set('name')} placeholder="e.g. Rakesh Prasad" /></div>
      <div className="field"><label>Phone <span className="req">*</span></label><input className="input" value={draft.phone || ''} onChange={set('phone')} placeholder="10-digit mobile" /></div>
      <div className="field"><label>Email <span className="req">*</span></label><input className="input" type="email" value={draft.email || ''} onChange={set('email')} placeholder="email@example.com" /></div>
      <div className="field"><label>State</label>
        <select className="select" value={draft.state || ''} onChange={set('state')}>
          <option value="">Select state</option>
          {STATES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <div className="field"><label>City</label>
        <select className="select" value={draft.city || ''} onChange={set('city')}>
          <option value="">Select city</option>
          {draft.state ? CITIES[draft.state]?.map((c) => <option key={c}>{c}</option>) : <option disabled>Pick a state first</option>}
        </select>
      </div>
      <div className="field"><label>Pincode</label><input className="input" value={draft.pincode || ''} onChange={set('pincode')} placeholder="6-digit" /></div>
      <div className="field"><label>Property Type</label>
        <select className="select" value={draft.propertyType || ''} onChange={set('propertyType')}>
          <option value="">Select</option>
          {PROPERTY_TYPES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <div className="field"><label>Monthly Bill (₹)</label><input className="input" type="number" value={draft.monthlyBill || ''} onChange={setNum('monthlyBill')} placeholder="e.g. 4500" /></div>
      <div className="field"><label>Roof Type</label>
        <select className="select" value={draft.roofType || ''} onChange={set('roofType')}>
          <option value="">Select</option>
          {ROOF_TYPES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <div className="field"><label>Timeline</label>
        <select className="select" value={draft.timeline || ''} onChange={set('timeline')}>
          <option value="">Select</option>
          {TIMELINES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <div className="field"><label>Lead Source</label>
        <select className="select" value={draft.source || ''} onChange={set('source')}>
          <option value="">Select source</option>
          {SOURCES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <div className="field full"><label>Notes</label><textarea className="textarea" value={draft.notes || ''} onChange={set('notes')} placeholder="Requirement notes…" /></div>
    </div>
  );
}
