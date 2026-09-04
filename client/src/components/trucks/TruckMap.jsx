import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-defaulticon-compatibility';
import 'leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css';
import { resolveTelemetryCoords } from '../../utils/telemetry.js';

const DEFAULT_CENTER = { lat: 50.3901457, lng: 7.5943503 };

export default function TruckMap({ truck, telemetry, height = 320, title }) {
  const { t } = useTranslation();

  const coords = useMemo(() => resolveTelemetryCoords(telemetry), [telemetry]);

  const center = coords || DEFAULT_CENTER;

  const resolvedHeight = typeof height === 'number' ? height : Number(height) || 320;

  return (
    <div className="panel map-panel">
      <div className="map-title">{title || t('Live location')}</div>
      {!coords && (
        <div className="empty-state">{t('No live location available')}</div>
      )}
      {coords && (
        <MapContainer
          center={[center.lat, center.lng]}
          zoom={13}
          className="map"
          style={{ height: resolvedHeight, width: '100%' }}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <Marker position={[coords.lat, coords.lng]}>
            <Popup>
              {truck?.truck_code || t('Selected truck')}
              <br />
              {t('Lat')}: {coords.lat.toFixed(5)}, {t('Lng')}: {coords.lng.toFixed(5)}
            </Popup>
          </Marker>
        </MapContainer>
      )}
    </div>
  );
}
