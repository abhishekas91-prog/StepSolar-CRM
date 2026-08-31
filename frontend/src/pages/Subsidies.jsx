import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { DISCOMS } from '../lib/data';
import { Card, Icon, Badge, ProgressBar, useToast } from '../components/ui';
import { formatINR, timeAgo } from '../lib/format';

const FLOW = [
  { icon: 'file', label: 'Not Applied' },
  { icon: 'send', label: 'Applied' },
  { icon: 'check', label: 'Approved' },
  { icon: 'billing', label: 'Disbursed' },
  { icon: 'alert', label: 'Rejected' },
];
const STATUS_TONE = { 'Not Applied': 'slate', Applied: 'amber', Approved: 'violet', Disbursed: 'green', Rejected: 'crimson' };

export default function Subsidies() {
  const state = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(null);

  const subsidies = useMemo(
    () => state.leads.filter((l) => l.solar && l.solar.subsidy_status && l.solar.subsidy_status !== 'Not Applied'),
    [state.leads],
  );

  const stats = useMemo(() => {
    const disbursed = subsidies.filter((s) => s.solar.subsidy_status === 'Disbursed');
    const inFlight = subsidies.filter((s) => ['Applied', 'Approved'].includes(s.solar.subsidy_status));
    return {
      pendingCount: inFlight.length,
      pending: inFlight.reduce((a, s) => a + (s.solar.subsidy_amount || 0), 0),
      disbursedCount: disbursed.length,
      disbursed: disbursed.reduce((a, s) => a + (s.solar.subsidy_amount || 0), 0),
    };
  }, [subsidies]);

  const byDiscom = useMemo(() => {
    const map = {};
    DISCOMS.forEach((d) => (map[d] = 0));
    subsidies.forEach((s) => {
      const discom = (s.solar.discom_app_id || '').split('-')[0] || (s.state === 'Bihar' ? 'NBPDCL' : 'PVVNL');
      map[discom] = (map[discom] || 0) + 1;
    });
    return map;
  }, [subsidies]);

  const list = useMemo(() => {
    let l = subsidies;
    if (filter) l = l.filter((s) => s.solar.subsidy_status === filter);
    return l;
  }, [subsidies, filter]);

  const docCount = useMemo(() => {
    let total = 0;
    subsidies.forEach((l) =>
      l.stages.forEach((s) => {
        total += (s.documents || []).length;
      }),
    );
    return total;
  }, [subsidies]);

  return (
    <div>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <div className="kpi"><div className="kpi-label"><Icon name="subsidy" size={14} /> In Progress</div><div className="kpi-value">{stats.pendingCount} cases</div><div className="kpi-extra">{formatINR(stats.pending)} pending</div></div>
        <div className="kpi accent-green"><div className="kpi-label"><Icon name="billing" size={14} /> Disbursed</div><div className="kpi-value">{stats.disbursedCount} cases</div><div className="kpi-extra">{formatINR(stats.disbursed)} realized</div></div>
        <div className="kpi accent-amber"><div className="kpi-label"><Icon name="file" size={14} /> Docs on File</div><div className="kpi-value">{docCount}</div><div className="kpi-extra">stage attachments</div></div>
        <div className="kpi accent-navy"><div className="kpi-label"><Icon name="users" size={14} /> Total Cases</div><div className="kpi-value">{subsidies.length}</div><div className="kpi-extra">applied or beyond</div></div>
      </div>

      <div className="grid-2" style={{ marginBottom: 20, gridTemplateColumns: '1fr 2fr' }}>
        <Card title="DISCOM Load">
          {DISCOMS.map((d) => {
            const cases = byDiscom[d] || 0;
            const pct = subsidies.length ? (cases / subsidies.length) * 100 : 0;
            return (
              <div key={d} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 12.5 }}>
                  <strong>{d}</strong>
                  <span style={{ color: 'var(--slate-500)' }}>{cases} cases</span>
                </div>
                <ProgressBar pct={pct} />
              </div>
            );
          })}
          <div style={{ fontSize: 11.5, color: 'var(--slate-500)', marginTop: 6 }}>DISCOM inferred from consumer/app IDs — update the Solar Design per lead for accuracy.</div>
        </Card>

        <Card title="Subsidy Workflow" subtitle="PM Surya Ghar Muft Bijli Yojana — status from Solar Design per lead"
          action={
            <select className="select" style={{ width: 140 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">All statuses</option>
              {FLOW.map((f) => <option key={f.label}>{f.label}</option>)}
            </select>
          }
          pad={false}
        >
          {list.length === 0 ? (
            <div className="empty-state"><strong>No subsidy cases</strong><div>Set a subsidy status in a lead's Solar Design to track it here.</div></div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Lead</th><th>Customer</th><th>Capacity</th><th>Subsidy Amt</th><th>Status</th><th>Updated</th><th style={{ textAlign: 'right' }}>Open</th></tr></thead>
                <tbody>
                  {list.slice(0, 20).map((l) => {
                    const st = l.solar.subsidy_status;
                    const stage = l.stages.find((s) => s.key === 'subsidy_disbursed');
                    return (
                      <tr key={l.id} className="clickable" onClick={() => navigate(`/leads/${l.id}`)}>
                        <td><span className="cell-main">{l.code}</span><div className="cell-sub">{l.solar.discom_app_id || '—'}</div></td>
                        <td><div className="cell-main">{l.name}</div><div className="cell-sub">{l.city || '—'} · {l.capacity || '?'} kW</div></td>
                        <td><Badge tone="navy">{l.capacity ? l.capacity + ' kW' : '—'}</Badge></td>
                        <td style={{ fontWeight: 700 }}>{formatINR(l.solar.subsidy_amount)}</td>
                        <td><Badge tone={STATUS_TONE[st] || 'slate'}>{st}</Badge></td>
                        <td>{stage?.updatedAt ? timeAgo(stage.updatedAt) : '—'}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="btn btn-sm btn-outline" onClick={(e) => { e.stopPropagation(); setSelected(l.id === selected ? null : l.id); }}><Icon name="chev" size={13} /> Details</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {selected && (() => {
        const l = state.leads.find((x) => x.id === selected);
        if (!l) return null;
        const idx = FLOW.findIndex((f) => f.label === l.solar.subsidy_status);
        return (
          <Card title={`${l.code} — Subsidy Progress`} style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {FLOW.map((f, i) => {
                const done = i < idx;
                const current = i === idx;
                const rejected = f.label === 'Rejected';
                return (
                  <div key={f.label} style={{ flex: '1 1 130px' }}>
                    <div style={{
                      background: done ? 'var(--green-600)' : current ? (rejected ? 'var(--crimson-600)' : 'var(--amber-500)') : 'var(--slate-100)',
                      color: done || current ? '#fff' : 'var(--slate-400)',
                      borderRadius: 10, padding: '10px 12px', textAlign: 'center',
                    }}>
                      <Icon name={f.icon} size={16} style={{ marginBottom: 4 }} />
                      <div style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.25 }}>{f.label}</div>
                      {done && <Icon name="check" size={12} style={{ marginTop: 4 }} />}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 14, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={() => { toast('Subsidy status edited on the lead'); navigate(`/leads/${l.id}`); }}>
                <Icon name="edit" size={14} /> Edit Solar Design
              </button>
            </div>
          </Card>
        );
      })()}
    </div>
  );
}
