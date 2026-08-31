import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../lib/store';
import { Icon } from '../components/ui';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await login(email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Sign in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="brand-logo" style={{ width: 46, height: 46 }}>
            <Icon name="sun" size={22} />
          </span>
          <h1>Step Solar CRM</h1>
          <p>Solar pipeline · Projects · Billing · Subsidies</p>
        </div>

        <form onSubmit={submit} className="login-form">
          <div className="field">
            <label>Email</label>
            <input
              className="input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@stepsolar.in"
              autoFocus
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="login-error">
              <Icon name="alert" size={14} /> {error}
            </div>
          )}

          <button className="btn btn-primary login-btn" disabled={busy} type="submit">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="login-foot">
          <a href="/" target="_blank" rel="noreferrer">Visit public website</a>
          <span className="dot">·</span>
          <a href="/track.html" target="_blank" rel="noreferrer">Customer tracking portal</a>
        </div>
      </div>
    </div>
  );
}
