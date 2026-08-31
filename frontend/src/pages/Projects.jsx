import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { Card, Icon, Badge, Avatar, Drawer, ProgressBar } from '../components/ui';
import { formatDate, formatINR, timeAgo } from '../lib/format';
import { PIPELINE } from '../lib/backend';

const EXEC_KEYS = new Set(['material_dispatched', 'installation_in_progress', 'net_metering_pending', 'commissioned']);
const COLORS = ['#0ea5e9', '#8b5cf6', '#f59e0b', '#14b8a6', '#e11d48', '#15803d'];

export default function Projects() {
  const state = useStore();
  const navigate = useNavigate();
  const [active, setActive] = useState(null);

  const projects = useMemo(
    () => state.leads.filter((l) => l.stages.some((s) => EXEC_KEYS.has(s.key) && s.status === 'Completed')),
    [state.leads],
  );

  const stats = useMemo(() => {
    const commissioned = projects.filter((l) => l.stages.some((s) => s.key === 'commissioned' && s.status === 'Completed')).length;
    const delayed = projects.filter((l) => {
      const last = [...l.stages].reverse().find((s) => s.status === 'In Progress');
      return last && last.updatedAt && (Date.now() - new Date(last.updatedAt).getTime()) > 10 * 86400000;
    }).length;
    const pipelineValue = projects.reduce((a, l) => a + (l.quotation?.grandTotal || 0), 0);
    return {
      active: projects.length - commissioned,
      total: projects.length,
      commissioned,
      delayed,
      pipelineValue,
    };
  }, [projects]);

  const delayedTasks = useMemo(() => {
    const all = [];
    projects.forEach((l) =>
      (l.tasks || []).forEach((t) => {
        if (t.status === 'done') return;
        if (t.due_at && Date.now() - new Date(t.due_at).getTime() > 0) all.push({ lead: l, task: t });
      }),
    );
    return all.sort((a, b) => new Date(a.task.due_at) - new Date(b.task.due_at)).slice(0, 8);
  }, [projects]);

  const engineerLoad = useMemo(() => {
    const map = {};
    projects.forEach((l) => {
      const eng = l.survey?.engineer_name || l.assignedName || 'Unassigned';
      map[eng] = map[eng] || { count: 0, kw: 0 };
      map[eng].count += 1;
      map[eng].kw += l.capacity || 0;
    });
    return Object.entries(map).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.count - a.count);
  }, [projects]);

  return (
    <div>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <div className="kpi"><div className="kpi-label"><Icon name="project" size={14} /> Projects in Execution</div><div className="kpi-value">{stats.total}</div><div className="kpi-extra">{stats.active} not yet commissioned</div></div>
        <div className="kpi accent-green"><div className="kpi-label"><Icon name="check" size={14} /> Commissioned</div><div className="kpi-value">{stats.commissioned}</div><div className="kpi-extra">COD / handover</div></div>
        <div className="kpi accent-crimson"><div className="kpi-label"><Icon name="alert" size={14} /> At Risk</div><div className="kpi-value">{stats.delayed}</div><div className="kpi-extra">stage stuck 10d+</div></div>
        <div className="kpi accent-amber"><div className="kpi-label"><Icon name="billing" size={14} /> Contract Value</div><div className="kpi-value">{formatINR(stats.pipelineValue)}</div><div className="kpi-extra">approved quotes</div></div>
      </div>

      <Card title="Project Execution Register" subtitle="Leads past Material Dispatch → Commissioning" pad={false}>
        {projects.length === 0 ? (
          <div className="empty-state"><div className="big"><Icon name="project" size={40} /></div><strong>No projects in execution yet</strong><div>Leads move here once Material Dispatch is marked complete in the pipeline.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Lead</th><th>Customer</th><th>Capacity</th><th>Current Stage</th><th>Progress</th><th>Engineer</th><th>Next Due Task</th><th style={{ textAlign: 'right' }}>Open</th></tr></thead>
              <tbody>
                {projects.map((l) => {
                  const exec = l.stages.filter((s) => EXEC_KEYS.has(s.key));
                  const activeStage = [...l.stages].reverse().find((s) => s.status !== 'Completed' && EXEC_KEYS.has(s.key));
                  const nextTask = (l.tasks || []).filter((t) => t.status !== 'done').sort((a, b) => new Date(a.due_at || 0) - new Date(b.due_at || 0))[0];
                  const doneCount = exec.filter((s) => s.status === 'Completed').length;
                  return (
                    <tr key={l.id} className="clickable" onClick={() => navigate(`/leads/${l.id}`)}>
                      <td><span className="cell-main">{l.code}</span><div className="cell-sub">{formatDate(l.createdAt)}</div></td>
                      <td><div className="cell-main">{l.name}</div><div className="cell-sub">{l.city || '—'}</div></td>
                      <td><Badge tone="navy">{l.capacity ? l.capacity + ' kW' : '—'}</Badge></td>
                      <td><Badge tone={activeStage ? 'amber' : 'green'}>{activeStage ? activeStage.label : 'Commissioned'}</Badge></td>
                      <td style={{ minWidth: 130 }}>
                        <ProgressBar pct={Math.round((doneCount / exec.length) * 100)} />
                        <div style={{ fontSize: 10.5, color: 'var(--slate-500)', marginTop: 2 }}>{doneCount}/{exec.length} exec stages</div>
                      </td>
                      <td><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Avatar name={l.survey?.engineer_name || l.assignedName} className="navy" /><span>{l.survey?.engineer_name || l.assignedName || '—'}</span></div></td>
                      <td>
                        {nextTask ? (
                          <div><div className="cell-main" style={{ fontSize: 12 }}>{nextTask.title}</div><div className="cell-sub">{timeAgo(nextTask.due_at)}</div></div>
                        ) : <span style={{ color: 'var(--slate-400)' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-sm btn-outline" onClick={(e) => { e.stopPropagation(); setActive(l); }}><Icon name="chev" size={13} /> Details</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid-3" style={{ marginTop: 20 }}>
        <Card title="At-Risk / Overdue Tasks" pad={false}>
          {delayedTasks.length === 0 ? (
            <div className="empty-state" style={{ padding: 24 }}><strong>Nothing overdue</strong></div>
          ) : delayedTasks.map(({ lead, task }, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '12px 20px', borderBottom: '1px solid var(--slate-100)', alignItems: 'center' }}>
              <span className="badge badge-crimson"><Icon name="alert" size={11} /> Overdue</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{task.title}</div>
                <div style={{ fontSize: 11.5, color: 'var(--slate-500)' }}>{lead.name} · {lead.code}</div>
              </div>
              <button className="btn btn-sm btn-outline" onClick={() => navigate(`/leads/${lead.id}`)}>View</button>
            </div>
          ))}
        </Card>

        <Card title="Engineer Workload">
          {engineerLoad.map((e) => (
            <div key={e.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0' }}>
              <Avatar name={e.name} className="navy" />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{e.name}</div>
                <div style={{ fontSize: 11, color: 'var(--slate-500)' }}>{e.count} project{e.count === 1 ? '' : 's'} · {Math.round(e.kw)} kW</div>
              </div>
              <Badge tone={e.count > 3 ? 'amber' : 'green'}>{e.count}</Badge>
            </div>
          ))}
        </Card>

        <Card title="Execution Pipeline" pad={false}>
          {PIPELINE.filter((s) => EXEC_KEYS.has(s.key)).map((s, i) => (
            <div key={s.key} style={{ padding: '11px 20px', borderBottom: '1px solid var(--slate-100)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: COLORS[i % COLORS.length] }} />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{s.label}</span>
              <Badge tone="slate">{projects.filter((l) => l.stages.some((x) => x.key === s.key && x.status === 'Completed')).length}</Badge>
            </div>
          ))}
        </Card>
      </div>

      <Drawer open={Boolean(active)} onClose={() => setActive(null)} title={`Project · ${active?.code || ''}`}>
        {active && (
          <div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              <Badge tone="navy">{active.capacity ? active.capacity + ' kW' : '—'}</Badge>
              <Badge tone="green">{active.progressPct}% pipeline complete</Badge>
              <Badge tone={active.allCompleted ? 'green' : 'amber'}>{active.currentStageLabel}</Badge>
            </div>
            <div className="card" style={{ padding: 16, marginBottom: 16 }}>
              <div className="kv">
                <dt>Customer</dt><dd>{active.name}</dd>
                <dt>Phone</dt><dd>{active.phone}</dd>
                <dt>City</dt><dd>{active.city || '—'}</dd>
                <dt>Contract</dt><dd>{active.quotation ? formatINR(active.quotation.grandTotal) : '—'}</dd>
                <dt>Owner</dt><dd>{active.assignedName || '—'}</dd>
              </div>
            </div>
            <div className="card" style={{ padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--slate-400)', marginBottom: 10 }}>Execution Stages</div>
              {active.stages.filter((s) => EXEC_KEYS.has(s.key)).map((s) => (
                <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                  <Icon name={s.status === 'Completed' ? 'check' : 'clock'} size={14} style={{ color: s.status === 'Completed' ? 'var(--green-600)' : 'var(--slate-400)' }} />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{s.label}</span>
                  <Badge tone={s.status === 'Completed' ? 'green' : s.status === 'In Progress' ? 'amber' : 'slate'}>{s.status}</Badge>
                </div>
              ))}
            </div>
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => { navigate(`/leads/${active.id}`); }}>
              <Icon name="chev" size={14} /> Open Lead for Full Details
            </button>
          </div>
        )}
      </Drawer>
    </div>
  );
}
