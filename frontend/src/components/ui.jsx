import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/* ---------------- Icons (inline SVG, 24px stroke) ---------------- */
const S = {
  stroke: 'currentColor',
  strokeWidth: 2,
  fill: 'none',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function Icon({ name, size = 18, ...rest }) {
  const paths = {
    dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
    leads: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
    survey: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>,
    proposal: <><path d="M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7l7-4Z" /><path d="M9 12l2 2 4-4" /></>,
    project: <><path d="M3 3h7v7H3z" /><path d="M14 3h7v7h-7z" /><path d="M14 14h7v7h-7z" /><path d="M3 14h7v7H3z" /></>,
    subsidy: <><path d="M12 2v20" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>,
    billing: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /><path d="M6 15h4" /></>,
    service: <><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></>,
    search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />,
    whatsapp: <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />,
    mail: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" /></>,
    map: <><path d="M9 4 1 7v13l8-3 6 3 8-3V4l-8 3-6-3Z" /><path d="M9 4v13" /><path d="M15 7v13" /></>,
    cal: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></>,
    chev: <path d="m9 18 6-6-6-6" />,
    chevD: <path d="m6 9 6 6 6-6" />,
    dots: <><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></>,
    edit: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></>,
    trash: <><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
    x: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></>,
    check: <path d="M20 6 9 17l-5-5" />,
    alert: <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
    camera: <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>,
    loc: <><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>,
    gantt: <><path d="M3 6h18" /><path d="M3 12h18" /><path d="M3 18h18" /><path d="M6 3v6" /><path d="M12 9v6" /><path d="M18 15v6" /></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
    send: <path d="m22 2-7 20-4-9-9-4 20-7Z" />,
    refresh: <><path d="M23 4v6h-6" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>,
    bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
    sun: <><circle cx="12" cy="12" r="5" /><path d="M12 1v2" /><path d="M12 21v2" /><path d="m4.22 4.22 1.42 1.42" /><path d="m18.36 18.36 1.42 1.42" /><path d="M1 12h2" /><path d="M21 12h2" /><path d="m4.22 19.78 1.42-1.42" /><path d="m18.36 5.64 1.42-1.42" /></>,
    filter: <><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" /></>,
    table: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" /><path d="M12 3v18" /></>,
    inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>,
    users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
    wrench: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />,
    up: <><path d="m18 15-6-6-6 6" /></>,
    down: <><path d="m6 9 6 6 6-6" /></>,
    link: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ flexShrink: 0 }}
      {...S}
      {...rest}
      aria-hidden="true"
    >
      {paths[name] || paths.check}
    </svg>
  );
}

/* ---------------- Stage badge ---------------- */
export function StageBadge({ stage, noDot }) {
  const color = { sky: 'badge-sky', violet: 'badge-violet', amber: 'badge-amber', teal: 'badge-teal', green: 'badge-green', slate: 'badge-slate', crimson: 'badge-crimson' }[stage?.color || 'slate'];
  return <span className={`badge ${color} ${noDot ? 'no-dot' : ''}`}>{stage?.label || stage?.key || stage}</span>;
}

export function Badge({ tone = 'slate', children, noDot }) {
  return <span className={`badge badge-${tone} ${noDot ? 'no-dot' : ''}`}>{children}</span>;
}

export function StatusBadge({ status }) {
  const tones = {
    'New': 'sky', 'Contacted': 'violet', 'Survey Scheduled': 'amber', 'Survey Done': 'teal',
    'Proposal Sent': 'amber', 'Negotiation': 'violet', 'Won': 'green', 'Lost': 'slate',
    'Open': 'crimson', 'In Progress': 'amber', 'Resolved': 'green',
    'Paid': 'green', 'Due': 'amber', 'Overdue': 'crimson', 'Disbursed': 'green',
    'Delivered': 'green', 'Active': 'green', 'Completed': 'green',
  };
  return <Badge tone={tones[status] || 'slate'}>{status}</Badge>;
}

/* ---------------- Avatar ---------------- */
export function Avatar({ name, className = '' }) {
  const initials = (name || '')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return <span className={`avatar ${className}`}>{initials}</span>;
}

/* ---------------- Card ---------------- */
export function Card({ title, subtitle, action, children, bodyClass = '', className = '', pad = true }) {
  return (
    <div className={`card ${className}`}>
      {(title || action) && (
        <div className="card-header">
          <div>
            <h3>{title}</h3>
            {subtitle && <div className="card-subtitle">{subtitle}</div>}
          </div>
          {action}
        </div>
      )}
      <div className={pad ? `card-body ${bodyClass}` : bodyClass}>{children}</div>
    </div>
  );
}

/* ---------------- Modal ---------------- */
export function Modal({ open, onClose, title, children, footer, wide }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------------- Drawer ---------------- */
export function Drawer({ open, onClose, title, children, width = 480 }) {
  if (!open) return null;
  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer" style={{ width }}>
        <div className="drawer-head">
          <h3 style={{ fontSize: 15.5, fontWeight: 700 }}>{title}</h3>
          <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </>
  );
}

/* ---------------- Toasts ---------------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, tone = 'success') => {
    const id = Date.now() + Math.random().toString(36).slice(2, 6);
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <Icon name={t.tone === 'error' ? 'alert' : 'check'} size={16} />
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------------- Heat dots ---------------- */
export function HeatDots({ priority }) {
  const order = ['hot', 'warm', 'cold'];
  const idx = order.indexOf(priority);
  return (
    <span className="heat-dots" title={`${priority} lead`}>
      {order.map((p, i) => (
        <span key={p} className={`heat-dot ${i <= idx ? p : ''}`} />
      ))}
    </span>
  );
}

/* ---------------- Misc helpers ---------------- */
export function ProgressBar({ pct, tone = '' }) {
  const cls = pct >= 90 ? 'amber' : pct >= 100 ? 'crimson' : tone;
  return (
    <div className="progress">
      <div className={cls} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

export function EmptyState({ icon = 'inbox', title, sub }) {
  return (
    <div className="empty-state">
      <div className="big"><Icon name={icon} size={40} /></div>
      <strong>{title}</strong>
      {sub && <div style={{ marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export function useEscape(handler, active = true) {
  useEffect(() => {
    if (!active) return;
    const fn = (e) => e.key === 'Escape' && handler();
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [handler, active]);
}

export function useScrollLock(active = false) {
  useEffect(() => {
    if (!active) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [active]);
}
