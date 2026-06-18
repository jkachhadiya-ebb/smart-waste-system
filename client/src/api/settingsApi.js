import api from './index';

export function fetchProfile() {
  return api.get('/settings/profile');
}

export function updateProfile(payload) {
  return api.post('/settings/profile', payload);
}

export function uploadProfileLogo(file) {
  const formData = new FormData();
  formData.append('logo', file);
  return api.post('/settings/profile/logo', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

export function fetchGeneral() {
  return api.get('/settings/general');
}

export function fetchLanguages() {
  return api.get('/settings/languages');
}

export function saveGeneralSettings(payload) {
  return api.post('/settings/general', payload);
}

export function resetGeneralSettings() {
  return api.post('/settings/general/reset');
}

export function saveMunicipalityDefaults(payload) {
  return api.post('/settings/general/municipality-defaults', payload);
}

export function fetchNotifications() {
  return api.get('/settings/notifications');
}

export function saveNotifications(payload) {
  return api.post('/settings/notifications', payload);
}

export function fetchSessions() {
  return api.get('/settings/security/sessions');
}

export function logoutThisSession() {
  return api.post('/settings/security/logout-this');
}

export function logoutAllSessions() {
  return api.post('/settings/security/logout-all');
}

export function changePassword(payload) {
  return api.post('/settings/security/change-password', payload);
}

export function fetch2faSetup() {
  return api.get('/settings/security/2fa/setup');
}

export function verify2fa(code) {
  return api.post('/settings/security/2fa/verify', { code });
}

export function disable2fa(payload) {
  return api.post('/settings/security/2fa/disable', payload);
}
