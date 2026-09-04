import api from './index';

function mergeConfig(params = {}, config = {}) {
  return {
    ...(config || {}),
    params: {
      ...((config && config.params) || {}),
      ...(params || {}),
    },
  };
}

export function fetchDisposalDashboard(params = {}, config = {}) {
  return api.get('/disposal/dashboard', mergeConfig(params, config));
}

export function createDisposalEvent(payload = {}, config = {}) {
  return api.post('/disposal/events', payload, config);
}
