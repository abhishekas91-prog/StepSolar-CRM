import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, getToken } from '../lib/api';
import { formatINR, formatDate, formatNum } from '../lib/format';
import { Card, Badge, Modal, useToast } from '../components/ui';
import Design3DView from '../components/Design3DView';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function Row({ k, v }) {
  return (
    <div className="pv-kv"><span>{k}</span><b>{v}</b></div>
  );
}

async function downloadPdf(path, filename) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { headers });
  if (!res.ok) throw new Error('PDF download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DocumentProposal() {
  const { designId } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [proposal, setProposal] = useState(null);
  const [design, setDesign] = useState(null);
  const [busy, setBusy] = useState(false);
  const [modify, setModify] = useState(false);
  const [customize, setCustomize] = useState(false);
  const [financeOpen, setFinanceOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [brand, setBrand] = useState({ company: '', primary: '#166534', accent: '#15803d', sections_enabled: {} });
  const [financeForm, setFinanceForm] = useState({ name: '', phone: '', note: '' });

  const load = async () => {
    const d = await api.getDesign(designId);
    setDesign(d);
    try {
      const p = await api.getProposal(designId);
      setProposal(p);
      setItems((p.pricing?.items || []).map((it) => ({ ...it })));
      setBrand({
        company: p.branding?.company || 'STEP SOLAR ENERGY PVT. LTD.',
        primary: p.branding?.primary || '#166534',
        accent: p.branding?.accent || '#15803d',
        sections_enabled: { ...(p.branding?.sections_enabled || {}) },
      });
    } catch (_) {
      setProposal(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (e) {
        if (!cancelled) toast(e.message || 'Design not found', 'error');
      }
    })();
    return () => { cancelled = true; };
  }, [designId]);

  const generate = async () => {
    setBusy(true);
    try {
      const p = await api.generateProposal(designId, {});
      setProposal(p);
      setItems((p.pricing?.items || []).map((it) => ({ ...it })));
      toast('Proposal generated');
    } catch (e) {
      toast(e.message || 'Generate failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const savePricing = async () => {
    setBusy(true);
    try {
      const p = await api.patchProposal(designId, {
        items: items.map((it) => ({
          sku: it.sku,
          category: it.category,
          qty: Number(it.qty || 1),
          unit: it.unit || 'set',
          unit_cost: Number(it.unit_cost || 0),
        })),
      });
      setProposal(p);
      setModify(false);
      toast('Pricing updated');
    } catch (e) {
      toast(e.message || 'Save failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveBrand = async () => {
    setBusy(true);
    try {
      const p = await api.patchProposal(designId, { branding: brand });
      setProposal(p);
      setCustomize(false);
      toast('Branding saved');
    } catch (e) {
      toast(e.message || 'Save failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const shareWhatsapp = async () => {
    setBusy(true);
    try {
      const r = await api.shareProposal(designId);
      const url = window.location.origin + (r.public_url || proposal?.public_url || '');
      const text = encodeURIComponent(`Step Solar rooftop proposal: ${url}`);
      window.open(`https://wa.me/?text=${text}`, '_blank');
      toast(r.whatsapp?.ok ? 'WhatsApp notified' : 'Share link ready');
    } catch (e) {
      toast(e.message || 'Share failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const emailShare = () => {
    const url = window.location.origin + (proposal?.public_url || '');
    window.location.href = `mailto:?subject=${encodeURIComponent('Solar proposal')}&body=${encodeURIComponent(url)}`;
  };

  const publicAbs = proposal?.public_url ? `${window.location.origin}${proposal.public_url.startsWith('/') ? '' : '/'}${proposal.public_url.replace(/^#/, '#')}` : '';
  const sharePath = proposal?.public_token ? `${window.location.origin}/#/p/${proposal.public_token}` : publicAbs;
  const qrSrc = sharePath ? `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(sharePath)}` : '';

  const monthly = useMemo(() => {
    const fin = proposal?.finance || {};
    return (fin.months || MONTHS).map((m, i) => ({ month: m, gen: Number(fin.monthly_kwh?.[i] || 0) }));
  }, [proposal]);

  const yearly = useMemo(() => {
    return (proposal?.finance?.cashflows || []).filter((c) => [1, 5, 10, 15, 20, 25].includes(c.year)).map((c) => ({
      year: `Y${c.year}`,
      savings: c.cumulative,
    }));
  }, [proposal]);

  const sys = proposal?.system || {};
  const sections = proposal?.branding?.sections_enabled || {};

  if (!design) return <div className="empty-state"><strong>Loading proposal…</strong></div>;

  return (
    <div className="prop-page">
      <div className="filter-bar card" style={{ marginBottom: 16 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => nav(`/design/${designId}`)}>Back to studio</button>
        {design.solar_project_id && <button className="btn btn-outline btn-sm" onClick={() => nav(`/pv-projects/${design.solar_project_id}`)}>Project</button>}
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={generate}>{busy ? 'Working…' : proposal ? 'Regenerate' : 'Generate proposal'}</button>
      </div>

      {!proposal ? (
        <Card title="Design proposal" subtitle="Calculate generation in studio, then generate a customer PDF / share link">
          <p className="muted">No proposal yet for this design.</p>
        </Card>
      ) : (
        <div className="prop-grid">
          <div>
            <Card>
              <div className="prop-hero">
                <img src="/step-solar-logo.png" alt="Step Solar" className="prop-logo" />
                <div>
                  <div className="cell-sub">Prepared for</div>
                  <h2 style={{ margin: '2px 0 6px' }}>{sys.client_name || design.name}</h2>
                  <div className="cell-sub">{sys.address || design.address}</div>
                  <div className="cell-sub">{sys.dc_kw} kWp · {sys.lat}, {sys.lng} · {formatDate(proposal.generated_at)}</div>
                </div>
                <div className="prop-qr">
                  {qrSrc && <img src={qrSrc} alt="QR" width="96" height="96" />}
                  <button className="btn btn-outline btn-sm" onClick={() => nav(`/p/${proposal.public_token}?preview=1`)}>View 3D Model</button>
                </div>
              </div>
            </Card>

            {sections.overview !== false && (
              <Card title="Company Overview" subtitle="Step Solar Energy Pvt. Ltd.">
                <p>Grid-tied rooftop solar design, supply and installation. GSTIN 09ABPCS3779K1ZC · Dumri Padaw, Varanasi.</p>
              </Card>
            )}

            {sections.design !== false && (
              <Card title="System design">
                <div className="prop-3d">
                  <Design3DView design={design} result={design.result} irradiance={null} heatmapOn={false} sunOn={false} day={172} hour={12} zoom={design.location?.zoom || 19} />
                </div>
              </Card>
            )}

            {sections.generation !== false && (
              <Card title="Monthly generation">
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthly}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="month" fontSize={10} />
                      <YAxis fontSize={10} />
                      <Tooltip />
                      <Bar dataKey="gen" fill="#15803d" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <Row k="Year-1" v={`${formatNum(Math.round(proposal.finance?.year1_kwh || 0))} kWh`} />
                <Row k="Energy offset" v={`${proposal.finance?.energy_offset_pct || 0}%`} />
              </Card>
            )}

            {sections.savings !== false && (
              <Card title="25-year savings">
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={yearly}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="year" fontSize={10} />
                      <YAxis fontSize={10} />
                      <Tooltip />
                      <Bar dataKey="savings" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <Row k="Total savings" v={formatINR(proposal.finance?.total_savings_25)} />
                <Row k="IRR" v={proposal.finance?.irr != null ? `${(proposal.finance.irr * 100).toFixed(1)}%` : '—'} />
              </Card>
            )}

            {sections.bom !== false && (
              <Card title="Equipment / BOM">
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th>Item</th><th>Qty</th><th>Amount</th></tr></thead>
                    <tbody>
                      {(proposal.pricing?.items || []).map((it, i) => (
                        <tr key={i}><td>{it.sku}</td><td>{it.qty} {it.unit}</td><td>{formatINR(it.total)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {sections.warranty !== false && (
              <Card title="Warranty">
                <ul className="prop-list">{(proposal.warranty || []).map((w) => <li key={w}>{w}</li>)}</ul>
              </Card>
            )}
            {sections.terms !== false && (
              <Card title="Terms & conditions">
                <ol className="prop-list">{(proposal.terms || []).map((t) => <li key={t}>{t}</li>)}</ol>
              </Card>
            )}
            {sections.payment !== false && (
              <Card title="Payment schedule">
                {(proposal.payment_schedule || []).map((p) => (
                  <Row key={p.milestone} k={p.milestone} v={`${p.pct}%`} />
                ))}
              </Card>
            )}
          </div>

          <aside>
            <Card title="Proposal Summary">
              <Row k="Total System Price" v={formatINR(proposal.pricing?.total)} />
              <Row k="Incentives" v={formatINR(proposal.subsidy?.amount)} />
              <Row k="Price post incentives" v={formatINR(proposal.finance?.net_capex)} />
              <Row k="Payback" v={`${proposal.finance?.payback_years ?? '—'} yr`} />
              <p className="muted" style={{ marginTop: 8 }}>Modelled savings. MNRE / DISCOM eligibility applies. GST extra as applicable.</p>
              <Badge tone="green">{proposal.subsidy?.scheme || 'PM Surya Ghar'}</Badge>
            </Card>
            <div className="prop-actions">
              <button className="btn btn-primary" onClick={() => setFinanceOpen(true)}>Get Solar Financing</button>
              <button className="btn btn-outline" onClick={() => setModify(true)}>Modify Proposal</button>
              <button className="btn btn-outline" onClick={() => setCustomize(true)}>Customize Proposal</button>
              <button className="btn btn-outline" onClick={() => downloadPdf(`/crm/designs/${designId}/proposal.pdf`, 'proposal.pdf').catch((e) => toast(e.message, 'error'))}>Download PDF</button>
              <button className="btn btn-outline" onClick={shareWhatsapp}>WhatsApp share</button>
              <button className="btn btn-outline" onClick={emailShare}>Email link</button>
            </div>
            <p className="cell-sub" style={{ marginTop: 8 }}>Public: {sharePath}</p>
          </aside>
        </div>
      )}

      <Modal open={modify} onClose={() => setModify(false)} title="Modify pricing" wide footer={
        <>
          <button className="btn btn-outline" onClick={() => setModify(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={savePricing}>Save</button>
        </>
      }>
        {(items || []).map((it, i) => (
          <div key={i} className="form-grid" style={{ marginBottom: 8 }}>
            <div className="field"><label>Item</label><input className="input" value={it.sku} onChange={(e) => setItems((rows) => rows.map((r, j) => j === i ? { ...r, sku: e.target.value } : r))} /></div>
            <div className="field"><label>Unit cost</label><input className="input" type="number" value={it.unit_cost} onChange={(e) => setItems((rows) => rows.map((r, j) => j === i ? { ...r, unit_cost: Number(e.target.value) } : r))} /></div>
          </div>
        ))}
      </Modal>

      <Modal open={customize} onClose={() => setCustomize(false)} title="Customize proposal" footer={
        <>
          <button className="btn btn-outline" onClick={() => setCustomize(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={saveBrand}>Save</button>
        </>
      }>
        <div className="field"><label>Company</label><input className="input" value={brand.company} onChange={(e) => setBrand((b) => ({ ...b, company: e.target.value }))} /></div>
        <div className="form-grid">
          <div className="field"><label>Primary</label><input className="input" value={brand.primary} onChange={(e) => setBrand((b) => ({ ...b, primary: e.target.value }))} /></div>
          <div className="field"><label>Accent</label><input className="input" value={brand.accent} onChange={(e) => setBrand((b) => ({ ...b, accent: e.target.value }))} /></div>
        </div>
        {Object.keys(brand.sections_enabled || {}).map((k) => (
          <label key={k} className="cell-sub" style={{ display: 'flex', gap: 8, margin: '6px 0' }}>
            <input type="checkbox" checked={brand.sections_enabled[k] !== false} onChange={(e) => setBrand((b) => ({ ...b, sections_enabled: { ...b.sections_enabled, [k]: e.target.checked } }))} />
            {k}
          </label>
        ))}
      </Modal>

      <Modal open={financeOpen} onClose={() => setFinanceOpen(false)} title="Get Solar Financing" footer={
        <>
          <button className="btn btn-outline" onClick={() => setFinanceOpen(false)}>Close</button>
          <button className="btn btn-primary" onClick={() => { toast('Financing request noted'); setFinanceOpen(false); }}>Submit</button>
        </>
      }>
        <p className="muted">{proposal?.financing?.note || 'Partner bank / NBFC application.'}</p>
        <div className="field"><label>Name</label><input className="input" value={financeForm.name} onChange={(e) => setFinanceForm((f) => ({ ...f, name: e.target.value }))} /></div>
        <div className="field"><label>Phone</label><input className="input" value={financeForm.phone} onChange={(e) => setFinanceForm((f) => ({ ...f, phone: e.target.value }))} /></div>
        {proposal?.financing?.url && <a className="btn btn-outline" href={proposal.financing.url} target="_blank" rel="noreferrer">Open partner link</a>}
      </Modal>
    </div>
  );
}

export function PublicProposal() {
  const { token } = useParams();
  const [bundle, setBundle] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.publicProposal(token)
      .then((d) => { if (!cancelled) setBundle(d); })
      .catch((e) => { if (!cancelled) setErr(e.message || 'Not found'); });
    return () => { cancelled = true; };
  }, [token]);

  if (err) return <div className="empty-state"><strong>{err}</strong></div>;
  if (!bundle) return <div className="empty-state"><strong>Loading…</strong></div>;
  const p = bundle.proposal || {};
  const d = bundle.design || {};
  const sys = p.system || {};
  return (
    <div className="prop-page" style={{ maxWidth: 960, margin: '24px auto', padding: 16 }}>
      <Card>
        <h2 style={{ marginTop: 0 }}>{sys.name || d.name}</h2>
        <div className="cell-sub">{sys.address} · {sys.dc_kw} kWp</div>
        <Row k="Price post incentives" v={formatINR(p.finance?.net_capex)} />
        <Row k="Payback" v={`${p.finance?.payback_years ?? '—'} yr`} />
        <Row k="Year-1 generation" v={`${formatNum(Math.round(p.finance?.year1_kwh || 0))} kWh`} />
      </Card>
      <div className="prop-3d" style={{ height: 360, marginTop: 12 }}>
        <Design3DView design={d} result={d.result} irradiance={null} heatmapOn={false} sunOn={false} day={172} hour={12} zoom={19} />
      </div>
      <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => { window.location.href = `/api/public/proposal/${token}/pdf`; }}>Download PDF</button>
    </div>
  );
}
