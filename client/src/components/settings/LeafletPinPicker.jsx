import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-defaulticon-compatibility';
import 'leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css';
import L from 'leaflet';

function escapeHtmlAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function MapAutoCenter({ position }) {
  const map = useMap();

  useEffect(() => {
    if (!map || !position) return;
    map.setView([position.lat, position.lng], map.getZoom(), { animate: true });
  }, [map, position]);

  return null;
}

export default function LeafletPinPicker({
  position,
  onChange,
  editable = false,
  fallbackPosition = { lat: 50.39, lng: 7.59 },
  height = 280,
  markerIconUrl,
}) {
  const center = position ?? fallbackPosition;
  const pinIcon = useMemo(() => {
    const url = String(markerIconUrl || '').trim();
    if (!url) return null;
    const safeUrl = escapeHtmlAttribute(url);
    return L.divIcon({
      className: 'logo-pin-icon',
      html: `
        <div class="logo-pin">
          <div class="logo-pin__img-wrap">
            <img src="${safeUrl}" alt="" class="logo-pin__img" />
          </div>
          <span class="logo-pin__tip"></span>
        </div>
      `,
      iconSize: [48, 60],
      iconAnchor: [24, 58],
      popupAnchor: [0, -52],
    });
  }, [markerIconUrl]);

  return (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={12}
      style={{ height, width: '100%' }}
      className="rounded-xl overflow-hidden border border-slate-200"
      scrollWheelZoom={false}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <MapAutoCenter position={position ?? fallbackPosition} />
      <Marker
        position={[center.lat, center.lng]}
        draggable={editable}
        {...(pinIcon ? { icon: pinIcon } : {})}
        eventHandlers={{
          dragend: (event) => {
            if (!onChange) return;
            const { lat, lng } = event.target.getLatLng();
            onChange({ lat, lng });
          },
        }}
      />
    </MapContainer>
  );
}
