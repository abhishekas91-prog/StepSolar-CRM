import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore, store } from '../lib/store';
import { formatDate, formatINR, formatDateTime, timeAgo } from '../lib/format';
import { Card, Icon, StageBadge, Avatar, Modal, Badge, useToast } from '../components/ui';
import { PIPELINE_MAP, STAGE_STATUS, invoiceOutstanding } from '../lib/backend';
import { api, getToken } from '../lib/api';
import DocumentPreview from '../components/DocumentPreview';
import WhatsAppChat from '../components/WhatsAppChat';
import {
  COMPANY,
  COMMERCIAL_ITEMS,
  autoFillPrices,
  commercialTotals,
  defaultQuoteItemsForCapacity,
  documentTotals,
  invoiceRecord,
  itemPrice,
  quotationRecord,
  receiptRecord,
} from '../lib/documents';

const TABS = ['Pipeline', 'Overview', 'Field Updates', 'Quotation', 'Invoice', 'Tasks', 'Comments', 'Activity', 'Documents'];
const ACT_ICON = { 'lead.created': 'plus', 'stages.updated': 'refresh', 'quotation.updated': 'proposal', 'quotation.status': 'proposal', 'invoice.created': 'billing', 'payment.recorded': 'billing', 'payment.deleted': 'trash', 'task.created': 'check', 'task.updated': 'check', 'task.deleted': 'trash', 'comment.created': 'mail', 'survey.saved': 'survey', 'solar.saved': 'sun', 'document.uploaded': 'file', 'document.deleted': 'trash', 'assigned': 'users', 'lead.updated': 'edit' };

const STATUS_COLOR = { Pending: 'slate', 'In Progress': 'amber', Completed: 'green' };

export default function LeadProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const state = useStore();
  const [tab, setTab] = useState('Pipeline');

  const lead = state.leads.find((l) => l.id === id);
  const raw = lead;

  if (!state.hydrated) {
    return <div className="empty-state"><strong>Loading lead…</strong></div>;
  }

  if (!raw) {
    return <div className="empty-state"><strong>Lead not found</strong></div>;
  }

  return (
    <div>
      <button className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }} onClick={() => navigate('/leads')}>
        <Icon name="chev" size={14} /> Back to Leads
      </button>

      <Header lead={raw} toast={toast} />

      <div className="tabs" style={{ marginBottom: 18 }}>
        {TABS.map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'Pipeline' && <PipelineTab lead={raw} toast={toast} />}
      {tab === 'Overview' && <OverviewTab lead={raw} toast={toast} />}
      {tab === 'Field Updates' && <FieldUpdatesTab lead={raw} toast={toast} />}
      {tab === 'Quotation' && <QuotationTab lead={raw} toast={toast} />}
      {tab === 'Invoice' && <InvoiceTab lead={raw} toast={toast} />}
      {tab === 'Tasks' && <TasksTab lead={raw} toast={toast} />}
      {tab === 'Comments' && <CommentsTab lead={raw} toast={toast} />}
      {tab === 'Activity' && <ActivityTab lead={raw} />}
      {tab === 'Documents' && <DocumentsTab lead={raw} toast={toast} />}
    </div>
  );
}

function Header({ lead, toast }) {
  const state = useStore();
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignee, setAssignee] = useState(lead.assignedTo || '');
  const [chatOpen, setChatOpen] = useState(false);

  async function assign() {
    try {
      await store.assignLead(lead.id, assignee || null);
      toast(assignee ? `Lead assigned` : 'Lead unassigned');
      setAssignOpen(false);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  const trackUrl = lead.trackingToken ? `${window.location.origin}/track.html?token=${lead.trackingToken}` : null;

  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <Avatar name={lead.name} className="big-avatar" />
        <div style={{ minWidth: 220, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: 19 }}>{lead.name}</h3>
            <StageBadge stage={PIPELINE_MAP[lead.currentStageKey] || { key: lead.currentStageKey, color: 'slate' }} />
            {lead.allCompleted && <Badge tone="green">Won</Badge>}
            <span style={{ fontSize: 12, color: 'var(--slate-400)', fontWeight: 600 }}>{lead.code}</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--slate-500)', marginTop: 4 }}>
            {lead.city}, {lead.state} · {lead.phone} · {lead.email}
          </div>
          <div style={{ marginTop: 8 }}>
            <ProgressLine pct={lead.progressPct} label={`${lead.progressPct}% pipeline complete`} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 14, flex: 1, minWidth: 280 }}>
          <KycItem label="System" value={lead.capacity ? lead.capacity + ' kW' : '—'} icon="sun" />
          <KycItem label="Monthly Bill" value={lead.monthlyBill ? formatINR(lead.monthlyBill) : '—'} icon="billing" />
          <KycItem label="Source" value={lead.source || '—'} icon="link" />
          <KycItem label="Owner" value={lead.owner} icon="users" />
          <KycItem label="Created" value={formatDate(lead.createdAt)} icon="cal" />
          <KycItem label="Timeline" value={lead.timeline || '—'} icon="clock" />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap', borderTop: '1px solid var(--slate-100)', paddingTop: 16 }}>
        <button className="btn btn-outline btn-sm" onClick={() => { window.location.href = `tel:${lead.phone}`; }}><Icon name="phone" size={14} /> Call</button>
        <button className="btn btn-whatsapp btn-sm" onClick={() => setChatOpen(true)}><Icon name="whatsapp" size={14} /> WhatsApp</button>
        {trackUrl && <a className="btn btn-outline btn-sm" href={trackUrl} target="_blank" rel="noreferrer"><Icon name="link" size={14} /> Tracking Portal</a>}
        <button className="btn btn-outline btn-sm" onClick={() => setAssignOpen(true)}><Icon name="users" size={14} /> Assign</button>
        <div style={{ flex: 1 }} />
        {lead.quotation && (
          <button className="btn btn-outline btn-sm" onClick={() => setTab ? null : null}>
            <Badge tone={{ Draft: 'slate', Sent: 'amber', Approved: 'green', Rejected: 'crimson' }[lead.quotation.status] || 'slate'} noDot>
              Quote: {lead.quotation.status}
            </Badge>
          </button>
        )}
        {lead.invoice && (
          <button className="btn btn-outline btn-sm">
            <Badge tone={lead.invoice.paymentStatus === 'Paid' ? 'green' : lead.invoice.paymentStatus === 'Partial' ? 'amber' : 'crimson'} noDot>
              Invoice: {lead.invoice.number} · {lead.invoice.paymentStatus}
            </Badge>
          </button>
        )}
      </div>

      <Modal open={assignOpen} onClose={() => setAssignOpen(false)} title="Assign Lead" footer={
        <>
          <button className="btn btn-outline" onClick={() => { setAssignee(null); assign(); }}>Unassign</button>
          <button className="btn btn-primary" onClick={assign}>Save</button>
        </>
      }>
        <div className="field"><label>Assign to</label>
          <select className="select" value={assignee || ''} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">— Unassigned —</option>
            {state.users.map((u) => <option key={u.id} value={u.id}>{u.full_name} · {u.role}</option>)}
          </select>
        </div>
      </Modal>
      <WhatsAppChat open={chatOpen} onClose={() => setChatOpen(false)} lead={lead} />
    </Card>
  );
}

