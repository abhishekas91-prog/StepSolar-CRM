import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import { formatDate, formatNum } from '../lib/format';
import { Card, Icon, Modal, Badge, useToast } from '../components/ui';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
const METERING = [
  { id: 'net_metering', label: 'Net Metering' },
  { id: 'gross_metering', label: 'Gross Metering' },
  { id: 'net_billing', label: 'Net Billing' },
];

function sum(arr) {
  return (arr || []).reduce((a, b) => a + Number(b || 0), 0);
}

function avg(arr) {
  const list = arr || [];
  if (!list.length) return 0;
  return sum(list) / list.length;
}

export default function SolarProjectSummary() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [bundle, setBundle] = useState(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState('summary');
  const [newDesign, setNewDesign] = useState(false);

  const reload = async () => {
    const data = await api.getSolarProject(id);
    setBundle(data);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.getSolarProject(id);
        if (!cancelled) setBundle(data);
      } catch (e) {
        toast(e.message || 'Project not found', 'error');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!bundle) return <div className="empty-state"><strong>Loading project…</strong></div>;

  const { project, tariff, consumption, designs } = bundle;

  return (
    <div className="sp-summary">
      <div className="filter-bar card" style={{ marginBottom: 16 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/pv-projects')}>
          <Icon name="chev" size={14} /> All design projects
        </button>
        <div>
          <div className="cell-main">{project.name}</div>
          <div className="cell-sub">{project.code} · {project.address || 'No address'}</div>
        </div>
        {project.lead_id && (
          <button className="btn btn-outline btn-sm" onClick={() => navigate(`/leads/${project.lead_id}`)}>Open lead</button>
        )}
        <div style={{ flex: 1 }} />
        <button className={`btn btn-sm ${page === 'summary' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setPage('summary')}>Summary</button>
        <button className={`btn btn-sm ${page === 'consumption' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setPage('consumption')}>Consumption</button>
      </div>

      {page === 'summary' ? (
        <div className="sp-grid">
          <UtilityRateCard
            projectId={id}
            tariff={tariff}
            busy={busy}
            setBusy={setBusy}
            toast={toast}
            onSaved={(next) => setBundle((b) => ({ ...b, tariff: next }))}
          />
          <ConsumptionCards
            onOpen={() => setPage('consumption')}
            onUpload={async (file) => {
              setBusy(true);
              try {
                const next = await api.uploadInterval(id, file, 'current');
                setBundle((b) => ({ ...b, consumption: next }));
                toast('Interval data imported');
                setPage('consumption');
              } catch (e) {
                toast(e.message || 'Upload failed', 'error');
              } finally {
                setBusy(false);
              }
            }}
            consumption={consumption}
            tariff={tariff}
            projectId={id}
            toast={toast}
            onBill={(next) => { setBundle((b) => ({ ...b, consumption: next })); setPage('consumption'); }}
          />
          <DesignsSection
            designs={designs || []}
            onAdd={() => setNewDesign(true)}
            onOpen={(pvId) => pvId && navigate(`/design/${pvId}`)}
          />
        </div>
      ) : (
        <ConsumptionEditor
          projectId={id}
          consumption={consumption}
          tariff={tariff}
          toast={toast}
          onSaved={(next) => setBundle((b) => ({ ...b, consumption: next }))}
          onBack={() => setPage('summary')}
        />
      )}

      <AddDesignModal
        open={newDesign}
        onClose={() => setNewDesign(false)}
        projectId={id}
        toast={toast}
        onCreated={async () => {
          setNewDesign(false);
          await reload();
        }}
      />
    </div>
  );
}

function UtilityRateCard({ projectId, tariff, busy, setBusy, toast, onSaved }) {
  const [form, setForm] = useState(tariff);
  useEffect(() => setForm(tariff), [tariff]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      const next = await api.saveTariff(projectId, {
        mode: form.mode,
        metering: form.metering,
        price_per_kwh: Number(form.price_per_kwh),
        escalation_rate: Number(form.escalation_rate),
        zero_export: Boolean(form.zero_export),
        export_only: Boolean(form.export_only),
        tou_slots: form.tou_slots,
      });
      onSaved(next);
      toast('Utility rate saved');
    } catch (e) {
      toast(e.message || 'Save failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const slots = form.tou_slots || [];

  return (
    <Card title="Utility Rate" subtitle="DISCOM tariff for this rooftop" action={<button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Update'}</button>}>
      <div className="tabs" style={{ marginBottom: 14 }}>
        <button className={`tab ${form.mode === 'flat' ? 'active' : ''}`} onClick={() => set('mode', 'flat')}>Flat</button>
        <button className={`tab ${form.mode === 'tou' ? 'active' : ''}`} onClick={() => set('mode', 'tou')}>Time of Use</button>
      </div>
      <div className="sp-radio-row">
        {METERING.map((m) => (
          <label key={m.id} className={`sp-radio ${form.metering === m.id ? 'on' : ''}`}>
            <input type="radio" name="metering" checked={form.metering === m.id} onChange={() => set('metering', m.id)} />
            {m.label}
          </label>
        ))}
      </div>
      {form.mode === 'flat' ? (
        <div className="form-grid">
          <div className="field">
            <label>Price / kWh (Rs)</label>
            <input className="input" type="number" step="0.1" value={form.price_per_kwh ?? ''} onChange={(e) => set('price_per_kwh', e.target.value)} />
          </div>
          <div className="field">
            <label>Tariff Escalation %</label>
            <input className="input" type="number" step="0.1" value={form.escalation_rate ?? 3.5} onChange={(e) => set('escalation_rate', e.target.value)} />
          </div>
        </div>
      ) : (
        <div>
          {slots.map((s, i) => (
            <div key={i} className="form-grid-3">
              <div className="field"><label>Slot</label><input className="input" value={s.name} onChange={(e) => {
                const next = slots.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x);
                set('tou_slots', next);
              }} /></div>
              <div className="field"><label>Window</label><input className="input" value={`${s.start}–${s.end}`} readOnly /></div>
              <div className="field"><label>Rs / kWh</label><input className="input" type="number" step="0.1" value={s.price_per_kwh} onChange={(e) => {
                const next = slots.map((x, idx) => idx === i ? { ...x, price_per_kwh: Number(e.target.value) } : x);
                set('tou_slots', next);
              }} /></div>
            </div>
          ))}
          <div className="field">
            <label>Tariff Escalation %</label>
            <input className="input" type="number" step="0.1" value={form.escalation_rate ?? 3.5} onChange={(e) => set('escalation_rate', e.target.value)} />
          </div>
        </div>
      )}
      <div className="sp-toggles">
        <label className="sp-toggle">
          <input type="checkbox" checked={Boolean(form.zero_export)} onChange={(e) => set('zero_export', e.target.checked)} />
          Zero Export
        </label>
        <label className="sp-toggle">
          <input type="checkbox" checked={Boolean(form.export_only)} onChange={(e) => set('export_only', e.target.checked)} />
          Export Only
        </label>
      </div>
    </Card>
  );
}

function ConsumptionCards({ onOpen, onUpload, consumption, tariff, projectId, toast, onBill }) {
  const [bill, setBill] = useState('');
  const current = consumption?.current || {};
  const yearly = sum(current.monthly_kwh);

  const applyBill = async () => {
    try {
      const next = await api.consumptionFromBill(projectId, {
        monthly_bill_rs: Number(bill),
        price_per_kwh: Number(tariff?.price_per_kwh || 8.5),
        which: 'current',
      });
      onBill(next);
      toast('kWh estimated from bill');
    } catch (e) {
      toast(e.message || 'Estimate failed', 'error');
    }
  };

  return (
    <Card title="Consumption Profile" subtitle="Current load used for sizing">
      <div className="sp-two">
        <button className="sp-choice" type="button" onClick={onOpen}>
          <Icon name="billing" size={18} />
          <strong>Monthly Electricity Bill</strong>
          <span>Enter average monthly energy or convert Rs bill to kWh</span>
          {yearly > 0 && <Badge tone="navy" noDot>{formatNum(Math.round(yearly))} kWh / yr</Badge>}
        </button>
        <label className="sp-choice">
          <Icon name="upload" size={18} />
          <strong>Spreadsheet Interval Data</strong>
          <span>CSV / XLSX with datetime + kWh, or Jan–Dec columns</span>
          <input type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
        </label>
      </div>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <div className="field">
          <label>Estimate from monthly bill (Rs)</label>
          <input className="input" type="number" placeholder="e.g. 4500" value={bill} onChange={(e) => setBill(e.target.value)} />
        </div>
        <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button className="btn btn-outline" disabled={!bill} onClick={applyBill}>Bill se kWh nikaalo</button>
        </div>
      </div>
    </Card>
  );
}

function ConsumptionEditor({ projectId, consumption, tariff, toast, onSaved, onBack }) {
  const [tab, setTab] = useState('current');
  const [type, setType] = useState(consumption?.type || 'monthly_avg');
  const [avgKwh, setAvgKwh] = useState(String(Math.round(avg(consumption?.current?.monthly_kwh) || 0)));
  const [slice, setSlice] = useState(() => ({
    current: consumption?.current || { monthly_kwh: Array(12).fill(0), daily_profile: [] },
    future: consumption?.future || { monthly_kwh: Array(12).fill(0), daily_profile: [] },
  }));
  const [busy, setBusy] = useState(false);
  const [bill, setBill] = useState('');

  const active = slice[tab];
  const chartData = useMemo(
    () => MONTHS.map((m, i) => ({ month: m, kwh: Number((active?.monthly_kwh || [])[i] || 0) })),
    [active],
  );
  const yearly = sum(active?.monthly_kwh);
  const monthlyAvg = avg(active?.monthly_kwh);

  const applyAvg = (value) => {
    const n = Number(value) || 0;
    setAvgKwh(value);
    setSlice((s) => ({
      ...s,
      [tab]: { ...s[tab], monthly_kwh: Array(12).fill(n) },
    }));
  };

  const save = async () => {
    setBusy(true);
    try {
      const next = await api.saveConsumption(projectId, {
        type,
        current: slice.current,
        future: slice.future,
      });
      onSaved(next);
      toast('Consumption profile updated');
    } catch (e) {
      toast(e.message || 'Save failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const fromBill = async () => {
    setBusy(true);
    try {
      const next = await api.consumptionFromBill(projectId, {
        monthly_bill_rs: Number(bill),
        price_per_kwh: Number(tariff?.price_per_kwh || 8.5),
        which: tab,
      });
      onSaved(next);
      setSlice({ current: next.current, future: next.future });
      setType(next.type);
      setAvgKwh(String(Math.round(avg(next[tab]?.monthly_kwh) || 0)));
      toast('Bill converted to kWh');
    } catch (e) {
      toast(e.message || 'Estimate failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Card
        title="Consumption Profile"
        subtitle="Current vs future load"
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={onBack}>Back</button>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Update'}</button>
          </div>
        }
      >
        <div className="tabs" style={{ marginBottom: 14 }}>
          <button className={`tab ${tab === 'current' ? 'active' : ''}`} onClick={() => setTab('current')}>Current Profile</button>
          <button className={`tab ${tab === 'future' ? 'active' : ''}`} onClick={() => setTab('future')}>Future Profile</button>
        </div>
        <div className="form-grid">
          <div className="field">
            <label>Average Monthly Energy (kWh)</label>
            <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="monthly_avg">Average Monthly Energy (kWh)</option>
              <option value="monthly_bill">From monthly bill (Rs)</option>
              <option value="interval_csv">Spreadsheet interval data</option>
            </select>
          </div>
          <div className="field">
            <label>Monthly kWh</label>
            <input className="input" type="number" value={avgKwh} onChange={(e) => applyAvg(e.target.value)} />
          </div>
        </div>
        {type === 'monthly_bill' && (
          <div className="form-grid">
            <div className="field">
              <label>Monthly bill (Rs) / tariff {tariff?.price_per_kwh || 8.5}</label>
              <input className="input" type="number" value={bill} onChange={(e) => setBill(e.target.value)} placeholder="e.g. 4500" />
            </div>
            <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button className="btn btn-outline" disabled={!bill || busy} onClick={fromBill}>Bill se kWh</button>
            </div>
          </div>
        )}
        <div className="sp-kpis">
          <div><span>Average monthly</span><strong>{formatNum(Math.round(monthlyAvg))} kWh</strong></div>
          <div><span>Yearly</span><strong>{formatNum(Math.round(yearly))} kWh</strong></div>
        </div>
        <div style={{ height: 220, margin: '8px 0 16px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Bar dataKey="kwh" fill="#15803d" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="section-title">Daily Profile</div>
        <div className="sp-daily">
          {(active?.daily_profile || []).map((v, i) => (
            <div key={i} className="sp-daily-col" title={`${HOURS[i]} · ${(v * 100).toFixed(1)}%`}>
              <div className="sp-daily-bar" style={{ height: `${Math.max(4, v * 180)}px` }} />
              {i % 3 === 0 && <span>{i}</span>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function DesignsSection({ designs, onAdd, onOpen }) {
  return (
    <Card title="Designs" subtitle="Each design can use a different defaults profile" action={<button className="btn btn-primary btn-sm" onClick={onAdd}><Icon name="plus" size={14} /> Add New Design</button>}>
      <div className="sp-designs">
        <button type="button" className="sp-design-add" onClick={onAdd}>
          <Icon name="plus" size={22} />
          <strong>Add New Design</strong>
          <span>Name + defaults profile, then open studio</span>
        </button>
        {designs.map((d) => (
          <button
            type="button"
            key={d.id}
            className="sp-design-card"
            onClick={() => onOpen(d.pv_design_id)}
          >
            <Badge tone="slate" noDot>{d.status || 'draft'}</Badge>
            <strong>{d.name}</strong>
            <span>{d.defaults_profile || 'BD TEAM'}</span>
            <span className="cell-sub">{formatDate(d.created_at)}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

function AddDesignModal({ open, onClose, projectId, toast, onCreated }) {
  const [name, setName] = useState('');
  const [profile, setProfile] = useState('BD TEAM');
  const [profiles, setProfiles] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setProfile('BD TEAM');
    api.defaultsProfiles().then(setProfiles).catch(() => setProfiles([{ name: 'BD TEAM' }]));
  }, [open]);

  const create = async () => {
    setBusy(true);
    try {
      await api.createProjectDesign(projectId, { name, defaults_profile: profile });
      toast('Design added');
      onCreated();
    } catch (e) {
      toast(e.message || 'Could not create design', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add New Design"
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={create}>
            {busy ? 'Creating…' : 'Confirm'}
          </button>
        </>
      }
    >
      <div className="field">
        <label>Design Name <span className="req">*</span></label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. South roof 5 kW" />
      </div>
      <div className="field">
        <label>Defaults Profile</label>
        <select className="select" value={profile} onChange={(e) => setProfile(e.target.value)}>
          {(profiles.length ? profiles : [{ name: 'BD TEAM' }]).map((p) => (
            <option key={p.id || p.name} value={p.name}>{p.name}</option>
          ))}
        </select>
      </div>
    </Modal>
  );
}
