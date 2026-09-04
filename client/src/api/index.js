import axios from 'axios';

// Prefer explicit env override; otherwise default to backend on :5000
const envBase = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_API_BASE_URL : null;
const baseURL = envBase || 'http://localhost:5000/api';

const api = axios.create({
  baseURL,
});

function safeGetToken() {
  try {
    return localStorage.getItem('token');
  } catch (err) {
    console.warn('Unable to access token storage', err);
    return null;
  }
}

function safeClearSession() {
  try {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
  } catch (err) {
    console.warn('Unable to clear session storage', err);
  }
}

// Always attach bearer token (if present) to every request
api.interceptors.request.use((config) => {
  const token = safeGetToken();
  if (token) {
    config.headers = {
      ...(config.headers || {}),
      Authorization: `Bearer ${token}`
    };
  }
  return config;
});

// On 401s with an existing token, clear session and send user to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const hasToken = Boolean(safeGetToken());

    if (status === 401 && hasToken) {
      safeClearSession();
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);

export default api;
