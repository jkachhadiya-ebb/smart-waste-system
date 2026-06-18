import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { NotificationsProvider } from './context/NotificationsContext.jsx';
import { Toaster } from 'react-hot-toast';
import './styles/styles.css';
import { initI18n } from './i18n/index.js';
import ErrorBoundary from './components/ErrorBoundary.jsx';

const rootEl = document.getElementById('root');
const root = rootEl ? ReactDOM.createRoot(rootEl) : null;
let hasRendered = false;

function renderApp() {
  if (!root || hasRendered) return;
  hasRendered = true;
  root.render(
    <React.StrictMode>
      <BrowserRouter basename={import.meta.env?.BASE_URL || '/'}>
        <AuthProvider>
          <ThemeProvider>
            <NotificationsProvider>
              <ErrorBoundary>
                <App />
              </ErrorBoundary>
              <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
            </NotificationsProvider>
          </ThemeProvider>
        </AuthProvider>
      </BrowserRouter>
    </React.StrictMode>
  );
}

// Initialize i18n and then render the app
initI18n()
  .then(() => {
    renderApp();
  })
  .catch((err) => {
    console.error('i18n init failed; continuing with defaults', err);
    renderApp();
  });
