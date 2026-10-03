import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MapContainer, Polygon, TileLayer, useMap, useMapEvents, CircleMarker, Tooltip } from 'react-leaflet';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import 'leaflet/dist/leaflet.css';
import { api } from '../lib/api';
import { formatINR, timeAgo } from '../lib/format';
import { Card, Badge, useToast } from '../components/ui';
import { useStore } from '../lib/store';
import Design3DView from '../components/Design3DView';
import { accessColor, dayOfYear } from '../lib/sun';
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
  const [viewMode, setViewMode] = useState('2d');
  const [layer, setLayer] = useState('esri');
  const [heatmapOn, setHeatmapOn] = useState(false);
  const [sunOn, setSunOn] = useState(false);
  const [day, setDay] = useState(dayOfYear(new Date()));
  const [hour, setHour] = useState(12);
  const [generation, setGeneration] = useState(null);
  const [irradiance, setIrradiance] = useState(null);
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
        setGeneration(d.generation || null);
        setIrradiance(d.irradiance || null);
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

  const runGenerate = async () => {
    if (!design?.id) return;
    setBusy(true);
    try {
      await api.saveDesign(design.id, design);
      if (!result) {
        const r = await api.simulateDesign(design.id, design);
        setDesign(r.design);
        setResult(r.result);
      }
      const g = await api.generateDesign(design.id, {});
      setDesign(g.design);
      setGeneration(g.generation);
      setTab('energy');
      toast(`Generation ${g.generation?.annual_mwh || 0} MWh/yr`);
    } catch (e) {
      toast(e.message || 'Generation failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const runIrradiance = async (on) => {
    setHeatmapOn(on);
    if (!on || !design?.id) return;
    if (irradiance?.cells?.length) return;
    setBusy(true);
    try {
      const irr = await api.designIrradiance(design.id);
      setIrradiance(irr);
      setDesign((d) => ({ ...d, irradiance: irr }));
    } catch (e) {
      toast(e.message || 'Irradiance failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const tileUrl = layer === 'google'
    ? 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'
    : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

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
  const gen = generation;
  const show2d = viewMode === '2d' || viewMode === 'dual';
  const show3d = viewMode === '3d' || viewMode === 'dual' || layer === 'google3d';
  const mapClass = viewMode === 'dual' ? 'pv-map dual-left' : 'pv-map';
  const chartData = (gen?.months || []).map((m, i) => ({
    month: m,
    gen: Number(gen?.monthly_kwh?.[i] || 0),
    load: Number((design.annual_bill_kwh || 7200) / 12),
  }));

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
          <button className="btn btn-sm btn-outline" disabled={busy} onClick={runSim}>{busy ? 'Running…' : 'Simulate'}</button>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={runGenerate}>{busy ? 'Calculating…' : 'Calculate Generation'}</button>
          <button className="btn btn-sm btn-outline" onClick={() => nav(`/documentProposal/${design.id}`)}>Proposal</button>
          {design.solar_project_id && <button className="btn btn-sm btn-outline" onClick={() => nav(`/pv-projects/${design.solar_project_id}`)}>Project</button>}
          {leadId && <button className="btn btn-sm btn-outline" onClick={() => nav(`/leads/${leadId}`)}>Back to lead</button>}
        </div>
      </div>

      <div className="pv-toolbar">
        <button className={`btn btn-sm ${viewMode === '2d' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setViewMode('2d')}>2D</button>
        <button className={`btn btn-sm ${viewMode === '3d' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setViewMode('3d')}>3D</button>
        <button className={`btn btn-sm ${viewMode === 'dual' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setViewMode('dual')}>Dual Map</button>
        <select className="select" style={{ width: 170 }} value={layer} onChange={(e) => {
          const v = e.target.value;
          setLayer(v);
          if (v === 'google3d') setViewMode((m) => (m === '2d' ? 'dual' : m));
        }}>
          <option value="esri">Esri satellite</option>
          <option value="google">Google</option>
          <option value="google3d">GoogleSolar3D</option>
        </select>
        <button className={`btn btn-sm ${heatmapOn ? 'btn-primary' : 'btn-outline'}`} onClick={() => runIrradiance(!heatmapOn)}>Irradiance Map</button>
        <button className={`btn btn-sm ${sunOn ? 'btn-primary' : 'btn-outline'}`} onClick={() => { setSunOn((s) => !s); if (viewMode === '2d') setViewMode('3d'); }}>Sun Path</button>
        {sunOn && (
          <>
            <label className="cell-sub">Day <input className="range" type="range" min="1" max="365" value={day} onChange={(e) => setDay(Number(e.target.value))} /></label>
            <label className="cell-sub">Hour <input className="range" type="range" min="6" max="18" step="0.25" value={hour} onChange={(e) => setHour(Number(e.target.value))} /></label>
          </>
        )}
        {heatmapOn && (
          <div className="pv-legend" title="Solar access">
            <span>0.7</span>
            <div />
            <span>1.0</span>
          </div>
        )}
      </div>

      <div className={`pv-grid ${viewMode === 'dual' || (show2d && show3d) ? 'pv-grid-dual' : ''}`}>
        {show2d && (
        <div className={mapClass}>
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
                attribution={layer === 'google' ? 'Google' : 'Esri'}
                url={tileUrl}
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
            {heatmapOn && (irradiance?.cells || []).filter((c) => c.lat != null).map((c, i) => {
              const rgb = accessColor(c.solar_access);
              return (
                <CircleMarker
                  key={`irr-${i}`}
                  center={[c.lat, c.lng]}
                  radius={10}
                  pathOptions={{ color: `rgb(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)})`, fillOpacity: 0.55, weight: 0 }}
                />
              );
            })}
          </MapContainer>
        </div>
        )}
        {show3d && (
          <div className="pv-map pv-3d">
            <Design3DView
              design={design}
              result={result}
              irradiance={irradiance}
              heatmapOn={heatmapOn}
              sunOn={sunOn}
              day={day}
              hour={hour}
              zoom={design.location?.zoom || 19}
              onOrbit={() => {
                if (viewMode === '2d') setViewMode('dual');
              }}
            />
          </div>
        )}

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
            <>
              <div className="pv-home">
                <div className="pv-home-h">Home Summary</div>
                {gen?.generated_at && <div className="cell-sub">Last updated {timeAgo(gen.generated_at)}</div>}
                <Row k="Annual Generation" v={gen ? `${gen.annual_mwh} MWh` : '—'} />
                <Row k="Spec Gen" v={gen ? `${gen.spec_gen} kWh/kWp/yr` : '—'} />
                <Row k="Performance Ratio" v={gen ? `${gen.performance_ratio}%` : '—'} />
                <Row k="Energy Offset" v={gen ? `${gen.energy_offset_pct}%` : '—'} />
                <Row k="Source" v={gen?.source || '—'} />
              </div>
              {gen && (
                <div style={{ height: 170, margin: '8px 0 12px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="month" fontSize={10} />
                      <YAxis fontSize={10} />
                      <RTooltip />
                      <Bar dataKey="gen" fill="#15803d" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="load" fill="#94a3b8" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {!prod && !gen ? <p className="muted">Trace a roof, then Calculate Generation.</p> : prod && (
                <>
                  <Row k="Year-1 (layout)" v={`${num(prod.year1_kwh)} kWh`} />
                  <Row k="GHI" v={`${result.climate.ghi_annual} kWh/m²`} />
                  <h4>Loss tree</h4>
                  {Object.entries(result.losses || {}).filter(([k]) => k !== 'pr').map(([k, v]) => (
                    <div className="pv-loss" key={k}>
                      <span>{k}</span>
                      <div className="pv-track"><div style={{ width: `${Math.min(v * 4, 100)}%` }} /></div>
                      <span>{v}%</span>
                    </div>
                  ))}
                </>
              )}
            </>
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
