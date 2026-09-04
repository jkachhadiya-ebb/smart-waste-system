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

export function fetchReportsEmissions(params = {}, config = {}) {
  return api.get('/reports/emissions', mergeConfig(params, config));
}

export function fetchReportMunicipalities(config = {}) {
  return api.get('/reports/municipalities', config);
}
