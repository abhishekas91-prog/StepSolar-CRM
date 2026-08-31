import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { Card, Icon, Badge, Avatar, Drawer } from '../components/ui';
import { formatDate, timeAgo } from '../lib/format';

export default function ServiceDesk() {
  const state = useStore();
  const navigate = useNavigate();
  const [tone, setTone] = useState('open');
  const [active, setActive] = useState(null);

  const tickets = useMemo(() => {
    const out = [];
    state.leads.forEach((l) =>
      (l.tasks || []).forEach((t) => out.push({ lead: l, task: t })),
    );
    const sorted = out.sort((a, b) => new Date(b.task.created_at || 0) - new Date(a.task.created_at || 0));
    return tone === 'all' ? sorted : sorted.filter((x) => (tone === 'done' ? x.task.status === 'done' : x.task.status !== 'done'));
  }, [state.leads, tone]);

  const stats = useMemo(() => {
    const open = tickets.filter((t) => t.task.status !== 'done');
    const overdue = open.filter((t) => t.task.due_at && Date.now() - new Date(t.task.due_at).getTime() > 0);
    const resolved30 = tickets.filter((t) => t.task.status === 'done' && t.task.completed_at && Date.now() - new Date(t.task.completed_at).getTime() < 30 * 86400000);
    return { open: open.length, overdue: overdue.length, resolved30: resolved30.length };
  }, [tickets]);

  const feed = useMemo(() => {
    const rows = [];
    state.leads.forEach((l) => {
      (l.activity || []).slice(0, 4).forEach((a) => rows.push({ lead: l, at: a.at || a.created_at, text: a.detail || a.message || a.action, type: 'activity' }));
      (l.comments || []).slice(0, 2).forEach((c) => rows.push({ lead: l, at: c.at || c.created_at, text: c.text, type: 'comment', author: c.user_name || c.created_by_name || '—' }));
    });
    return rows.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0)).slice(0, 12);
  }, [state.leads]);

  return (
    <div>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <div className="kpi"><div className="kpi-label"><Icon name="service" size={14} /> Open Tasks</div><div className="kpi-value">{stats.open}</div><div className="kpi-extra">across all leads</div></div>
        <div className="kpi accent-crimson"><div className="kpi-label"><Icon name="alert" size={14} /> Overdue</div><div className="kpi-value">{stats.overdue}</div><div className="kpi-extra">past due date</div></div>
        <div className="kpi accent-green"><div className="kpi-label"><Icon name="check" size={14} /> Resolved (30d)</div><div className="kpi-value">{stats.resolved30}</div><div className="kpi-extra">completed recently</div></div>
        <div className="kpi accent-navy"><div className="kpi-label"><Icon name="users" size={14} /> Total</div><div className="kpi-value">{tickets.length}</div><div className="kpi-extra">tasks in CRM</div></div>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: '1.6fr 1fr' }}>
        <Card title="Service Desk"
          subtitle="Tasks represent field & follow-up work on leads — install, AMC, DTR check, complaint follow-up"
          action={
            <select className="select" style={{ width: 120 }} value={tone} onChange={(e) => setTone(e.target.value)}>
              <option value="open">Open</option>
              <option value="done">Resolved</option>
              <option value="all">All</option>
            </select>
          }
          pad={false}
        >
          {tickets.length === 0 ? (
            <div className="empty-state"><div className="big"><Icon name="service" size={40} /></div><strong>No tasks found</strong><div>Add a task from a lead page to track service work here.</div></div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Task</th><th>Lead</th><th>Assignee</th><th>Due</th><th>Status</th><th style={{ textAlign: 'right' }}>Open</th></tr></thead>
                <tbody>
                  {tickets.slice(0, 30).map(({ lead, task }) => {
                    const overdue = task.status !== 'done' && task.due_at && Date.now() - new Date(task.due_at).getTime() > 0;
                    return (
                      <tr key={task.id} className="clickable" onClick={() => setActive({ lead, task })}>
                        <td><span className="cell-main">{task.title}</span><div className="cell-sub">{formatDate(task.created_at)}</div></td>
                        <td><div className="cell-main">{lead.name}</div><div className="cell-sub">{lead.code}</div></td>
                        <td>{task.assigned_name || task.assigned_to || '—'}</td>
                        <td>{task.due_at ? <span style={{ color: overdue ? 'var(--crimson-600)' : 'var(--slate-600)' }}>{formatDate(task.due_at)}</span> : '—'}</td>
                        <td>{overdue ? <Badge tone="crimson">Overdue</Badge> : <Badge tone={task.status === 'done' ? 'green' : 'amber'}>{task.status === 'done' ? 'Done' : 'Open'}</Badge>}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="btn btn-sm btn-outline" onClick={(e) => { e.stopPropagation(); setActive({ lead, task }); }}><Icon name="chev" size={13} /> Details</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Recent Activity" subtitle="Comments & actions across leads" pad={false}>
          {feed.length === 0 ? (
            <div className="empty-state" style={{ padding: 24 }}><strong>No activity yet</strong><div>Comments and stage actions will appear here.</div></div>
          ) : feed.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '11px 20px', borderBottom: '1px solid var(--slate-100)' }}>
              <Avatar name={r.type === 'comment' ? r.author : r.lead.name} className={r.type === 'comment' ? 'navy' : 'slate'} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, lineHeight: 1.4 }}>{r.text}</div>
                <div style={{ fontSize: 11, color: 'var(--slate-500)', marginTop: 2 }}>
                  <span className="badge badge-slate" style={{ marginRight: 6 }}>{r.type === 'comment' ? 'Comment' : 'Update'}</span>
                  {r.lead.name} · {r.lead.code} · {timeAgo(r.at)}
                </div>
              </div>
            </div>
          ))}
        </Card>
      </div>

      <Drawer open={Boolean(active)} onClose={() => setActive(null)} title="Task Details">
        {active && (() => {
          const { lead, task } = active;
          const overdue = task.status !== 'done' && task.due_at && Date.now() - new Date(task.due_at).getTime() > 0;
          return (
            <div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                <Badge tone={overdue ? 'crimson' : task.status === 'done' ? 'green' : 'amber'}>{overdue ? 'Overdue' : task.status === 'done' ? 'Done' : 'Open'}</Badge>
                <Badge tone="slate">created {timeAgo(task.created_at)}</Badge>
                {task.completed_at && <Badge tone="green">closed {formatDate(task.completed_at)}</Badge>}
              </div>
              <div className="card" style={{ padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>{task.title}</div>
                <div className="kv">
                  <dt>Lead</dt><dd>{lead.name} · {lead.code}</dd>
                  <dt>Assignee</dt><dd>{task.assigned_name || task.assigned_to || '—'}</dd>
                  <dt>Due</dt><dd>{task.due_at ? formatDate(task.due_at) : '—'}</dd>
                  <dt>Priority</dt><dd>{task.priority || '—'}</dd>
                  {task.notes && <><dt>Notes</dt><dd>{task.notes}</dd></>}
                </div>
              </div>
              <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => { setActive(null); navigate(`/leads/${lead.id}`); }}>
                <Icon name="chev" size={14} /> Open Lead to Manage
              </button>
            </div>
          );
        })()}
      </Drawer>
    </div>
  );
}
