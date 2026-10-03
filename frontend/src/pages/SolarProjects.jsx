import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MapContainer, TileLayer, CircleMarker, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { Card, Icon, Modal, Badge, useToast } from '../components/ui';
import { useStore } from '../lib/store';

function Recenter({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView(center, zoom || map.getZoom());
  }, [center, zoom, map]);
  return null;
}

function ClickSet({ onPick }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng);
    },
  });
  return null;
}

const PATNA = { lat: 25.5941, lng: 85.1376, zoom: 19 };

export default function SolarProjects() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const toast = useToast();
  const { leads } = useStore();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  const load = async (query) => {
    setLoading(true);
    try {
      const list = await api.solarProjects({ q: query || undefined });
      setRows(list || []);
    } catch (e) {
      toast(e.message || 'Could not load design projects', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (params.get('new') === '1' || params.get('lead')) setOpen(true);
  }, [params]);

  return (
    <div>
      <div className="filter-bar card" style={{ marginBottom: 16 }}>
        <input
          className="input"
          placeholder="Search name / code / address…"
          style={{ width: 260 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load(q)}
        />
        <button className="btn btn-ghost btn-sm" onClick={() => load(q)}>Search</button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          <Icon name="plus" size={15} /> New Design Project
        </button>
      </div>

      <Card title="Design Projects" subtitle="Arka360-style rooftop sites — separate from operations Projects" pad={false}>
        {loading ? (
          <div className="empty-state"><strong>Loading design projects…</strong></div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <div className="big"><Icon name="sun" size={40} /></div>
            <strong>No design projects yet</strong>
            <div>Create a project from an address or from a CRM lead.</div>
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setOpen(true)}>New Design Project</button>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Project</th>
                  <th>Customer / Lead</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th style={{ textAlign: 'right' }}>Open</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => navigate(`/pv-projects/${p.id}`)}>
                    <td><span className="cell-main">{p.code || '—'}</span></td>
                    <td>
                      <div className="cell-main">{p.name}</div>
                      <div className="cell-sub">{p.created_by || ''}</div>
                    </td>
                    <td>
                      <div className="cell-main">{p.customer_name || '—'}</div>
                      <div className="cell-sub">{p.lead_code || (p.lead_id ? 'Linked lead' : 'Standalone')}</div>
                    </td>
                    <td>
                      <div className="cell-main">{p.address || '—'}</div>
                      <div className="cell-sub">
                        {p.location ? `${Number(p.location.lat).toFixed(4)}, ${Number(p.location.lng).toFixed(4)}` : ''}
                      </div>
                    </td>
                    <td><Badge tone={p.status === 'draft' ? 'slate' : 'green'} noDot>{p.status || 'draft'}</Badge></td>
                    <td>{formatDate(p.updated_at)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); navigate(`/pv-projects/${p.id}`); }}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <CreateProjectModal
        open={open}
        onClose={() => setOpen(false)}
        leads={leads}
        presetLeadId={params.get('lead')}
        onCreated={(p) => {
          setOpen(false);
          toast(`${p.code} created`);
          navigate(`/pv-projects/${p.id}`);
        }}
      />
    </div>
  );
}

function CreateProjectModal({ open, onClose, leads, presetLeadId, onCreated }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState([]);
  const [draft, setDraft] = useState({
    name: '',
    address: '',
    lead_id: presetLeadId || '',
    location: { ...PATNA },
  });

  useEffect(() => {
    if (!open) return;
    const lead = (leads || []).find((l) => l.id === presetLeadId);
    setDraft({
      name: lead ? `${lead.name} rooftop` : '',
      address: lead?.address || [lead?.city, lead?.state].filter(Boolean).join(', ') || '',
      lead_id: presetLeadId || '',
      location: { ...PATNA },
    });
    setHits([]);
  }, [open, presetLeadId, leads]);

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  const search = async (value) => {
    setDraft((d) => ({ ...d, address: value }));
    if (value.length > 3) {
      const h = await api.geocodeDesign(value).catch(() => []);
      setHits(h || []);
    } else {
      setHits([]);
    }
  };

  const pickHit = (h) => {
    setDraft((d) => ({
      ...d,
      address: h.label,
      name: d.name || h.label.split(',')[0],
      location: { lat: h.lat, lng: h.lng, zoom: 19 },
    }));
    setHits([]);
  };

  const create = async () => {
    setBusy(true);
    try {
      const body = {
        name: draft.name || draft.address || 'Untitled project',
        address: draft.address,
        location: draft.location,
        lead_id: draft.lead_id || undefined,
      };
      const p = await api.createSolarProject(body);
      onCreated(p);
    } catch (e) {
      toast(e.message || 'Could not create project', 'error');
    } finally {
      setBusy(false);
    }
  };

  const loc = draft.location || PATNA;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Design Project"
      wide
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || (!draft.name && !draft.address)} onClick={create}>
            {busy ? 'Creating…' : 'Create Project'}
          </button>
        </>
      }
    >
      <div className="sp-create">
        <div>
          <div className="field">
            <label>Project name</label>
            <input className="input" value={draft.name} onChange={set('name')} placeholder="e.g. Rakesh Prasad rooftop" />
          </div>
          <div className="field">
            <label>Site address</label>
            <input
              className="input"
              value={draft.address}
              placeholder="Search society / village / pincode"
              onChange={(e) => search(e.target.value)}
            />
            {hits.length > 0 && (
              <div className="pv-hits" style={{ position: 'relative', marginTop: 6 }}>
                {hits.map((h) => (
                  <button key={h.label} type="button" onClick={() => pickHit(h)}>{h.label}</button>
                ))}
              </div>
            )}
          </div>
          <div className="field">
            <label>Create from lead (optional)</label>
            <select className="select" value={draft.lead_id} onChange={set('lead_id')}>
              <option value="">Standalone project</option>
              {(leads || []).slice(0, 400).map((l) => (
                <option key={l.id} value={l.id}>{l.code} · {l.name} · {l.city || ''}</option>
              ))}
            </select>
          </div>
          <div className="cell-sub">Click the satellite map to drop the pin. Nominatim geocode — Google Places later.</div>
        </div>
        <div className="sp-mini-map">
          {open && (
            <MapContainer center={[loc.lat, loc.lng]} zoom={loc.zoom || 18} style={{ height: '100%', width: '100%' }} maxZoom={21}>
              <TileLayer
                attribution="&copy; Esri"
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                maxNativeZoom={19}
                maxZoom={21}
              />
              <Recenter center={[loc.lat, loc.lng]} zoom={loc.zoom || 18} />
              <ClickSet onPick={(ll) => setDraft((d) => ({ ...d, location: { lat: ll.lat, lng: ll.lng, zoom: 19 } }))} />
              <CircleMarker center={[loc.lat, loc.lng]} radius={10} pathOptions={{ color: '#f59e0b', fillColor: '#16a34a', fillOpacity: 0.9 }} />
            </MapContainer>
          )}
        </div>
      </div>
    </Modal>
  );
}
