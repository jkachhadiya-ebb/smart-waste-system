// components/Sidebar.jsx
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import '../styles/Sidebar.css';

// Helper Component for the links
function SidebarLink({ to, icon, label, collapsed }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `nav-link ${isActive ? 'active' : ''}`
      }
    >
      <div className="icon-wrapper">
        {icon}
      </div>

      {!collapsed && <span className="link-text">{label}</span>}
    </NavLink>
  );
}

export default function Sidebar({ collapsed }) {
  const { t } = useTranslation();
  return (
    <div className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      {/* Spacer to keep same top spacing as before */}
      <div className="sidebar-top-spacer" />

      <nav>
        <SidebarLink
          to="/dashboard"
          icon="🏠"
          label={t('Dashboard')}
          collapsed={collapsed}
        />
        <SidebarLink
          to="/reports"
          icon="📊"
          label={t('Reports')}
          collapsed={collapsed}
        />
        <SidebarLink
          to="/trucks"
          icon="🚚"
          label={t('Trucks')}
          collapsed={collapsed}
        />
        <SidebarLink
          to="/disposal"
          icon="♻️"
          label={t('Disposal')}
          collapsed={collapsed}
        />
        <SidebarLink
          to="/settings"
          icon="⚙️"
          label={t('Settings')}
          collapsed={collapsed}
        />

        <div style={{ flex: 1 }}></div>

      </nav>
    </div>
  );
}