function ProgressLine({ pct, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, maxWidth: 320 }}>
      <div className="progress" style={{ flex: 1 }}><div className="green" style={{ width: `${pct}%` }} /></div>
      <span style={{ fontSize: 11.5, color: 'var(--slate-500)', fontWeight: 600 }}>{label}</span>
    </div>
  );
}

function PipelineTab({ lead, toast }) {
  const user = useStore().user;
  async function cycle(stage) {
    const next = STAGE_STATUS[(STAGE_STATUS.indexOf(stage.status) + 1) % STAGE_STATUS.length];
    try {
      await store.setStageStatus(lead.id, stage.key, next);
      toast(`${stage.label} → ${next}`);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <Card title="Solar Installation Pipeline" subtitle="Click any stage to advance its status (Pending → In Progress → Completed)" pad={false}>
      <div className="pipeline-wrap">
        {lead.stages.map((s, i) => {
          const isComplete = s.status === 'Completed';
          const isActive = s.status === 'In Progress';
          return (
            <div key={s.key} className="pipeline-step-wrap" onClick={() => cycle(s)}>
              <div className={`pipeline-step ${isComplete ? 'done' : isActive ? 'active' : ''}`}>
                <div className="pipeline-step-no">{isComplete ? <Icon name="check" size={14} /> : i + 1}</div>
                <div className="pipeline-step-label">{s.label}</div>
                <div className="pipeline-step-owner">{s.owner}</div>
                <Badge tone={STATUS_COLOR[s.status]}>{s.status}</Badge>
              </div>
              {i < lead.stages.length - 1 && <div className={`pipeline-connector ${isComplete ? 'done' : ''}`} />}
            </div>
          );
        })}
      </div>
      <div style={{ padding: '10px 20px', fontSize: 12, color: 'var(--slate-500)', borderTop: '1px solid var(--slate-100)' }}>
        Signed in as {user?.full_name} ({user?.role}) — non-admin roles can only edit stages owned by their team.
      </div>
    </Card>
  );
}

function mapsUrl(loc) {
  if (!loc || loc.lat == null || loc.lng == null) return null;
  return `https://www.google.com/maps?q=${loc.lat},${loc.lng}`;
}

function FieldUpdatesTab({ lead, toast }) {
  const stages = lead.stages || [];
  const withField = stages.filter((s) => s.location || s.notes || (s.documents || []).length);
  const gpsCount = stages.filter((s) => s.location && s.location.lat != null).length;
  const notesCount = stages.filter((s) => (s.notes || '').trim()).length;
  const photoCount = stages.reduce((n, s) => n + (s.documents || []).length, 0);

  return (
    <>
      <div className="grid-3" style={{ marginBottom: 18 }}>
        <Card>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--slate-400)' }}>GPS pins</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{gpsCount}</div>
          <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>from field app</div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--slate-400)' }}>Field notes</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{notesCount}</div>
          <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>stages with notes</div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--slate-400)' }}>Proof photos</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{photoCount}</div>
          <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>uploaded from field</div>
        </Card>
      </div>

      <Card title="Field Updates by Stage" subtitle="GPS, notes and proof photos captured by Sales / Ops on the field app">
        {withField.length === 0 ? (
          <div className="empty-state">
            <strong>No field updates yet</strong>
            <div>When a field agent pins GPS, writes notes or uploads a photo, it will show here.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {stages.map((s) => {
              const loc = s.location;
              const docs = s.documents || [];
              const hasLoc = loc && loc.lat != null && loc.lng != null;
              const hasNotes = Boolean((s.notes || '').trim());
              if (!hasLoc && !hasNotes && !docs.length) return null;
              const url = mapsUrl(loc);
              const captured = loc?.capturedAt || s.updatedAt;
              return (
                <div key={s.key} className="card" style={{ padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                    <Badge tone={STATUS_COLOR[s.status] || 'slate'}>{s.label}</Badge>
                    <span style={{ fontSize: 12, color: 'var(--slate-500)' }}>{s.owner}</span>
                    {captured && (
                      <span style={{ fontSize: 11.5, color: 'var(--slate-400)', marginLeft: 'auto' }}>
                        {formatDateTime(captured)}
                      </span>
                    )}
                  </div>

                  {hasLoc && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: hasNotes || docs.length ? 12 : 0 }}>
                      <span className="icon-btn" style={{ borderColor: 'transparent', background: 'var(--sky-50)', color: 'var(--sky-500)' }}>
                        <Icon name="loc" size={14} />
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          {Number(loc.lat).toFixed(6)}, {Number(loc.lng).toFixed(6)}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--slate-500)', marginTop: 2 }}>
                          {loc.accuracy != null ? `Accuracy ±${Math.round(Number(loc.accuracy))} m` : 'GPS pin'}
                          {loc.capturedAt ? ` · ${formatDateTime(loc.capturedAt)}` : ''}
                        </div>
                        {url && (
                          <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 600, marginTop: 6, display: 'inline-block' }}>
                            Open in Google Maps
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  {hasNotes && (
                    <div style={{ background: 'var(--slate-50)', border: '1px solid var(--slate-200)', borderRadius: 8, padding: 12, fontSize: 13, whiteSpace: 'pre-wrap', marginBottom: docs.length ? 12 : 0 }}>
                      {s.notes}
                    </div>
                  )}

                  {docs.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--slate-400)', marginBottom: 8 }}>
                        {docs.length} proof photo{docs.length === 1 ? '' : 's'}
                      </div>
                      {docs.map((d) => (
                        <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid var(--slate-100)' }}>
                          <span className="icon-btn" style={{ borderColor: 'transparent', background: 'var(--sky-50)', color: 'var(--sky-500)' }}>
                            <Icon name="camera" size={14} />
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{d.name}</div>
                            <div style={{ fontSize: 11.5, color: 'var(--slate-400)' }}>
                              {Math.round((d.size || 0) / 1024)} KB · {formatDateTime(d.at)}
                              {d.uploaded_by ? ` · ${d.uploaded_by}` : ''}
                            </div>
                          </div>
                          <SendWhatsAppFile leadId={lead.id} docId={d.id} documentType="photo" documentNo={d.name} toast={toast} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}

function OverviewTab({ lead, toast }) {
  const [surveyOpen, setSurveyOpen] = useState(false);
  const [solarOpen, setSolarOpen] = useState(false);

  return (
    <>
      <div className="grid-3" style={{ gridTemplateColumns: '1.2fr 1fr 1fr' }}>
        <Card title="Customer & Site Details">
          <dl className="kv" style={{ rowGap: 10 }}>
            <dt>Full Name</dt><dd>{lead.name}</dd>
            <dt>Phone</dt><dd>{lead.phone}</dd>
            <dt>Email</dt><dd>{lead.email}</dd>
            <dt>Address</dt><dd>{[lead.city, lead.state, lead.pincode].filter(Boolean).join(', ')}</dd>
            <dt>Property Type</dt><dd>{lead.propertyType || '—'}</dd>
            <dt>Roof Type</dt><dd>{lead.roofType || '—'}</dd>
            <dt>Monthly Bill</dt><dd>{lead.monthlyBill ? formatINR(lead.monthlyBill) : '—'}</dd>
            <dt>Timeline</dt><dd>{lead.timeline || '—'}</dd>
            <dt>Source</dt><dd>{lead.source || '—'}</dd>
          </dl>
        </Card>

        <Card title="Site Survey" action={<button className="btn btn-ghost btn-sm" onClick={() => setSurveyOpen(true)}><Icon name="edit" size={13} /> Edit</button>}>
          {lead.survey ? (
            <dl className="kv" style={{ rowGap: 8 }}>
              <dt>Status</dt><dd><Badge tone={lead.survey.status === 'Completed' ? 'green' : 'amber'}>{lead.survey.status || 'Scheduled'}</Badge></dd>
              {lead.survey.scheduled_at && <><dt>Scheduled</dt><dd>{formatDateTime(lead.survey.scheduled_at)}</dd></>}
              {lead.survey.engineer_name && <><dt>Engineer</dt><dd>{lead.survey.engineer_name}</dd></>}
              {lead.survey.accessible_area_sqft && <><dt>Usable Area</dt><dd>{lead.survey.accessible_area_sqft} sq.ft</dd></>}
              {lead.survey.shadow_analysis && <><dt>Shadow Analysis</dt><dd>{lead.survey.shadow_analysis}</dd></>}
              {lead.survey.recommendations && <><dt>Recommendations</dt><dd>{lead.survey.recommendations}</dd></>}
            </dl>
          ) : <div className="empty-state" style={{ padding: 18 }}><strong>No survey yet</strong><div>Capture roof & electrical audit.</div></div>}
        </Card>

        <Card title="Solar Design" action={<button className="btn btn-ghost btn-sm" onClick={() => setSolarOpen(true)}><Icon name="edit" size={13} /> Edit</button>}>
          {lead.solar ? (
            <dl className="kv" style={{ rowGap: 8 }}>
              <dt>Size</dt><dd>{lead.solar.proposed_size_kw || '—'} kW</dd>
              <dt>Sanctioned Load</dt><dd>{lead.solar.sanctioned_load_kw || '—'} kW</dd>
              <dt>Subsidy Status</dt><dd><Badge tone={lead.solar.subsidy_status === 'Disbursed' ? 'green' : 'amber'}>{lead.solar.subsidy_status || 'Not Applied'}</Badge></dd>
              <dt>Subsidy Amount</dt><dd>{lead.solar.subsidy_amount ? formatINR(lead.solar.subsidy_amount) : '—'}</dd>
              <dt>DISCOM Consumer</dt><dd>{lead.solar.discom_consumer_no || '—'}</dd>
              <dt>Meter Serial</dt><dd>{lead.solar.meter_serial || '—'}</dd>
              <dt>Inverter Serial</dt><dd>{lead.solar.inverter_serial || '—'}</dd>
            </dl>
          ) : <div className="empty-state" style={{ padding: 18 }}><strong>No design yet</strong><div>Add BOQ, size & subsidy details.</div></div>}
        </Card>
      </div>

      {lead.notes && (
        <Card title="Internal Notes" style={{ marginTop: 20 }}>
          <div style={{ background: 'var(--slate-50)', border: '1px solid var(--slate-200)', borderRadius: 8, padding: 12, fontSize: 13, whiteSpace: 'pre-wrap' }}>{lead.notes}</div>
        </Card>
      )}

      <SurveyModal lead={lead} open={surveyOpen} onClose={() => setSurveyOpen(false)} toast={toast} />
      <SolarModal lead={lead} open={solarOpen} onClose={() => setSolarOpen(false)} toast={toast} />
    </>
  );
}

function SurveyModal({ lead, open, onClose, toast }) {
  const s = lead.survey || {};
  const [form, setForm] = useState({});
  useEffect(() => {
    setForm({
      scheduled_at: s.scheduled_at ? s.scheduled_at.slice(0, 16) : '',
      engineer_name: s.engineer_name || '',
      engineer_phone: s.engineer_phone || '',
      address: s.address || '',
      roof_structure: s.roof_structure || '',
      roof_condition: s.roof_condition || '',
      shadow_analysis: s.shadow_analysis || '',
      accessible_area_sqft: s.accessible_area_sqft || '',
      load_assessment: s.load_assessment || '',
      recommendations: s.recommendations || '',
      status: s.status || 'Scheduled',
    });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    const payload = {};
    Object.entries(form).forEach(([k, v]) => {
      if (v !== '' && v !== null) payload[k] = k === 'accessible_area_sqft' ? Number(v) : v;
    });
    try {
      await store.saveSurvey(lead.id, payload);
      toast('Site survey saved');
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Site Survey — ${lead.name}`} wide footer={
      <>
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}><Icon name="check" size={14} /> Save Survey</button>
      </>
    }>
      <div className="form-grid-3">
        <div className="field"><label>Schedule</label><input className="input" type="datetime-local" value={form.scheduled_at} onChange={set('scheduled_at')} /></div>
        <div className="field"><label>Engineer Name</label><input className="input" value={form.engineer_name} onChange={set('engineer_name')} /></div>
        <div className="field"><label>Engineer Phone</label><input className="input" value={form.engineer_phone} onChange={set('engineer_phone')} /></div>
        <div className="field"><label>Roof Structure</label><input className="input" value={form.roof_structure} onChange={set('roof_structure')} /></div>
        <div className="field"><label>Roof Condition</label><input className="input" value={form.roof_condition} onChange={set('roof_condition')} /></div>
        <div className="field"><label>Usable Area (sq.ft)</label><input className="input" type="number" value={form.accessible_area_sqft} onChange={set('accessible_area_sqft')} /></div>
        <div className="field full"><label>Shadow Analysis</label><textarea className="textarea" style={{ minHeight: 54 }} value={form.shadow_analysis} onChange={set('shadow_analysis')} /></div>
        <div className="field full"><label>Load Assessment</label><textarea className="textarea" style={{ minHeight: 54 }} value={form.load_assessment} onChange={set('load_assessment')} /></div>
        <div className="field full"><label>Recommendations</label><textarea className="textarea" style={{ minHeight: 54 }} value={form.recommendations} onChange={set('recommendations')} /></div>
        <div className="field"><label>Status</label>
          <select className="select" value={form.status} onChange={set('status')}>
            {['Scheduled', 'In Progress', 'Completed'].map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>
    </Modal>
  );
}

function SolarModal({ lead, open, onClose, toast }) {
  const so = lead.solar || {};
  const [form, setForm] = useState({});
  useEffect(() => {
    setForm({
      sanctioned_load_kw: so.sanctioned_load_kw || '',
      proposed_size_kw: so.proposed_size_kw || '',
      monthly_bill: so.monthly_bill || lead.monthlyBill || '',
      usable_area_sqft: so.usable_area_sqft || '',
      discom_consumer_no: so.discom_consumer_no || '',
      discom_app_id: so.discom_app_id || '',
      meter_serial: so.meter_serial || '',
      subsidy_status: so.subsidy_status || 'Not Applied',
      subsidy_amount: so.subsidy_amount || '',
      panel_serials: (so.panel_serials || []).join(', '),
      inverter_serial: so.inverter_serial || '',
      structure_type: so.structure_type || '',
      bos_notes: so.bos_notes || '',
    });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    const payload = {};
    Object.entries(form).forEach(([k, v]) => {
      if (v === '') return;
      if (k === 'sanctioned_load_kw' || k === 'proposed_size_kw' || k === 'monthly_bill' || k === 'usable_area_sqft' || k === 'subsidy_amount') payload[k] = Number(v);
      else if (k === 'panel_serials') payload[k] = v.split(',').map((x) => x.trim()).filter(Boolean);
      else payload[k] = v;
    });
    try {
      await store.saveSolar(lead.id, payload);
      toast('Solar design saved');
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Solar Design — ${lead.name}`} wide footer={
      <>
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}><Icon name="check" size={14} /> Save Design</button>
      </>
    }>
      <div className="form-grid-3">
        <div className="field"><label>Sanctioned Load (kW)</label><input className="input" type="number" value={form.sanctioned_load_kw} onChange={set('sanctioned_load_kw')} /></div>
        <div className="field"><label>Proposed Size (kW)</label><input className="input" type="number" value={form.proposed_size_kw} onChange={set('proposed_size_kw')} /></div>
        <div className="field"><label>Monthly Bill (₹)</label><input className="input" type="number" value={form.monthly_bill} onChange={set('monthly_bill')} /></div>
        <div className="field"><label>Usable Area (sq.ft)</label><input className="input" type="number" value={form.usable_area_sqft} onChange={set('usable_area_sqft')} /></div>
        <div className="field"><label>DISCOM Consumer No</label><input className="input" value={form.discom_consumer_no} onChange={set('discom_consumer_no')} /></div>
        <div className="field"><label>DISCOM App ID</label><input className="input" value={form.discom_app_id} onChange={set('discom_app_id')} /></div>
        <div className="field"><label>Meter Serial</label><input className="input" value={form.meter_serial} onChange={set('meter_serial')} /></div>
        <div className="field"><label>Inverter Serial</label><input className="input" value={form.inverter_serial} onChange={set('inverter_serial')} /></div>
        <div className="field"><label>Subsidy Status</label>
          <select className="select" value={form.subsidy_status} onChange={set('subsidy_status')}>
            {['Not Applied', 'Applied', 'Approved', 'Disbursed', 'Rejected'].map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="field"><label>Subsidy Amount (₹)</label><input className="input" type="number" value={form.subsidy_amount} onChange={set('subsidy_amount')} /></div>
        <div className="field"><label>Structure Type</label><input className="input" value={form.structure_type} onChange={set('structure_type')} /></div>
        <div className="field full"><label>Panel Serials (comma-separated)</label><input className="input" value={form.panel_serials} onChange={set('panel_serials')} /></div>
        <div className="field full"><label>BOS Notes</label><textarea className="textarea" style={{ minHeight: 54 }} value={form.bos_notes} onChange={set('bos_notes')} /></div>
      </div>
    </Modal>
  );
}

function QuotationTab({ lead, toast }) {
  const [editOpen, setEditOpen] = useState(false);
  const [preview, setPreview] = useState(false);

  async function setStatus(status) {
    try {
      await store.setQuotationStatus(lead.id, status);
      toast(`Quotation marked ${status}`);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function makeInvoice() {
    try {
      await store.createInvoice(lead.id);
      toast('Invoice generated');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  if (!lead.quotation) {
    return (
      <Card title="Quotation" subtitle="No quotation yet">
        <div className="empty-state" style={{ padding: 30 }}>
          <div className="big"><Icon name="proposal" size={40} /></div>
          <strong>Create a quotation for this lead</strong>
          <div style={{ marginTop: 10 }}><button className="btn btn-primary" onClick={() => setEditOpen(true)}><Icon name="plus" size={15} /> New Quotation</button></div>
        </div>
        <QuoteEditor lead={lead} open={editOpen} onClose={() => setEditOpen(false)} toast={toast} />
      </Card>
    );
  }

  const q = lead.quotation;
  return (
    <div className="grid-2" style={{ gridTemplateColumns: '1.6fr 1fr' }}>
      <Card title={`Quotation ${q.revision > 1 ? `(rev. ${q.revision})` : ''}`} subtitle={`Status: ${q.status}`} pad={false}
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={() => setPreview(true)}><Icon name="file" size={13} /> Preview / Print</button>
            <SendWhatsAppFile leadId={lead.id} documentType={q.kind === 'commercial' ? 'commercial' : 'quotation'} documentNo={q.number || lead.code} toast={toast} />
            <button className="btn btn-outline btn-sm" onClick={() => setEditOpen(true)}><Icon name="edit" size={13} /> Edit Items</button>
          </div>
        }>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Description</th><th>HSN / Spec</th><th>Qty</th><th>Unit</th><th>Price</th><th>GST %</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
            <tbody>
              {(q.items || []).map((it, i) => {
                const price = itemPrice(it);
                const amt = (Number(it.qty) || 0) * price;
                return (
                  <tr key={i}>
                    <td>{it.desc}</td>
                    <td>{it.hsn || '—'}</td>
                    <td>{it.qty}</td>
                    <td>{it.unit || 'Nos'}</td>
                    <td>{formatINR(price)}</td>
                    <td>{it.gst != null ? it.gst : (q.gstPercent || 0)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatINR(it.total || it.amount || amt)}</td>
                  </tr>
                );
              })}
              <tr><td colSpan={6} style={{ textAlign: 'right', color: 'var(--slate-500)' }}>Taxable / Subtotal</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{formatINR(q.subtotal)}</td></tr>
              <tr><td colSpan={6} style={{ textAlign: 'right', color: 'var(--slate-500)' }}>Total GST</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{formatINR(q.gstAmount)}</td></tr>
              <tr><td colSpan={6} style={{ textAlign: 'right', fontWeight: 700 }}>Grand Total</td><td style={{ textAlign: 'right', fontWeight: 800, color: 'var(--green-700)', fontSize: 15 }}>{formatINR(q.grandTotal)}</td></tr>
              {(Number(q.subsidyCentral) > 0 || Number(q.subsidyState) > 0) && (
                <>
                  <tr><td colSpan={6} style={{ textAlign: 'right', color: 'var(--green-700)' }}>Less: Central Subsidy</td><td style={{ textAlign: 'right' }}>{formatINR(q.subsidyCentral)}</td></tr>
                  <tr><td colSpan={6} style={{ textAlign: 'right', color: 'var(--green-700)' }}>Less: State Subsidy</td><td style={{ textAlign: 'right' }}>{formatINR(q.subsidyState)}</td></tr>
                  <tr><td colSpan={6} style={{ textAlign: 'right', fontWeight: 700 }}>Net Payable</td><td style={{ textAlign: 'right', fontWeight: 800, color: 'var(--green-700)' }}>{formatINR(q.netPayable)}</td></tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card title="Workflow">
          <div className="kv" style={{ rowGap: 8 }}>
            <dt>Status</dt><dd><Badge tone={{ Draft: 'slate', Sent: 'amber', Approved: 'green', Rejected: 'crimson' }[q.status]}>{q.status}</Badge></dd>
            <dt>Revision</dt><dd>{q.revision || 1}</dd>
            {q.statusChangedBy && <><dt>Changed By</dt><dd>{q.statusChangedBy}</dd></>}
            {q.statusChangedAt && <><dt>Changed At</dt><dd>{formatDateTime(q.statusChangedAt)}</dd></>}
            <dt>Customer</dt><dd>{lead.name}</dd>
            <dt>Capacity</dt><dd>{lead.capacity ? lead.capacity + ' kW' : '—'}</dd>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            {q.status !== 'Sent' && <button className="btn btn-sm btn-whatsapp" onClick={() => setStatus('Sent')}><Icon name="send" size={13} /> Mark Sent</button>}
            {q.status !== 'Approved' && <button className="btn btn-sm btn-primary" onClick={() => setStatus('Approved')}><Icon name="check" size={13} /> Approve</button>}
            {q.status !== 'Rejected' && <button className="btn btn-sm btn-danger" onClick={() => setStatus('Rejected')}><Icon name="x" size={13} /> Reject</button>}
          </div>
        </Card>

        <Card title="Invoice">
          {lead.invoice ? (
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--green-700)' }}>{formatINR(lead.invoice.grandTotal)}</div>
              <Badge tone={lead.invoice.paymentStatus === 'Paid' ? 'green' : lead.invoice.paymentStatus === 'Partial' ? 'amber' : 'crimson'}>{lead.invoice.paymentStatus}</Badge>
              <div style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 6 }}>{lead.invoice.number}</div>
            </div>
          ) : (
            <div className="empty-state" style={{ padding: 14 }}>
              <strong>No invoice yet</strong>
              <div style={{ marginTop: 8 }}><button className="btn btn-outline btn-sm" onClick={makeInvoice} disabled={q.status !== 'Approved'}><Icon name="billing" size={13} /> Generate Invoice</button></div>
              {q.status !== 'Approved' && <div style={{ fontSize: 11.5, color: 'var(--slate-400)', marginTop: 6 }}>Approve the quotation first</div>}
            </div>
          )}
        </Card>
      </div>

      <QuoteEditor lead={lead} open={editOpen} onClose={() => setEditOpen(false)} toast={toast} />
      <DocumentPreview open={preview} onClose={() => setPreview(false)} record={quotationRecord(lead)} title={`Quotation — ${lead.name}`} leadId={lead.id} documentType={q.kind === 'commercial' ? 'commercial' : 'quotation'} documentNo={q.number || lead.code} />
    </div>
  );
}

function blankItem(gst = 5) {
  return { desc: '', hsn: '', qty: 1, unit: 'Nos', price: 0, gst };
}

function QuoteEditor({ lead, open, onClose, toast }) {
  const q = lead.quotation;
  const [kind, setKind] = useState('quotation');
  const [items, setItems] = useState([]);
  const [custAddress, setCustAddress] = useState('');
  const [subsidyCentral, setSubsidyCentral] = useState(0);
  const [subsidyState, setSubsidyState] = useState(0);
  const [targetGrand, setTargetGrand] = useState('');
  const [capacity, setCapacity] = useState('');
  const [technology, setTechnology] = useState('');
  const [spaceRequired, setSpaceRequired] = useState('');
  const [application, setApplication] = useState('');
  const [ratePerWp, setRatePerWp] = useState('');
  const [commercialGst, setCommercialGst] = useState(8.9);
  const [validity, setValidity] = useState(15);
  const [payAdvance, setPayAdvance] = useState(10);
  const [payDispatch, setPayDispatch] = useState(80);
  const [payInstall, setPayInstall] = useState(10);

  useEffect(() => {
    if (!open) return;
    const nextKind = q?.kind || 'quotation';
    setKind(nextKind);
    const src = (q?.items && q.items.length)
      ? q.items
      : (nextKind === 'commercial' ? COMMERCIAL_ITEMS : defaultQuoteItemsForCapacity(lead.capacity));
    setItems(src.map((it) => ({
      desc: it.desc || '',
      hsn: it.hsn || '',
      qty: Number(it.qty || 1),
      unit: it.unit || 'Nos',
      price: itemPrice(it),
      gst: it.gst != null ? Number(it.gst) : (Number(q?.gstPercent) || 5),
    })));
    setCustAddress(q?.custAddress || [lead.address, lead.city, lead.state].filter(Boolean).join(', '));
    setSubsidyCentral(Number(q?.subsidyCentral || 0));
    setSubsidyState(Number(q?.subsidyState || 0));
    setCapacity(q?.capacity ?? lead.capacity ?? '');
    setTechnology(q?.technology || '');
    setSpaceRequired(q?.spaceRequired || '');
    setApplication(q?.application || '');
    setRatePerWp(q?.rate ?? q?.ratePerWp ?? '');
    setCommercialGst(Number(q?.gstPct ?? q?.gstPercent ?? 8.9));
    setValidity(Number(q?.validity || 15));
    setPayAdvance(Number(q?.payAdvance ?? 10));
    setPayDispatch(Number(q?.payDispatch ?? 80));
    setPayInstall(Number(q?.payInstall ?? 10));
    setTargetGrand('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = documentTotals(items, { subsidyCentral, subsidyState });
  const cTotals = commercialTotals({ capacity, rate: ratePerWp, gstPct: commercialGst });

  function setItem(i, k, v) {
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
  }

  function switchKind(next) {
    setKind(next);
    if (!q?.items?.length) {
      setItems((next === 'commercial' ? COMMERCIAL_ITEMS : defaultQuoteItemsForCapacity(lead.capacity)).map((it) => ({ ...it })));
    }
  }

  async function save() {
    try {
      const payload = {
        kind,
        items: items.filter((it) => it.desc || it.qty),
        custAddress,
        branchAddress: COMPANY.branchAddress,
        branchPhone: COMPANY.branchPhone,
        template: 'invoice.html',
        status: q?.status || 'Draft',
      };
      if (kind === 'commercial') {
        payload.capacity = Number(capacity) || 0;
        payload.technology = technology;
        payload.spaceRequired = spaceRequired;
        payload.application = application;
        payload.rate = Number(ratePerWp) || 0;
        payload.gstPct = Number(commercialGst) || 0;
        payload.gstPercent = Number(commercialGst) || 0;
        payload.validity = String(validity || 15);
        payload.payAdvance = Number(payAdvance) || 0;
        payload.payDispatch = Number(payDispatch) || 0;
        payload.payInstall = Number(payInstall) || 0;
        payload.subtotal = cTotals.subtotal;
        payload.gstAmount = cTotals.gstAmount;
        payload.grandTotal = cTotals.grandTotal;
        payload.netPayable = cTotals.grandTotal;
      } else {
        payload.gstPercent = 0;
        payload.subtotal = totals.subtotal;
        payload.gstAmount = totals.gstAmount;
        payload.grandTotal = totals.grandTotal;
        payload.subsidyCentral = Number(subsidyCentral) || 0;
        payload.subsidyState = Number(subsidyState) || 0;
        payload.netPayable = totals.netPayable;
      }
      await store.saveQuotation(lead.id, payload);
      toast('Quotation saved');
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  const editorPrices = kind !== 'commercial';

  return (
    <Modal open={open} onClose={onClose} title={`Quotation Editor — ${lead.name}`} wide footer={
      <>
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}><Icon name="check" size={14} /> Save Quotation</button>
      </>
    }>
      <div className="form-grid" style={{ marginBottom: 14 }}>
        <div className="field"><label>Document type</label>
          <select className="select" value={kind} onChange={(e) => switchKind(e.target.value)}>
            <option value="quotation">Residential Quotation</option>
            <option value="commercial">Commercial Quotation</option>
          </select>
        </div>
        <div className="field" style={{ gridColumn: '1 / -1' }}><label>Customer Address / Place of Supply</label>
          <input className="input" value={custAddress} onChange={(e) => setCustAddress(e.target.value)} />
        </div>
      </div>

      {kind === 'commercial' && (
        <div className="form-grid" style={{ marginBottom: 14 }}>
          <div className="field"><label>System Capacity (KWp)</label><input className="input" type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} /></div>
          <div className="field"><label>Technology</label><input className="input" value={technology} onChange={(e) => setTechnology(e.target.value)} /></div>
          <div className="field"><label>Space Required</label><input className="input" value={spaceRequired} onChange={(e) => setSpaceRequired(e.target.value)} /></div>
          <div className="field"><label>Application</label><input className="input" value={application} onChange={(e) => setApplication(e.target.value)} /></div>
          <div className="field"><label>Rate per Wp (Rs)</label><input className="input" type="number" value={ratePerWp} onChange={(e) => setRatePerWp(e.target.value)} /></div>
          <div className="field"><label>GST %</label><input className="input" type="number" value={commercialGst} onChange={(e) => setCommercialGst(+e.target.value)} /></div>
          <div className="field"><label>Validity (days)</label><input className="input" type="number" value={validity} onChange={(e) => setValidity(+e.target.value)} /></div>
          <div className="field"><label>Advance %</label><input className="input" type="number" value={payAdvance} onChange={(e) => setPayAdvance(+e.target.value)} /></div>
          <div className="field"><label>Before Dispatch %</label><input className="input" type="number" value={payDispatch} onChange={(e) => setPayDispatch(+e.target.value)} /></div>
          <div className="field"><label>After Installation %</label><input className="input" type="number" value={payInstall} onChange={(e) => setPayInstall(+e.target.value)} /></div>
        </div>
      )}

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Item / Description</th>
              <th>{kind === 'quotation' || kind === 'commercial' ? 'Brand / Spec' : 'HSN/SAC'}</th>
              <th style={{ width: 70 }}>Qty</th>
              <th style={{ width: 80 }}>Unit</th>
              {editorPrices && <th style={{ width: 110 }}>Price/Unit</th>}
              {editorPrices && <th style={{ width: 80 }}>GST %</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td><input className="input" value={it.desc} onChange={(e) => setItem(i, 'desc', e.target.value)} /></td>
                <td><input className="input" value={it.hsn} onChange={(e) => setItem(i, 'hsn', e.target.value)} /></td>
                <td><input className="input" type="number" value={it.qty} onChange={(e) => setItem(i, 'qty', +e.target.value)} /></td>
                <td><input className="input" value={it.unit} onChange={(e) => setItem(i, 'unit', e.target.value)} /></td>
                {editorPrices && <td><input className="input" type="number" value={it.price} onChange={(e) => setItem(i, 'price', +e.target.value)} /></td>}
                {editorPrices && <td><input className="input" type="number" value={it.gst} onChange={(e) => setItem(i, 'gst', +e.target.value)} /></td>}
                <td style={{ textAlign: 'right' }}><button className="icon-btn" onClick={() => setItems((a) => a.filter((_, x) => x !== i))}><Icon name="trash" size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-outline btn-sm" onClick={() => setItems((a) => [...a, blankItem(kind === 'commercial' ? 0 : 5)])}><Icon name="plus" size={13} /> Add item</button>
        {kind === 'quotation' && (
          <>
            <label className="field" style={{ margin: 0 }}>Central subsidy <input className="input" type="number" style={{ width: 110 }} value={subsidyCentral} onChange={(e) => setSubsidyCentral(+e.target.value)} /></label>
            <label className="field" style={{ margin: 0 }}>State subsidy <input className="input" type="number" style={{ width: 110 }} value={subsidyState} onChange={(e) => setSubsidyState(+e.target.value)} /></label>
            <input className="input" type="number" style={{ width: 140 }} placeholder="Target grand total" value={targetGrand} onChange={(e) => setTargetGrand(e.target.value)} />
            <button className="btn btn-outline btn-sm" onClick={() => {
              if (!Number(targetGrand)) return;
              setItems(autoFillPrices(items, Number(targetGrand)));
            }}>Auto-fill prices</button>
          </>
        )}
        <div style={{ flex: 1 }} />
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>{kind === 'commercial' ? 'Gross Total Payable' : 'Grand Total'}</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--green-700)' }}>{formatINR(kind === 'commercial' ? cTotals.grandTotal : totals.netPayable)}</div>
        </div>
      </div>
    </Modal>
  );
}

function InvoiceTab({ lead, toast }) {
  const [payOpen, setPayOpen] = useState(false);
  const [pay, setPay] = useState({ amount: '', mode: 'Online', reference: '', note: '' });
  const [preview, setPreview] = useState(false);
  const [receiptPreview, setReceiptPreview] = useState(null);

  const inv = lead.invoice;
  if (!inv) {
    return <Card title="Invoice" subtitle="No invoice generated for this lead"><div className="empty-state"><strong>No invoice yet</strong><div>Generate one from an approved quotation.</div></div></Card>;
  }
  const payments = Array.isArray(inv.payments) ? inv.payments : [];

  async function record() {
    if (!pay.amount || Number(pay.amount) <= 0) {
      toast('Enter a valid amount', 'error');
      return;
    }
    try {
      await store.recordPayment(lead.id, { amount: Number(pay.amount), mode: pay.mode, reference: pay.reference || null, note: pay.note || null });
      toast(`Payment of ${formatINR(pay.amount)} recorded`);
      setPayOpen(false);
      setPay({ amount: '', mode: 'Online', reference: '', note: '' });
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function removePayment(pid) {
    try {
      await store.removePayment(lead.id, pid);
      toast('Payment removed');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <div className="grid-2" style={{ gridTemplateColumns: '1.6fr 1fr' }}>
      <Card title={`Invoice ${inv.number}`} pad={false} subtitle={`Based on quotation rev. ${inv.basedOnQuotationRevision || '—'}`}
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={() => setPreview(true)}><Icon name="file" size={13} /> Preview / Print</button>
            <SendWhatsAppFile leadId={lead.id} documentType="invoice" documentNo={inv.number} toast={toast} />
          </div>
        }>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Description</th><th>HSN/SAC</th><th>Qty</th><th>Unit</th><th>Price</th><th>GST %</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
            <tbody>
              {(inv.items || []).map((it, i) => {
                const price = itemPrice(it);
                return (
                  <tr key={i}>
                    <td>{it.desc}</td>
                    <td>{it.hsn || '—'}</td>
                    <td>{it.qty}</td>
                    <td>{it.unit || 'Nos'}</td>
                    <td>{formatINR(price)}</td>
                    <td>{it.gst != null ? it.gst : inv.gstPercent}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatINR(it.total || it.amount || it.qty * price)}</td>
                  </tr>
                );
              })}
              <tr><td colSpan={6} style={{ textAlign: 'right', color: 'var(--slate-500)' }}>Taxable / Subtotal</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{formatINR(inv.subtotal)}</td></tr>
              <tr><td colSpan={6} style={{ textAlign: 'right', color: 'var(--slate-500)' }}>Total GST</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{formatINR(inv.gstAmount)}</td></tr>
              <tr><td colSpan={6} style={{ textAlign: 'right', fontWeight: 700 }}>Grand Total</td><td style={{ textAlign: 'right', fontWeight: 800, color: 'var(--green-700)', fontSize: 15 }}>{formatINR(inv.grandTotal)}</td></tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card title="Payment Status">
          <div style={{ textAlign: 'center', padding: '6px 0' }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: inv.paymentStatus === 'Paid' ? 'var(--green-700)' : inv.paymentStatus === 'Partial' ? 'var(--amber-600)' : 'var(--crimson-600)' }}>{formatINR(inv.paidAmount || 0)}</div>
            <Badge tone={inv.paymentStatus === 'Paid' ? 'green' : inv.paymentStatus === 'Partial' ? 'amber' : 'crimson'}>{inv.paymentStatus}</Badge>
            <div style={{ fontSize: 12.5, color: 'var(--slate-500)', marginTop: 8 }}>of {formatINR(inv.grandTotal)} · outstanding {formatINR(invoiceOutstanding(inv))}</div>
            {inv.paymentStatus !== 'Paid' && (
              <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setPayOpen(true)}><Icon name="billing" size={14} /> Record Payment</button>
            )}
          </div>
        </Card>

        <Card title="Payment Ledger" pad={false}>
          {payments.length === 0 ? (
            <div className="empty-state" style={{ padding: 16 }}><strong>No payments yet</strong></div>
          ) : (
            payments.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', borderBottom: '1px solid var(--slate-100)' }}>
                <span className="icon-btn" style={{ borderColor: 'transparent', background: 'var(--green-50)', color: 'var(--green-600)' }}><Icon name="check" size={14} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="cell-main">{formatINR(p.amount)} · {p.mode} {p.reference ? `· ${p.reference}` : ''}</div>
                  <div className="cell-sub">{p.receiptNo} · {formatDateTime(p.at)} · {p.received_by}</div>
                </div>
                <button className="icon-btn" title="Print receipt" onClick={() => setReceiptPreview(p)}><Icon name="file" size={14} /></button>
                <SendWhatsAppFile leadId={lead.id} documentType="receipt" documentNo={p.receiptNo} toast={toast} compact />
                <button className="icon-btn" title="Remove" onClick={() => removePayment(p.id)}><Icon name="trash" size={14} /></button>
              </div>
            ))
          )}
        </Card>
      </div>

      <Modal open={payOpen} onClose={() => setPayOpen(false)} title={`Record Payment — ${inv.number}`} footer={
        <>
          <button className="btn btn-outline" onClick={() => setPayOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={record}><Icon name="check" size={14} /> Record</button>
        </>
      }>
        <div className="card" style={{ padding: 16, marginBottom: 16, background: 'var(--green-50)', borderColor: 'var(--green-100)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>Outstanding</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--green-700)' }}>{formatINR(invoiceOutstanding(inv))}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>Customer</div>
              <div style={{ fontWeight: 700 }}>{lead.name}</div>
            </div>
          </div>
        </div>
        <div className="form-grid">
          <div className="field"><label>Amount (₹) *</label><input className="input" type="number" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></div>
          <div className="field"><label>Mode</label>
            <select className="select" value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}>
              <option>Online</option><option>UPI</option><option>NEFT</option><option>RTGS</option><option>Bank Transfer</option><option>Cheque</option><option>Cash</option>
            </select>
          </div>
          <div className="field"><label>Reference / UTR</label><input className="input" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} placeholder="UTR / txn id" /></div>
          <div className="field"><label>Note</label><input className="input" value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></div>
        </div>
      </Modal>
      <DocumentPreview open={preview} onClose={() => setPreview(false)} record={invoiceRecord(lead)} title={`Invoice ${inv.number}`} leadId={lead.id} documentType="invoice" documentNo={inv.number} />
      <DocumentPreview open={Boolean(receiptPreview)} onClose={() => setReceiptPreview(null)} record={receiptPreview ? receiptRecord(lead, receiptPreview) : null} title={`Receipt ${receiptPreview?.receiptNo || ''}`} leadId={lead.id} documentType="receipt" documentNo={receiptPreview?.receiptNo} />
    </div>
  );
}

function TasksTab({ lead, toast }) {
  const state = useStore();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ title: '', due_at: '', assigned_to: '' });

  async function add() {
    if (!form.title.trim()) return;
    try {
      await store.addTask(lead.id, { title: form.title, due_at: form.due_at || null, assigned_to: form.assigned_to || null });
      toast('Task created');
      setAddOpen(false);
      setForm({ title: '', due_at: '', assigned_to: '' });
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function toggle(task) {
    try {
      await store.updateTask(lead.id, task.id, { status: task.status === 'done' ? 'open' : 'done' });
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function remove(taskId) {
    try {
      await store.removeTask(lead.id, taskId);
      toast('Task removed');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  const open = (lead.tasks || []).filter((t) => t.status !== 'done');
  const done = (lead.tasks || []).filter((t) => t.status === 'done');

  return (
    <Card title={`Tasks (${open.length} open)`} action={<button className="btn btn-primary btn-sm" onClick={() => setAddOpen(true)}><Icon name="plus" size={13} /> New Task</button>}>
      {open.length === 0 && done.length === 0 && <div className="empty-state"><strong>No tasks</strong><div>Break the next steps into tasks with due dates.</div></div>}
      {open.map((t) => (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--slate-100)' }}>
          <input type="checkbox" className="task-check" checked={false} onChange={() => toggle(t)} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t.title}</div>
            <div style={{ fontSize: 11.5, color: 'var(--slate-500)' }}>
              {t.assigned_name || 'Unassigned'}
              {t.due_at && <> · due {formatDate(t.due_at)}</>}
            </div>
          </div>
          <button className="icon-btn" onClick={() => remove(t.id)}><Icon name="trash" size={14} /></button>
        </div>
      ))}
      {done.map((t) => (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--slate-100)', opacity: 0.6 }}>
          <input type="checkbox" className="task-check" checked onChange={() => toggle(t)} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, textDecoration: 'line-through' }}>{t.title}</div>
          </div>
        </div>
      ))}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="New Task" footer={
        <>
          <button className="btn btn-outline" onClick={() => setAddOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={add} disabled={!form.title.trim()}>Create</button>
        </>
      }>
        <div className="form-grid">
          <div className="field full"><label>Title *</label><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Call customer to confirm address" /></div>
          <div className="field"><label>Due Date</label><input className="input" type="date" value={form.due_at} onChange={(e) => setForm({ ...form, due_at: e.target.value })} /></div>
          <div className="field"><label>Assign To</label>
            <select className="select" value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}>
              <option value="">Unassigned</option>
              {state.users.map((u) => <option key={u.id} value={u.id}>{u.full_name} · {u.role}</option>)}
            </select>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

function CommentsTab({ lead, toast }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function post() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await store.addComment(lead.id, text.trim());
      setText('');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={`Comments (${lead.comments.length})`}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a comment…" onKeyDown={(e) => e.key === 'Enter' && post()} />
        <button className="btn btn-primary" onClick={post} disabled={busy || !text.trim()}><Icon name="send" size={14} /> Post</button>
      </div>
      {lead.comments.length === 0 ? (
        <div className="empty-state"><strong>No comments yet</strong></div>
      ) : (
        lead.comments.map((c, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--slate-100)' }}>
            <Avatar name={c.author_name || c.author_id || 'U'} className="navy" />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{c.author_name || c.author_id || 'Team member'}</div>
              <div style={{ fontSize: 13, color: 'var(--slate-700)', marginTop: 2, whiteSpace: 'pre-wrap' }}>{c.text}</div>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--slate-400)', flexShrink: 0 }}>{timeAgo(c.at)}</div>
          </div>
        ))
      )}
    </Card>
  );
}

function ActivityTab({ lead }) {
  const activity = [...(lead.activity || [])].sort((a, b) => new Date(b.at) - new Date(a.at));
  return (
    <Card title="Full Interaction Trail" subtitle="Stage changes, quotes, payments, tasks, documents">
      {activity.length === 0 ? (
        <div className="empty-state"><strong>No activity yet</strong></div>
      ) : (
        <div className="timeline" style={{ marginTop: 18 }}>
          {activity.map((a, i) => (
            <div key={i} className="timeline-item">
              <div className="timeline-title">
                <span className="icon-btn" style={{ marginRight: 8, verticalAlign: 'middle', borderColor: 'transparent', background: 'var(--green-50)', color: 'var(--green-600)' }}>
                  <Icon name={ACT_ICON[a.action] || 'check'} size={13} />
                </span>
                {a.detail || a.action}
              </div>
              <div className="timeline-meta">{formatDateTime(a.at)} · {a.user_name} ({a.role})</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function DocumentsTab({ lead, toast }) {
  const [uploading, setUploading] = useState(null);

  async function upload(stageKey, file) {
    setUploading(stageKey);
    try {
      await store.uploadDoc(lead.id, stageKey, file);
      toast('Document uploaded');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setUploading(null);
    }
  }

  async function download(stageKey, doc) {
    try {
      const token = getToken();
      const res = await fetch(`/api/crm/leads/${lead.id}/stages/${stageKey}/documents/${doc.id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function remove(stageKey, docId) {
    try {
      await store.deleteDoc(lead.id, stageKey, docId);
      toast('Document deleted');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <Card title="Documents by Stage" subtitle="Uploads are stored on the server and gated by role">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {lead.stages.map((s) => {
          const docs = s.documents || [];
          return (
            <div key={s.key} className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: docs.length ? 10 : 0 }}>
                <Badge tone="navy" noDot>{s.label}</Badge>
                <span style={{ fontSize: 11.5, color: 'var(--slate-400)' }}>{docs.length} file{docs.length === 1 ? '' : 's'}</span>
                <div style={{ flex: 1 }} />
                <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>
                  {uploading === s.key ? 'Uploading…' : <><Icon name="download" size={13} /> Upload</>}
                  <input type="file" style={{ display: 'none' }} onChange={(e) => e.target.files[0] && upload(s.key, e.target.files[0])} />
                </label>
              </div>
              {docs.map((d) => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid var(--slate-100)' }}>
                  <span className="icon-btn" style={{ borderColor: 'transparent', background: 'var(--sky-50)', color: 'var(--sky-500)' }}><Icon name="file" size={14} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{d.name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--slate-400)' }}>{Math.round((d.size || 0) / 1024)} KB · {formatDateTime(d.at)}</div>
                  </div>
                  <button className="icon-btn" onClick={() => download(s.key, d)}><Icon name="download" size={14} /></button>
                  <SendWhatsAppFile leadId={lead.id} docId={d.id} documentType="file" documentNo={d.name} toast={toast} compact />
                  <button className="icon-btn" onClick={() => remove(s.key, d.id)}><Icon name="trash" size={14} /></button>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function SendWhatsAppFile({ leadId, docId, documentType = 'document', documentNo = '', toast, compact }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function send(e) {
    e?.stopPropagation?.();
    if (busy || done) return;
    setBusy(true);
    try {
      const out = await api.sendWhatsappDocument(leadId, {
        document_type: documentType,
        document_no: documentNo || '',
        doc_id: docId || undefined,
      });
      if (!out.ok) throw new Error(out.error || 'Send failed');
      setDone(true);
      toast?.('Sent via WhatsApp');
    } catch (err) {
      toast?.(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (compact) {
    return (
      <button className="icon-btn" title={done ? 'Sent' : 'Send via WhatsApp'} onClick={send} disabled={busy || done} style={{ color: 'var(--green-600)' }}>
        <Icon name="whatsapp" size={14} />
      </button>
    );
  }
  return (
    <button className="btn btn-whatsapp btn-sm" onClick={send} disabled={busy || done}>
      <Icon name="whatsapp" size={13} /> {done ? 'Sent' : busy ? 'Sending…' : 'Send via WhatsApp'}
    </button>
  );
}

function KycItem({ label, value, icon }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--slate-400)', display: 'flex', alignItems: 'center', gap: 4 }}>
        <Icon name={icon} size={11} /> {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--slate-800)', marginTop: 2 }}>{value}</div>
    </div>
  );
}
