import { io } from 'socket.io-client';
import api from '../api';

const API_BASE_URL =
  (api.defaults?.baseURL || '').replace(/\/api\/?$/, '') || 'http://localhost:5000';

let socketInstance;

export function getSettingsSocket() {
  if (!socketInstance) {
    socketInstance = io(API_BASE_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
      path: '/socket.io',
      withCredentials: true,
    });
  }
  return socketInstance;
}

export function subscribeToSettings(event, handler) {
  const socket = getSettingsSocket();
  socket.on(event, handler);
  return () => socket.off(event, handler);
}

export function disconnectSettingsSocket() {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}
