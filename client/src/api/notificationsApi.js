import api from './index';

export function fetchNotificationsFeed(params = {}) {
  return api.get('/notifications', { params });
}

export function markNotificationsRead(ids) {
  return api.post('/notifications/mark-read', { ids });
}

export function markAllNotificationsRead() {
  return api.post('/notifications/mark-all-read');
}

export function createNotification(payload) {
  return api.post('/notifications', payload);
}
