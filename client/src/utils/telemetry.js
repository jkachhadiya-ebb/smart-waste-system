function unwrapTelemetryPayload(payload) {
  let current = payload;
  for (let i = 0; i < 3; i += 1) {
    if (current && typeof current === 'object' && 'data' in current) {
      current = current.data;
      continue;
    }
    if (current && typeof current === 'object' && 'rows' in current) {
      current = current.rows;
      continue;
    }
    break;
  }
  return current;
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function resolveTelemetryTimestamp(row) {
  return (
    row?.timestamp ??
    row?.time_stamp ??
    row?.timeStamp ??
    row?.created_at ??
    row?.createdAt ??
    row?.updated_at ??
    row?.updatedAt ??
    row?.last_seen_at ??
    row?.lastSeenAt ??
    row?.gps_time ??
    row?.gpsTime ??
    row?.device_time ??
    row?.deviceTime ??
    row?.recorded_at ??
    row?.recordedAt ??
    row?.received_at ??
    row?.receivedAt ??
    row?.time ??
    null
  );
}

export function resolveTelemetryCoords(row) {
  const lat = toNumber(
    row?.lat ?? row?.latitude ?? row?.gps_lat ?? row?.gpsLat ?? row?.lat_deg ?? row?.latDeg
  );
  const lng = toNumber(
    row?.lng ??
      row?.longitude ??
      row?.long ??
      row?.lon ??
      row?.gps_lng ??
      row?.gpsLng ??
      row?.lng_deg ??
      row?.lngDeg
  );
  if (lat === null || lng === null) return null;
  return { lat, lng };
}

export function normalizeTelemetryLatest(payload) {
  const data = unwrapTelemetryPayload(payload);
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

export function normalizeTelemetryWindow(payload) {
  const data = unwrapTelemetryPayload(payload);
  return Array.isArray(data) ? data : [];
}
