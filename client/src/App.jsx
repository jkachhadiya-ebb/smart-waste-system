// App.jsx
import { Routes, Route, Navigate } from 'react-router-dom';
import { useContext, useEffect, useState } from 'react';
import { AuthContext } from './context/AuthContext.jsx';
import { useTranslation } from 'react-i18next';
import { normalizeLanguageCode } from './i18n/normalizeLanguage.js';
import Sidebar from './components/Sidebar.jsx';
import Header from './components/Header.jsx';

import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Reports from './pages/Reports.jsx';
import Trucks from './pages/Trucks.jsx';
import Disposal from './pages/Disposal.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import HelpCenter from './pages/HelpCenter.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';

function ProtectedLayout() {
  // ❶ Sidebar collapse state lives here
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

  const handleToggleSidebar = () => {
    setSidebarCollapsed(prev => !prev);
  };

  return (
    <div className="app-root">
      {/* ❷ Pass toggle + state to Header */}
      <Header collapsed={sidebarCollapsed} onToggle={handleToggleSidebar} />

      <div className="layout">
        {/* ❸ Pass state to Sidebar */}
        <Sidebar collapsed={sidebarCollapsed} />
        <div className="content">
          <Routes>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/trucks" element={<Trucks />} />
            <Route path="/disposal" element={<Disposal />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/help-center" element={<HelpCenter />} />
            <Route path="*" element={<Navigate to="/dashboard" />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { user } = useContext(AuthContext);
  const { t, i18n } = useTranslation();

  useEffect(() => {
    document.title = t('Smart Waste System');
    const lang = normalizeLanguageCode(i18n.language) || 'en';
    document.documentElement.lang = lang;
  }, [i18n.language, t]);

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/dashboard" /> : <Login />}
      />
      <Route
        path="/forgot-password"
        element={user ? <Navigate to="/dashboard" /> : <ForgotPassword />}
      />
      <Route
        path="/reset-password"
        element={user ? <Navigate to="/dashboard" /> : <ResetPassword />}
      />
      <Route
        path="/*"
        element={user ? <ProtectedLayout /> : <Navigate to="/login" />}
      />
    </Routes>
  );
}
