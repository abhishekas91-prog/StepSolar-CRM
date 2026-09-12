import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Card, Icon, Badge, Modal, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { isSuperAdmin } from '../lib/auth';

const ROLES = ['Admin', 'Sales', 'Site Survey', 'Installation', 'Accounts'];

export default function MasterConfig() {
  const { user } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState('whatsapp');

  if (!isSuperAdmin(user)) return <Navigate to="/" replace />;

  return (
    <div>
      <div className="tabs" style={{ marginBottom: 18 }}>
        <button className={`tab ${tab === 'whatsapp' ? 'active' : ''}`} onClick={() => setTab('whatsapp')}>WhatsApp API</button>
        <button className={`tab ${tab === 'agents' ? 'active' : ''}`} onClick={() => setTab('agents')}>Agents</button>
      </div>
      {tab === 'whatsapp' && <WhatsAppPanel toast={toast} />}
      {tab === 'agents' && <AgentsPanel toast={toast} />}
    </div>
  );
}

function WhatsAppPanel({ toast }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState({
    api_url: '',
    api_key: '',
    key_header: 'Authorization',
    auth_mode: 'bearer',
    sender_id: '',
    wacrm_base_url: 'https://wa-crm-step-solar-live.vercel.app',
    wacrm_api_key: '',
  });
  const [testPhone, setTestPhone] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.whatsappConfig()
      .then((res) => {
        if (cancelled) return;
        setCfg(res);
        const db = res.db_config || {};
        const eff = res.effective || {};
        setForm({
          api_url: db.api_url || eff.api_url || '',
          api_key: db.api_key_set ? '••••••••' : '',
          key_header: db.key_header || 'Authorization',
          auth_mode: db.auth_mode || 'bearer',
          sender_id: db.sender_id || '',
          wacrm_base_url: db.wacrm_base_url || 'https://wa-crm-step-solar-live.vercel.app',
          wacrm_api_key: db.wacrm_api_key_set ? '••••••••' : '',
        });
      })
      .catch((e) => toast(e.message, 'error'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [toast]);

  function set(k) {
    return (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  async function save() {
    setSaving(true);
    try {
      const body = { ...form };
      if (body.api_key && body.api_key.includes('•')) delete body.api_key;
      if (body.wacrm_api_key && body.wacrm_api_key.includes('•')) delete body.wacrm_api_key;
      const res = await api.saveWhatsappConfig(body);
      setCfg(res);
      toast('WhatsApp settings saved');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function testSend() {
    if (!testPhone.trim()) {
      toast('Enter a phone number', 'error');
      return;
    }
    setTesting(true);
    try {
      const out = await api.whatsappTestSend({ phone: testPhone.trim() });
      toast(out.ok ? `Test sent to ${out.recipient}` : (out.error || 'Send failed'), out.ok ? 'success' : 'error');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <div className="empty-state"><strong>Loading WhatsApp config…</strong></div>;

  return (
    <div className="grid-2" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
      <Card title="WhatsApp Business API" subtitle="Used for in-CRM chat via WaCrmStepSolar_Live and lifecycle messages">
        <div className="field"><label>Provider API URL</label><input className="input" value={form.api_url} onChange={set('api_url')} placeholder="https://…" /></div>
        <div className="field"><label>Provider API key</label><input className="input" type="password" value={form.api_key} onChange={set('api_key')} placeholder="Leave masked to keep current" /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field"><label>Key header</label><input className="input" value={form.key_header} onChange={set('key_header')} /></div>
          <div className="field"><label>Auth mode</label>
            <select className="select" value={form.auth_mode} onChange={set('auth_mode')}>
              <option value="bearer">bearer</option>
              <option value="apikey">apikey</option>
              <option value="none">none</option>
            </select>
          </div>
        </div>
        <div className="field"><label>Sender ID</label><input className="input" value={form.sender_id} onChange={set('sender_id')} /></div>
        <hr style={{ border: 0, borderTop: '1px solid var(--slate-100)', margin: '8px 0 16px' }} />
        <div className="field"><label>WaCRM base URL</label><input className="input" value={form.wacrm_base_url} onChange={set('wacrm_base_url')} /></div>
        <div className="field"><label>WaCRM API key</label><input className="input" type="password" value={form.wacrm_api_key} onChange={set('wacrm_api_key')} placeholder="wacrm_live_…" /></div>
        <button className="btn btn-primary" onClick={save} disabled={saving}><Icon name="check" size={14} /> {saving ? 'Saving…' : 'Save settings'}</button>
      </Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card title="Status">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge tone={cfg?.enabled ? 'green' : 'slate'}>{cfg?.enabled ? 'Provider enabled' : 'Provider off'}</Badge>
            <Badge tone="slate">source: {cfg?.source || '—'}</Badge>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--slate-500)', marginTop: 10 }}>
            Chat in lead profile uses the WaCRM key. Lifecycle templates use the provider API URL.
          </div>
        </Card>
        <Card title="Test send">
          <div className="field"><label>Phone</label><input className="input" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="10-digit mobile" /></div>
          <button className="btn btn-whatsapp" onClick={testSend} disabled={testing}>
            <Icon name="whatsapp" size={14} /> {testing ? 'Sending…' : 'Send test'}
          </button>
        </Card>
      </div>
    </div>
  );
}

function AgentsPanel({ toast }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ email: '', full_name: '', role: 'Sales', temp_password: '' });

  async function load() {
    setLoading(true);
    try {
      setUsers(await api.adminUsers());
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function create() {
    if (!draft.email || !draft.full_name || !draft.temp_password) {
      toast('Fill name, email and temporary password', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.createAdminUser(draft);
      toast(`Agent ${draft.full_name} created`);
      setOpen(false);
      setDraft({ email: '', full_name: '', role: 'Sales', temp_password: '' });
      await load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(u) {
    try {
      await api.patchAdminUser(u.id, { active: !u.active });
      toast(`${u.full_name} ${u.active ? 'disabled' : 'enabled'}`);
      await load();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <Card
      title="CRM agents"
      subtitle="Create logins for Sales, Survey, Installation, Accounts and Admin"
      action={<button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}><Icon name="plus" size={13} /> New agent</button>}
      pad={false}
    >
      {loading ? (
        <div className="empty-state" style={{ padding: 24 }}><strong>Loading agents…</strong></div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th /></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="cell-main">{u.full_name}</td>
                  <td>{u.email}</td>
                  <td><Badge tone="slate" noDot>{u.role}</Badge></td>
                  <td><Badge tone={u.active ? 'green' : 'crimson'}>{u.active ? 'Active' : 'Disabled'}</Badge></td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(u)}>{u.active ? 'Disable' : 'Enable'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Create agent" footer={
        <>
          <button className="btn btn-outline" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create'}</button>
        </>
      }>
        <div className="field"><label>Full name</label><input className="input" value={draft.full_name} onChange={(e) => setDraft((d) => ({ ...d, full_name: e.target.value }))} /></div>
        <div className="field"><label>Email</label><input className="input" type="email" value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} /></div>
        <div className="field"><label>Role</label>
          <select className="select" value={draft.role} onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}>
            {ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div className="field"><label>Temporary password</label><input className="input" type="text" value={draft.temp_password} onChange={(e) => setDraft((d) => ({ ...d, temp_password: e.target.value }))} /></div>
      </Modal>
    </Card>
  );
}
