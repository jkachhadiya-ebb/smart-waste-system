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

export function fetchTrucks(params = {}, config = {}) {
  return api.get('/trucks', mergeConfig(params, config));
}

export function fetchTruckById(id, config = {}) {
  return api.get(`/trucks/${id}`, config);
}

export function createTruck(payload, config = {}) {
  return api.post('/trucks', payload, config);
}

export function updateTruck(id, payload, config = {}) {
  return api.put(`/trucks/${id}`, payload, config);
}

export function deleteTruck(id, config = {}) {
  return api.delete(`/trucks/${id}`, config);
}

export function fetchTruckTelemetryLatest(id, config = {}) {
  return api.get(`/trucks/${id}/telemetry/latest`, config);
}

export function fetchTruckTelemetryWindow(id, minutes = 60, config = {}) {
  return api.get(`/trucks/${id}/telemetry`, mergeConfig({ minutes }, config));
}

export function fetchTruckTrips(id, params = {}, config = {}) {
  return api.get(`/trucks/${id}/trips`, mergeConfig(params, config));
}

export function fetchTruckEmissions(id, params = {}, config = {}) {
  return api.get(`/trucks/${id}/emissions`, mergeConfig(params, config));
}

export function fetchTruckWasteLoadEvents(id, params = {}, config = {}) {
  return api.get(`/trucks/${id}/waste-load-events`, mergeConfig(params, config));
}

export function fetchTruckRental(id, config = {}) {
  return api.get(`/trucks/${id}/rental`, config);
}

export function fetchFleetEmissionsSummary(params = {}, config = {}) {
  return api.get('/trucks/emissions/summary', mergeConfig(params, config));
}

// Optional helper - only use if a municipalities endpoint exists.
export function fetchMunicipalities(config = {}) {
  return api.get('/municipalities', config);
}
