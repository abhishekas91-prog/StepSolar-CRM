import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../lib/store';
import { Card, Icon, Badge, Modal } from '../components/ui';
import { formatDateTime } from '../lib/format';

export default function Surveys() {
  const state = useStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const preselect = params.get('lead');
  const [open, setOpen] = useState(Boolean(preselect));
  const [leadId, setLeadId] = useState(preselect || '');

  const surveys = useMemo(() => state.leads.filter((l) => l.survey), [state.leads]);

  const stats = useMemo(() => {
    const completed = surveys.filter((l) => (l.survey.status || '') === 'Completed').length;
    const totalKw = surveys.reduce((a, l) => a + (l.capacity || 0), 0);
    return {
      total: surveys.length,
      completed,
      scheduled: surveys.filter((l) => (l.survey.status || '') !== 'Completed').length,
      totalKw: Math.round(totalKw * 10) / 10,
    };
  }, [surveys]);

  const lead = state.leads.find((l) => l.id === leadId);

  return (
    <div>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <div className="kpi"><div className="kpi-label"><Icon name="survey" size={14} /> Surveys Captured</div><div className="kpi-value">{stats.total}</div><div className="kpi-extra">across pipeline</div></div>
        <div className="kpi accent-sky"><div className="kpi-label"><Icon name="sun" size={14} /> Surveyed Capacity</div><div className="kpi-value">{stats.totalKw} kW</div><div className="kpi-extra">sum of proposed sizes</div></div>
        <div className="kpi accent-amber"><div className="kpi-label"><Icon name="file" size={14} /> Completed</div><div className="kpi-value">{stats.completed}</div><div className="kpi-extra">{stats.scheduled} still scheduled</div></div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={() => setOpen(true)}><Icon name="plus" size={15} /> Start New Survey</button>
      </div>

      <Card title="Site Survey Register" subtitle="Field assessments linked to leads" pad={false}>
        {surveys.length === 0 ? (
          <div className="empty-state"><div className="big"><Icon name="survey" size={40} /></div><strong>No surveys yet</strong><div>Start a survey against a lead to capture roof & electrical audit data.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Lead</th><th>Customer</th><th>Capacity</th><th>Engineer</th><th>Scheduled</th><th>Area</th><th>Status</th><th style={{ textAlign: 'right' }}>Open</th></tr></thead>
              <tbody>
                {surveys.map((l) => (
                  <tr key={l.id} className="clickable" onClick={() => navigate(`/leads/${l.id}`)}>
                    <td><span className="cell-main">{l.code}</span><div className="cell-sub">{l.city || '—'}</div></td>
                    <td><div className="cell-main">{l.name}</div><div className="cell-sub">{l.phone}</div></td>
                    <td><Badge tone="navy">{l.capacity ? l.capacity + ' kW' : '—'}</Badge></td>
                    <td>{l.survey.engineer_name || '—'}</td>
                    <td>{l.survey.scheduled_at ? formatDateTime(l.survey.scheduled_at) : '—'}</td>
                    <td>{l.survey.accessible_area_sqft ? `${l.survey.accessible_area_sqft} sq.ft` : '—'}</td>
                    <td><Badge tone={(l.survey.status || '') === 'Completed' ? 'green' : 'amber'}>{l.survey.status || 'Scheduled'}</Badge></td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-sm btn-outline" onClick={(e) => { e.stopPropagation(); navigate(`/leads/${l.id}`); }}><Icon name="chev" size={13} /> View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Start Site Survey" footer={
        <>
          <button className="btn btn-outline" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={!lead} onClick={() => { setOpen(false); navigate(`/leads/${lead.id}`); }}><Icon name="survey" size={14} /> Capture Survey</button>
        </>
      }>
        <div className="field">
          <label>Link to Lead</label>
          <select className="select" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            <option value="">Select lead</option>
            {state.leads.map((l) => <option key={l.id} value={l.id}>{l.name} — {l.city || '—'} ({l.capacity || '?'} kW{', '}{l.survey ? 'surveyed' : 'no survey'})</option>)}
          </select>
        </div>
        {lead && (
          <div className="card" style={{ padding: 14, background: 'var(--green-50)', borderColor: 'var(--green-100)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--slate-500)', marginBottom: 6 }}>Survey intent</div>
            <div style={{ fontSize: 13, color: 'var(--slate-700)' }}>
              Record roof structure, shadow analysis, sanctioned load & recommendations against this lead. The survey feeds the pipeline's <strong>Site Survey Completed</strong> stage.
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
