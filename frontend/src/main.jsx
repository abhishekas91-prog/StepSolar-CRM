import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import Shell from './components/Shell';
import { ToastProvider } from './components/ui';
import { getToken } from './lib/api';
import { hydrate } from './lib/store';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Leads from './pages/Leads';
import LeadProfile from './pages/LeadProfile';
import Surveys from './pages/Surveys';
import Proposals from './pages/Proposals';
import Projects from './pages/Projects';
import Subsidies from './pages/Subsidies';
import Billing from './pages/Billing';
import ServiceDesk from './pages/ServiceDesk';
import CreateDocument from './pages/CreateDocument';
import Letterhead from './pages/Letterhead';

function Boot() {
  useEffect(() => {
    if (getToken()) hydrate();
  }, []);
  return null;
}

function RequireAuth({ children }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return children;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <ToastProvider>
        <Boot />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <RequireAuth>
                <Shell />
              </RequireAuth>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/leads" element={<Leads />} />
            <Route path="/leads/:id" element={<LeadProfile />} />
            <Route path="/survey" element={<Surveys />} />
            <Route path="/proposal" element={<Proposals />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/subsidies" element={<Subsidies />} />
            <Route path="/billing" element={<Billing />} />
            <Route path="/service" element={<ServiceDesk />} />
            <Route path="/create-document" element={<CreateDocument />} />
            <Route path="/letterhead" element={<Letterhead />} />
          </Route>
        </Routes>
      </ToastProvider>
    </HashRouter>
  </React.StrictMode>,
);
