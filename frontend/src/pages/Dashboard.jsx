import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { useStore } from '../lib/store';
import { formatLakh, formatNum, timeAgo, formatINR } from '../lib/format';
import { Card, Icon, Badge, Avatar } from '../components/ui';
import { PIPELINE, leadsByMonth, invoiceOutstanding } from '../lib/backend';

const ACTIVITY_ICON = { 'survey.saved': 'survey', 'quotation.updated': 'proposal', 'quotation.status': 'proposal', 'call': 'phone', 'payment.recorded': 'billing', 'invoice.created': 'billing', 'task.created': 'check', 'task.updated': 'check', 'comment.created': 'mail', 'stages.updated': 'refresh', 'lead.created': 'plus', 'lead.updated': 'edit', 'document.uploaded': 'file', 'document.deleted': 'trash', 'assigned': 'users' };

const PIPELINE_COLORS = { sky: '#0ea5e9', violet: '#8b5cf6', teal: '#14b8a6', amber: '#f59e0b', slate: '#94a3b8', green: '#15803d' };

export default function Dashboard() {
  const state = useStore();
  const navigate = useNavigate();
  const [range, setRange] = useState('6m');

  const kpis = useMemo(() => {
    const leads = state.leads;
    const now = new Date();
    const thisMonth = leads.filter((l) => new Date(l.createdAt).getMonth() === now.getMonth() && new Date(l.createdAt).getFullYear() === now.getFullYear()).length;
    const commissioned = leads.filter((l) => l.allCompleted || l.stages.some((s) => s.key === 'commissioned' && s.status === 'Completed')).length;
    const active = leads.filter((l) => !l.allCompleted).length;
    const capacitySold = leads.filter((l) => l.stages.some((s) => s.key === 'commissioned' && s.status === 'Completed')).reduce((a, l) => a + (l.capacity || 0), 0);
    const subsidyPending = leads
      .filter((l) => !l.stages.some((s) => s.key === 'subsidy_disbursed' && s.status === 'Completed'))
      .reduce((a, l) => a + Math.min(78000, Math.round((l.capacity || 0) * 13000)), 0);
    const subsidyPendingCount = leads.filter((l) => !l.stages.some((s) => s.key === 'subsidy_disbursed' && s.status === 'Completed')).length;
    const overdue = leads
      .filter((l) => l.invoice && l.invoice.paymentStatus !== 'Paid')
      .reduce((a, l) => a + invoiceOutstanding(l.invoice), 0);
    const overdueCount = leads.filter((l) => l.invoice && l.invoice.paymentStatus !== 'Paid').length;
    return { totalLeads: leads.length, thisMonth, active, commissioned, capacitySold, subsidyPending, subsidyPendingCount, overdue, overdueCount };
  }, [state.leads]);

  const trend = useMemo(() => leadsByMonth(state.leads, range === '6m' ? 6 : 3), [state.leads, range]);

  const pipelineData = useMemo(() => {
    return PIPELINE.map((s) => ({
      stage: s.label.replace(' Site', '\nSite').replace(' In Progress', '\nIn Progress').replace(' Pending', '\nPending').replace(' Disbursed', '\nDisbursed'),
      value: state.leads.filter((l) => l.currentStageKey === s.key || (l.allCompleted && s.key === 'subsidy_disbursed')).length,
      color: PIPELINE_COLORS[s.color],
    }));
  }, [state.leads]);

  const activity = useMemo(() => {
    const all = [];
    state.leads.forEach((l) =>
      (l.activity || []).forEach((a) => all.push({ ...a, leadName: l.name, leadCode: l.code, leadId: l.id })),
    );
    return all.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 14);
  }, [state.leads]);

  const followUps = useMemo(() => {
    const all = [];
    state.leads.forEach((l) =>
      (l.tasks || []).filter((t) => t.status !== 'done').forEach((t) => all.push({ lead: l, task: t })),
    );
    return all.sort((a, b) => new Date(a.task.due_at || 0) - new Date(b.task.due_at || 0)).slice(0, 6);
  }, [state.leads]);

  if (!state.hydrated) {
    return <div className="empty-state"><strong>Loading your CRM data…</strong></div>;
  }

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
      <div className="kpi-grid">
        <Kpi label="Total Leads" value={formatNum(kpis.totalLeads)} delta={`${kpis.thisMonth} this month`} dir="up" icon="leads" />
        <Kpi label="Active Pipeline" value={formatNum(kpis.active)} delta={`${kpis.commissioned} commissioned`} dir="neutral" icon="inbox" accent="sky" />
        <Kpi label="Capacity Commissioned" value={Math.round(kpis.capacitySold) + ' kW'} delta="cumulative" dir="up" icon="sun" accent="amber" />
        <Kpi label="Active Projects" value={formatNum(kpis.active)} delta="in execution" dir="neutral" icon="project" accent="navy" />
        <Kpi label="Pending Subsidies" value={formatLakh(kpis.subsidyPending)} delta={`${kpis.subsidyPendingCount} cases`} dir="neutral" icon="subsidy" accent="amber" />
        <Kpi label="Outstanding Receivables" value={formatLakh(kpis.overdue)} delta={`${kpis.overdueCount} invoices`} dir="down" icon="billing" accent="crimson" />
      </div>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <Card
          title="Leads Generated"
          subtitle="Monthly intake"
          action={
            <div className="view-toggle">
              {['3m', '6m'].map((r) => (
                <button key={r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>{r.toUpperCase()}</button>
              ))}
            </div>
          }
        >
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12.5 }} />
              <Line type="monotone" dataKey="leads" name="Leads" stroke="#0ea5e9" strokeWidth={2.5} dot={{ r: 3, fill: '#0ea5e9' }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Pipeline by Stage" subtitle="Where every lead sits right now">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={pipelineData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="stage" tick={{ fontSize: 9.5, fill: '#64748b' }} axisLine={false} tickLine={false} interval={0} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12.5 }} cursor={{ fill: 'rgba(22,163,74,0.06)' }} />
              <Bar dataKey="value" name="Leads" radius={[6, 6, 0, 0]}>
                {pipelineData.map((d, i) => (
                  <Cell key={i} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: '1.6fr 1fr' }}>
        <Card title="Live Activity Feed" subtitle="Across every lead in the pipeline" pad={false}>
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {activity.length === 0 && <div className="empty-state"><strong>No activity yet</strong><div>Signals will appear here as your team works the pipeline.</div></div>}
            {activity.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--slate-100)' }}>
                <span className="icon-btn" style={{ borderColor: 'transparent', background: 'var(--green-50)', color: 'var(--green-600)' }}>
                  <Icon name={ACTIVITY_ICON[a.action] || 'check'} size={15} />
                </span>
                <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => navigate(`/leads/${a.leadId}`)}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--slate-800)' }}>{a.detail || a.action}</div>
                  <div style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 1 }}>
                    {a.leadName} · {a.leadCode} {a.user_name ? `· by ${a.user_name}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 11.5, color: 'var(--slate-400)', fontWeight: 600 }}>{timeAgo(a.at)}</div>
                  {a.role && <div style={{ fontSize: 11, color: 'var(--slate-400)' }}>{a.role}</div>}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Card title="Open Follow-ups" subtitle="Next open task per lead">
            {followUps.length === 0 ? (
              <div className="empty-state"><strong>Nothing due</strong><div>Create tasks on a lead to plan follow-ups.</div></div>
            ) : (
              followUps.map(({ lead, task }) => (
                <div key={lead.id + task.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--slate-100)', cursor: 'pointer' }} onClick={() => navigate(`/leads/${lead.id}`)}>
                  <Avatar name={lead.name} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.title}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--slate-500)' }}>{lead.name} · {lead.city}</div>
                  </div>
                  <Badge tone={task.due_at && new Date(task.due_at) < new Date() ? 'crimson' : 'amber'}>
                    {task.due_at ? new Date(task.due_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'No due'}
                  </Badge>
                </div>
              ))
            )}
          </Card>

          <Card title="Top Pipeline Value" subtitle="Largest open quotations">
            {state.leads.filter((l) => l.quotation && l.quotation.status !== 'Rejected').sort((a, b) => (b.quotation?.grandTotal || 0) - (a.quotation?.grandTotal || 0)).slice(0, 5).map((l) => (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--slate-100)', cursor: 'pointer' }} onClick={() => navigate(`/leads/${l.id}`)}>
                <Avatar name={l.name} className="navy" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{l.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--slate-500)' }}>{l.city} · {l.capacity ? l.capacity + ' kW' : '—'}</div>
                </div>
                <strong style={{ fontSize: 12.5 }}>{formatINR(l.quotation.grandTotal)}</strong>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, delta, dir, icon, accent }) {
  return (
    <div className={`kpi ${accent ? 'accent-' + accent : ''}`}>
      <div className="kpi-label">
        <Icon name={icon} size={15} />
        {label}
      </div>
      <div className="kpi-value">{value}</div>
      <div className={`kpi-delta ${dir}`}>
        {dir === 'up' && <Icon name="up" size={12} />}
        {dir === 'down' && <Icon name="down" size={12} />}
        {delta}
      </div>
    </div>
  );
}
