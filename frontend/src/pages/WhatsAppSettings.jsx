import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { Card, Icon, Badge, useToast } from '../components/ui';

const EMPTY = {
  api_url: 'https://whatsapp.stepsolar.in/api/v1/messages',
  api_key: '',
  auth_mode: 'bearer',
  key_header: 'Authorization',
  sender_id: '',
  wacrm_base_url: 'https://whatsapp.stepsolar.in',
  wacrm_api_key: '',
};

export default function WhatsAppSettings() {
  const { user } = useStore();
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testOut, setTestOut] = useState(null);
  const isAdmin = !user || user.role === 'Admin';

  async function load() {
    const data = await api.whatsappConfig();
    setCfg(data);
    const eff = data.effective || {};
    setForm({
      api_url: eff.api_url || EMPTY.api_url,
      api_key: '',
      auth_mode: eff.auth_mode || 'bearer',
      key_header: eff.key_header || 'Authorization',
      sender_id: eff.sender_id || '',
      wacrm_base_url: eff.wacrm_base_url || EMPTY.wacrm_base_url,
      wacrm_api_key: '',
    });
  }

  useEffect(() => {
    load().catch((e) => toast(e.message || 'Config load fail', 'crimson'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function set(key) {
    return (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        api_url: form.api_url.trim(),
        auth_mode: form.auth_mode,
        key_header: form.key_header.trim() || 'Authorization',
        sender_id: form.sender_id.trim(),
        wacrm_base_url: form.wacrm_base_url.trim(),
      };
      if (form.api_key.trim()) body.api_key = form.api_key.trim();
      if (form.wacrm_api_key.trim()) body.wacrm_api_key = form.wacrm_api_key.trim();
      const data = await api.saveWhatsappConfig(body);
      setCfg(data);
      setForm((f) => ({ ...f, api_key: '', wacrm_api_key: '' }));
      toast(data.enabled ? 'WhatsApp settings saved' : 'Saved — paste a WaCRM API key to enable send', 'green');
    } catch (err) {
      toast(err.message || 'Save failed', 'crimson');
    } finally {
      setBusy(false);
    }
  }

  async function sendTest(e) {
    e.preventDefault();
    setTestOut(null);
    setBusy(true);
    try {
      const data = await api.whatsappTestSend({ phone: testPhone.trim() });
      setTestOut(data);
      toast(data.ok ? 'Test message sent' : (data.error || 'Test send failed'), data.ok ? 'green' : 'crimson');
    } catch (err) {
      setTestOut({ ok: false, error: err.message });
      toast(err.message || 'Test send failed', 'crimson');
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) return <Navigate to="/" replace />;

  const enabled = Boolean(cfg?.enabled);
  const keySet = Boolean(cfg?.effective?.api_key_set);
  const wacrmKeySet = Boolean(cfg?.effective?.wacrm_api_key_set);
  const source = cfg?.source || 'env';

  return (
    <div className="master-config-grid">
      <Card
        title="WhatsApp Business API"
        subtitle="Used for in-CRM chat via WaCrmStepSolar_Live and lifecycle messages"
      >
        <form onSubmit={save}>
          <div className="form-grid">
            <div className="field full">
              <label>Provider API URL</label>
              <input className="input" value={form.api_url} onChange={set('api_url')} placeholder={EMPTY.api_url} />
            </div>
            <div className="field full">
              <label>Provider API key {keySet ? `(saved ${cfg?.effective?.api_key_masked || '••••'})` : ''}</label>
              <input
                className="input"
                type="password"
                autoComplete="off"
                value={form.api_key}
                onChange={set('api_key')}
                placeholder={keySet ? 'Leave blank to keep the saved key' : 'wacrm_live_…'}
              />
            </div>
            <div className="field">
              <label>Key header</label>
              <input className="input" value={form.key_header} onChange={set('key_header')} />
            </div>
            <div className="field">
              <label>Auth mode</label>
              <select className="select" value={form.auth_mode} onChange={set('auth_mode')}>
                <option value="bearer">bearer</option>
                <option value="apikey">apikey</option>
                <option value="none">none</option>
              </select>
            </div>
            <div className="field full">
              <label>Sender ID</label>
              <input className="input" value={form.sender_id} onChange={set('sender_id')} placeholder="optional" />
            </div>
            <div className="field full">
              <label>WaCRM base URL</label>
              <input className="input" value={form.wacrm_base_url} onChange={set('wacrm_base_url')} placeholder={EMPTY.wacrm_base_url} />
            </div>
            <div className="field full">
              <label>WaCRM API key {wacrmKeySet ? `(saved ${cfg?.effective?.wacrm_api_key_masked || '••••'})` : ''}</label>
              <input
                className="input"
                type="password"
                autoComplete="off"
                value={form.wacrm_api_key}
                onChange={set('wacrm_api_key')}
                placeholder={wacrmKeySet || keySet ? 'Leave blank to keep / reuse provider key' : 'wacrm_live_…'}
              />
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              <Icon name="check" size={14} /> {busy ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </form>
      </Card>

      <div>
        <Card title="Status">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {enabled ? <Badge tone="green">Provider enabled</Badge> : <Badge tone="amber">Disabled</Badge>}
            <Badge tone="slate" noDot>source: {source}</Badge>
          </div>
          <p style={{ fontSize: 13, color: 'var(--slate-500)', lineHeight: 1.45 }}>
            Chat in lead profile uses the WaCRM key. Lifecycle templates use the provider API URL.
          </p>
        </Card>

        <Card title="Test send" subtitle="Phone">
          <form onSubmit={sendTest}>
            <div className="field">
              <label>Phone</label>
              <input
                className="input"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="10-digit mobile"
              />
            </div>
            <button className="btn btn-whatsapp" type="submit" disabled={busy || !testPhone.trim()}>
              <Icon name="whatsapp" size={14} /> Send test
            </button>
          </form>
          {testOut && (
            <pre style={{ marginTop: 12, fontSize: 12, whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(testOut, null, 2)}
            </pre>
          )}
        </Card>
      </div>
    </div>
  );
}
