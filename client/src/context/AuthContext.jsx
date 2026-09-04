import { createContext, useState, useCallback, useEffect } from 'react';
import { disconnectSettingsSocket } from '../socket/settingsSocket.js';

export const AuthContext = createContext(null);

function isTokenExpired(token) {
  if (!token) return true;
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      window.atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const { exp } = JSON.parse(jsonPayload);
    if (!exp) return false;
    return Date.now() >= exp * 1000;
  } catch (err) {
    console.warn('Invalid token format', err);
    return true;
  }
}

function readStoredUser() {
  try {
    const token = localStorage.getItem('token');
    const username = localStorage.getItem('username');
    if (!token || isTokenExpired(token)) {
      if (token) {
        localStorage.removeItem('token');
        localStorage.removeItem('username');
      }
      return null;
    }
    return { token, username };
  } catch (err) {
    console.warn('Unable to read auth session', err);
    return null;
  }
}

function persistSession(token, username) {
  try {
    localStorage.setItem('token', token);
    localStorage.setItem('username', username);
  } catch (err) {
    console.warn('Unable to persist auth session', err);
  }
}

function clearSession() {
  try {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    disconnectSettingsSocket();
  } catch (err) {
    console.warn('Unable to clear auth session', err);
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => readStoredUser());

  const login = (token, username) => {
    persistSession(token, username);
    setUser({ token, username });
  };

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      if (isTokenExpired(user.token)) {
        logout();
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [user, logout]);

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
