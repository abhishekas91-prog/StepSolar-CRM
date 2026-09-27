import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MapContainer, Polygon, TileLayer, useMap, useMapEvents, CircleMarker, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../lib/api';
import { formatINR } from '../lib/format';
import { Card, Badge, useToast } from '../components/ui';
import { useStore } from '../lib/store';
import '../design-studio.css';

function Recenter({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView(center, zoom || map.getZoom());
  }, [center, zoom, map]);
  return null;
}

function DrawLayer({ mode, onPoint }) {
  useMapEvents({
    click(e) {
      if (mode === 'roof' || mode === 'obs') onPoint(e.latlng);
    },
  });
  return null;
}

function PanelPoly({ p }) {
  const pts = (p.corners || []).map((c) => [c.lat, c.lng]);
  if (pts.length < 3) return null;
  return (
    <Polygon
      positions={pts}
      pathOptions={{ color: '#d4f56a', weight: 1, fillColor: '#1e5a3a', fillOpacity: 0.72 }}
    />
  );
}

function num(n, d = 0) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: d }).format(n || 0);
}

export default function DesignStudio() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const leadId = params.get('lead');
  const nav = useNavigate();
  const toast = useToast();
  const { leads } = useStore();
  const lead = leads.find((l) => l.id === leadId);

  const [design, setDesign] = useState(null);
  const [catalog, setCatalog] = useState({ panels: [], inverters: [] });
  const [result, setResult] = useState(null);
  const [mode, setMode] = useState('pan');
  const [draft, setDraft] = useState([]);
  const [tab, setTab] = useState('layout');
  const [activeRoof, setActiveRoof] = useState(null);
  const [hits, setHits] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cat = await api.designCatalog();
        if (!cancelled) setCatalog(cat);
        let d = null;
        if (id) {
          d = await api.getDesign(id);
        } else if (leadId) {
          const list = await api.designs(leadId);
          d = list[0] || (await api.createDesign({
            lead_id: leadId,
            name: lead ? `${lead.name} rooftop` : 'Lead rooftop',
            address: lead?.address || [lead?.city, lead?.state].filter(Boolean).join(', '),
            annual_bill_kwh: lead?.monthlyBill ? Math.round((lead.monthlyBill * 12) / 8.5) : 7200,
            tariff: 8.5,
          }));
        } else {
          d = await api.createDesign({ name: 'Untitled rooftop' });
        }
        if (cancelled || !d) return;
        setDesign(d);
        setResult(d.result || null);
        setActiveRoof(d.roofs?.[0]?.id || null);
        setQ(d.address || '');
        if (d.id && id !== d.id) nav(`/design/${d.id}${leadId ? `?lead=${leadId}` : ''}`, { replace: true });
      } catch (e) {
        toast(e.message || 'Could not load design', 'error');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, leadId]);

  const persist = (next) => {
    setDesign(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (!next?.id) return;
      api.saveDesign(next.id, next).catch(() => {});
    }, 500);
  };

  const patch = (partial) => persist({ ...design, ...partial });

  const onPoint = (ll) => {
    if (mode === 'obs') {
      const o = { id: `obs-${Date.now()}`, type: 'tree', height_m: 8, lat: ll.lat, lng: ll.lng };
      persist({ ...design, obstructions: [...(design.obstructions || []), o] });
      return;
    }
    if (mode === 'roof') setDraft((d) => [...d, { lat: ll.lat, lng: ll.lng }]);
  };

  const closeRoof = () => {
    if (draft.length < 3) return;
    const roof = {
      id: `roof-${Date.now()}`,
      name: `Roof ${(design.roofs?.length || 0) + 1}`,
      tilt: 18,
      azimuth: 180,
      setback_m: 0.4,
      row_gap_m: 0.02,
      col_gap_m: 0.02,
      orientation: 'portrait',
      points: draft,
    };
    persist({ ...design, roofs: [...(design.roofs || []), roof] });
    setActiveRoof(roof.id);
    setDraft([]);
    setMode('pan');
  };

  const runSim = async () => {
    if (!design?.id) return;
    setBusy(true);
    try {
      await api.saveDesign(design.id, design);
      const r = await api.simulateDesign(design.id, design);
      setDesign(r.design);
      setResult(r.result);
      setTab('energy');
      toast(`Simulated ${r.result?.system?.dc_kw || 0} kWp`);
    } catch (e) {
      toast(e.message || 'Simulation failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const roof = (design?.roofs || []).find((r) => r.id === activeRoof);
  const center = useMemo(() => {
    if (!design?.location) return [25.5941, 85.1376];
    return [design.location.lat, design.location.lng];
  }, [design]);

  if (!design) {
    return <div className="empty-state"><strong>Loading design studio…</strong></div>;
  }

  const sys = result?.system;
  const prod = result?.production;
  const fin = result?.financials;

  return (
    <div className="pv-studio">
      <div className="pv-studio-head">
        <div>
          <h3 style={{ margin: 0 }}>{design.name}</h3>
          <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>{lead ? `${lead.code} · ${lead.name}` : design.address}</div>
        </div>
        <div className="pv-tools">
          <button className={`btn btn-sm ${mode === 'pan' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setMode('pan')}>Pan</button>
          <button className={`btn btn-sm ${mode === 'roof' ? 'btn-primary' : 'btn-outline'}`} onClick={() => { setMode('roof'); setDraft([]); }}>Trace roof</button>
          {mode === 'roof' && draft.length >= 3 && <button className="btn btn-sm btn-primary" onClick={closeRoof}>Close polygon</button>}
          <button className={`btn btn-sm ${mode === 'obs' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setMode('obs')}>Obstruction</button>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={runSim}>{busy ? 'Running…' : 'Simulate'}</button>
          {leadId && <button className="btn btn-sm btn-outline" onClick={() => nav(`/leads/${leadId}`)}>Back to lead</button>}
        </div>
      </div>

      <div className="pv-grid">
        <div className="pv-map">
          <div className="pv-search">
            <input
              className="input"
              value={q}
              placeholder="Search address / society"
              onChange={async (e) => {
                setQ(e.target.value);
                if (e.target.value.length > 3) {
                  const h = await api.geocodeDesign(e.target.value).catch(() => []);
                  setHits(h);
                }
              }}
            />
            {hits.length > 0 && (
              <div className="pv-hits">
                {hits.map((h) => (
                  <button
                    key={h.label}
                    type="button"
                    onClick={() => {
                      patch({ address: h.label, location: { lat: h.lat, lng: h.lng, zoom: 19 } });
                      setQ(h.label);
                      setHits([]);
                    }}
                  >
                    {h.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <MapContainer center={center} zoom={design.location?.zoom || 19} maxZoom={21} style={{ height: '100%', width: '100%' }}>
            <TileLayer
              attribution="&copy; Esri"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxNativeZoom={19}
              maxZoom={21}
            />
            <Recenter center={center} zoom={design.location?.zoom || 19} />
            <DrawLayer mode={mode} onPoint={onPoint} />
            {(design.roofs || []).map((r) => (
              <Polygon
                key={r.id}
                positions={(r.points || []).map((p) => [p.lat, p.lng])}
                eventHandlers={{ click: () => setActiveRoof(r.id) }}
                pathOptions={{
                  color: r.id === activeRoof ? '#f59e0b' : '#1578c8',
                  weight: 2,
                  fillColor: '#0b3d2e',
                  fillOpacity: 0.25,
                }}
              />
            ))}
            {draft.length > 0 && (
              <Polygon positions={draft.map((p) => [p.lat, p.lng])} pathOptions={{ color: '#f59e0b', dashArray: '6 4', fillOpacity: 0.15 }} />
            )}
            {(design.obstructions || []).map((o) => (
              <CircleMarker key={o.id} center={[o.lat, o.lng]} radius={8} pathOptions={{ color: '#ef4444', fillOpacity: 0.8 }}>
                <Tooltip>{o.type} {o.height_m}m</Tooltip>
              </CircleMarker>
            ))}
            {(result?.layouts || []).flatMap((l) => (l.panels || []).map((p) => <PanelPoly key={p.id} p={p} />))}
          </MapContainer>
        </div>

        <aside className="pv-side">
          <div className="tabs" style={{ marginBottom: 12 }}>
            {['layout', 'energy', 'electrical', 'money'].map((t) => (
              <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
            ))}
          </div>

          {tab === 'layout' && (
            <>
              <div className="field">
                <label>Module</label>
                <select className="select" value={design.panel_id || 'mod-540'} onChange={(e) => patch({ panel_id: e.target.value })}>
                  {catalog.panels.map((p) => (
                    <option key={p.id} value={p.id}>{p.brand} {p.model} · {p.watt}W</option>
                  ))}
                </select>
              </div>
              {(design.roofs || []).map((r) => (
                <button key={r.id} type="button" className={`pv-roof ${r.id === activeRoof ? 'on' : ''}`} onClick={() => setActiveRoof(r.id)}>
                  <strong>{r.name}</strong>
                  <span>{(r.points || []).length} pts · tilt {r.tilt}° · az {r.azimuth}°</span>
                </button>
              ))}
              {roof && (
                <div className="pv-form">
                  <div className="field"><label>Tilt °</label>
                    <input className="input" type="number" value={roof.tilt} onChange={(e) => persist({ ...design, roofs: design.roofs.map((r) => r.id === roof.id ? { ...r, tilt: Number(e.target.value) } : r) })} />
                  </div>
                  <div className="field"><label>Azimuth °</label>
                    <input className="input" type="number" value={roof.azimuth} onChange={(e) => persist({ ...design, roofs: design.roofs.map((r) => r.id === roof.id ? { ...r, azimuth: Number(e.target.value) } : r) })} />
                  </div>
                  <div className="field"><label>Setback m</label>
                    <input className="input" type="number" step="0.05" value={roof.setback_m} onChange={(e) => persist({ ...design, roofs: design.roofs.map((r) => r.id === roof.id ? { ...r, setback_m: Number(e.target.value) } : r) })} />
                  </div>
                  <div className="field"><label>Orientation</label>
                    <select className="select" value={roof.orientation} onChange={(e) => persist({ ...design, roofs: design.roofs.map((r) => r.id === roof.id ? { ...r, orientation: e.target.value } : r) })}>
                      <option value="portrait">Portrait</option>
                      <option value="landscape">Landscape</option>
                    </select>
                  </div>
                </div>
              )}
              {roof && <button className="btn btn-outline btn-sm" onClick={() => persist({ ...design, roofs: (design.roofs || []).filter((r) => r.id !== activeRoof) })}>Delete roof</button>}
              {sys && (
                <Card style={{ marginTop: 12 }}>
                  <Row k="Modules" v={sys.panel_count} />
                  <Row k="DC size" v={`${sys.dc_kw} kWp`} />
                  <Row k="Roof area" v={`${sys.roof_area_m2} m²`} />
                  <Row k="Coverage" v={`${sys.coverage_pct}%`} />
                </Card>
              )}
            </>
          )}

          {tab === 'energy' && (
            !prod ? <p className="muted">Trace a roof, then Simulate.</p> : (
              <>
                <Row k="Year-1" v={`${num(prod.year1_kwh)} kWh`} />
                <Row k="Specific yield" v={`${prod.specific_yield} kWh/kWp`} />
                <Row k="PR" v={`${result.losses.pr}%`} />
                <Row k="GHI" v={`${result.climate.ghi_annual} kWh/m²`} />
                <Row k="CO₂ avoided" v={`${prod.co2_tons_year} t/yr`} />
                <div className="pv-bars">
                  {prod.monthly_kwh.map((v, i) => (
                    <div key={prod.months[i]} className="pv-bar" style={{ height: `${(v / Math.max(...prod.monthly_kwh)) * 100}%` }} title={`${prod.months[i]} ${v}`} />
                  ))}
                </div>
                <div className="pv-bar-labels">{prod.months.map((m) => <span key={m}>{m[0]}</span>)}</div>
                <h4>Loss tree</h4>
                {Object.entries(result.losses).filter(([k]) => k !== 'pr').map(([k, v]) => (
                  <div className="pv-loss" key={k}>
                    <span>{k}</span>
                    <div className="pv-track"><div style={{ width: `${Math.min(v * 4, 100)}%` }} /></div>
                    <span>{v}%</span>
                  </div>
                ))}
              </>
            )
          )}

          {tab === 'electrical' && result && (
            <>
              <Row k="Inverter" v={`${result.inverter.brand} ${result.inverter.model}`} />
              <Row k="Count" v={`×${result.inverter.count}`} />
              <Row k="AC" v={`${sys.ac_kw} kW`} />
              <Row k="DC/AC" v={sys.dc_ac_ratio} />
              <Row k="Strings" v={result.electrical.string_count} />
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table className="data">
                  <thead><tr><th>ID</th><th>Mod</th><th>Voc</th><th>MPPT</th></tr></thead>
                  <tbody>
                    {(result.electrical.strings || []).slice(0, 12).map((s) => (
                      <tr key={s.id}><td>{s.id}</td><td>{s.panels}</td><td>{s.voc}</td><td>{s.mppt}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === 'money' && (
            <>
              <div className="pv-form">
                <div className="field"><label>Tariff</label>
                  <input className="input" type="number" step="0.1" value={design.tariff} onChange={(e) => patch({ tariff: Number(e.target.value) })} />
                </div>
                <div className="field"><label>EPC INR/W</label>
                  <input className="input" type="number" value={design.epc_cost_per_w} onChange={(e) => patch({ epc_cost_per_w: Number(e.target.value) })} />
                </div>
                <div className="field"><label>Subsidy (0–1)</label>
                  <input className="input" type="number" step="0.01" value={design.subsidy_pct} onChange={(e) => patch({ subsidy_pct: Number(e.target.value) })} />
                </div>
                <div className="field"><label>Export tariff</label>
                  <input className="input" type="number" step="0.1" value={design.export_tariff} onChange={(e) => patch({ export_tariff: Number(e.target.value) })} />
                </div>
              </div>
              {fin ? (
                <>
                  <Row k="CAPEX" v={formatINR(fin.capex)} />
                  <Row k="Net after subsidy" v={formatINR(fin.net_capex)} />
                  <Row k="Payback" v={`${fin.payback_years ?? '—'} yr`} />
                  <Row k="IRR" v={fin.irr != null ? `${(fin.irr * 100).toFixed(1)}%` : '—'} />
                  <Row k="NPV" v={formatINR(fin.npv)} />
                  <Row k="LCOE" v={`${fin.lcoe} INR/kWh`} />
                  <Row k="Y1 savings" v={formatINR(fin.savings_y1)} />
                  {leadId && <Badge tone="green">Saved on lead solar record</Badge>}
                </>
              ) : <p className="muted">Simulate to unlock bankability.</p>}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="pv-kv"><span>{k}</span><b>{v}</b></div>
  );
}
