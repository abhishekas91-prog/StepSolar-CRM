import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon, Avatar, useToast } from './ui';
import { useEffect, useMemo } from 'react';
import { useStore, logout } from '../lib/store';

const NAV = [
  { group: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: 'dashboard', end: true }] },
  {
    group: 'Pipeline',
    items: [
      { to: '/leads', label: 'Leads', icon: 'leads' },
      { to: '/survey', label: 'Site Surveys', icon: 'survey' },
      { to: '/proposal', label: 'Proposals', icon: 'proposal' },
    ],
  },
  {
    group: 'Operations',
    items: [
      { to: '/projects', label: 'Projects', icon: 'project' },
      { to: '/subsidies', label: 'Subsidy Desk', icon: 'subsidy' },
    ],
  },
  {
    group: 'Finance & Support',
    items: [
      { to: '/billing', label: 'Billing & Receivables', icon: 'billing' },
      { to: '/service', label: 'Service Desk', icon: 'service' },
    ],
  },
  {
    group: 'Documents',
    items: [
      { to: '/create-document', label: 'Create Document', icon: 'file' },
      { to: '/letterhead', label: 'Letterhead', icon: 'edit' },
    ],
  },
];

const TITLES = {
  '/': { title: 'Executive Dashboard', sub: 'Real-time overview of the entire business' },
  '/leads': { title: 'Leads Management', sub: 'Full sales pipeline — table & kanban' },
  '/survey': { title: 'Site Survey Desk', sub: 'Field survey & roof assessment engine' },
  '/proposal': { title: 'Proposal & Quotation', sub: 'BOM, costing, subsidy & payment plans' },
  '/projects': { title: 'Project Operations', sub: 'Execution tracking across the pipeline' },
  '/subsidies': { title: 'Subsidy & DISCOM Desk', sub: 'Regulatory compliance pipeline' },
  '/billing': { title: 'Billing & Receivables', sub: 'Milestone invoices & payment logging' },
  '/service': { title: 'After-Sales & Field Desk', sub: 'Open tasks, dispatch & maintenance' },
  '/create-document': { title: 'Create Document', sub: 'Manually create Tax Invoice, Quotation, Receipt or Commercial Quotation' },
  '/letterhead': { title: 'Letterhead', sub: 'Write, save, print & download official letters on A4 letterhead' },
};

export default function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const { user, leads } = useStore();

  useEffect(() => {
    const t = setTimeout(() => {
      const openTasks = leads.reduce((a, l) => a + (l.tasks || []).filter((t) => t.status !== 'done').length, 0);
      toast(`Welcome back, ${user?.full_name?.split(' ')[0] || 'Team'}! ${openTasks ? openTasks + ' open tasks across the pipeline.' : 'You are all caught up.'}`, 'amber');
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const meta = TITLES[location.pathname] || TITLES['/'];

  const subsidyBadge = useMemo(() => leads.filter((l) => !l.allCompleted && ['discom_applied', 'net_metering_pending', 'subsidy_disbursed'].includes(l.currentStageKey)).length, [leads]);
  const serviceBadge = useMemo(() => leads.reduce((a, l) => a + (l.tasks || []).filter((t) => t.status !== 'done').length, 0), [leads]);

  function signOut() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">
            <img src="/step-solar-logo.png" alt="Step Solar" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
          <div>
            <h1>Step Solar</h1>
            <small>EPC CRM & ERP</small>
          </div>
        </div>

        <nav style={{ flex: 1, paddingBottom: 16 }}>
          {NAV.map((grp) => (
            <div key={grp.group}>
              <div className="nav-group-label">{grp.group}</div>
              {grp.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                  <Icon name={item.icon} size={17} />
                  {item.label}
                  {(item.to === '/subsidies' && subsidyBadge > 0) && <span className="nav-badge">{subsidyBadge}</span>}
                  {(item.to === '/service' && serviceBadge > 0) && <span className="nav-badge">{serviceBadge}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div style={{ padding: 16, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar name={user?.full_name || 'U'} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ color: '#fff', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.full_name || 'User'}</div>
              <div style={{ fontSize: 11, color: 'var(--slate-400)' }}>{user?.role || '—'}</div>
            </div>
            <button className="icon-btn" title="Sign out" onClick={signOut} style={{ color: 'var(--slate-400)' }}>
              <Icon name="logout" size={15} />
            </button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-title">
            <h2>{meta.title}</h2>
            <p>{meta.sub}</p>
          </div>
          <div className="topbar-spacer" />
          <a className="btn btn-ghost btn-sm" href="/track.html" target="_blank" rel="noreferrer">
            <Icon name="link" size={13} /> Tracking Portal
          </a>
          <a className="btn btn-ghost btn-sm" href="/" target="_blank" rel="noreferrer">
            <Icon name="map" size={13} /> Website
          </a>
          <button className="icon-btn" title="Notifications" style={{ position: 'relative' }}>
            <Icon name="bell" size={17} />
            {serviceBadge > 0 && (
              <span style={{ position: 'absolute', top: -3, right: -3, width: 15, height: 15, borderRadius: '50%', background: 'var(--crimson-600)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{serviceBadge}</span>
            )}
          </button>
          <Avatar name={user?.full_name || 'U'} className="navy" />
        </header>

        <main className="content">
          <div className="page">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
