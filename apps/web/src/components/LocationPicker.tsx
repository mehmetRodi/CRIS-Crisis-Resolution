import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { ReportLocation } from '@crisismap/shared';

import { resolveMapStyle } from '../lib/mapStyle';

interface LocationPickerProps {
  value: ReportLocation | null;
  onChange: (location: ReportLocation | null) => void;
}

const DEFAULT_CENTER: [number, number] = [0, 20];
const DEFAULT_ZOOM = 1.2;
const PIN_ZOOM = 15;
const MARKER_COLOR = '#2563eb';

/**
 * GPS + map-pin location input (CRIS-16). Citizens can tap "Use my location"
 * (browser Geolocation) or drop/drag a pin directly on the map; both paths
 * report through the same `onChange`. Location is always optional — an
 * emergency report must never be blocked by a denied permission or a bad fix.
 *
 * MapLibre + the free demo style (`lib/mapStyle.ts`) — no API key needed until
 * Amazon Location Service is wired (CRIS-7/CRIS-24). CRIS-13's live map has
 * its own separate copy of the same style-resolution shape; worth de-duping
 * in a follow-up ticket rather than touching CRIS-13's already-merged file here.
 */
export function LocationPicker({ value, onChange }: LocationPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  // Keeps the map's click/dragend handlers (bound once, on mount) calling the
  // latest onChange without recreating the map every time the parent re-renders.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const { url } = resolveMapStyle();
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: url,
      center: value ? [value.lng, value.lat] : DEFAULT_CENTER,
      zoom: value ? PIN_ZOOM : DEFAULT_ZOOM,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    function dropMarker(lat: number, lng: number) {
      if (markerRef.current) {
        markerRef.current.setLngLat([lng, lat]);
        return;
      }
      const marker = new maplibregl.Marker({ draggable: true, color: MARKER_COLOR })
        .setLngLat([lng, lat])
        .addTo(map);
      marker.on('dragend', () => {
        const pos = marker.getLngLat();
        onChangeRef.current({ lat: pos.lat, lng: pos.lng });
      });
      markerRef.current = marker;
    }

    if (value) {
      dropMarker(value.lat, value.lng);
    }
    map.on('click', (e) => {
      dropMarker(e.lngLat.lat, e.lngLat.lng);
      onChangeRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Map instance is created once on mount; external `value` changes (the GPS
    // button) are synced by the effect below rather than recreating the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync marker + camera when `value` changes from outside the map (GPS button).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !value) return;
    if (markerRef.current) {
      markerRef.current.setLngLat([value.lng, value.lat]);
    } else {
      const marker = new maplibregl.Marker({ draggable: true, color: MARKER_COLOR })
        .setLngLat([value.lng, value.lat])
        .addTo(map);
      marker.on('dragend', () => {
        const pos = marker.getLngLat();
        onChangeRef.current({ lat: pos.lat, lng: pos.lng });
      });
      markerRef.current = marker;
    }
    map.flyTo({ center: [value.lng, value.lat], zoom: PIN_ZOOM });
  }, [value]);

  function useMyLocation() {
    if (!('geolocation' in navigator)) {
      setGpsError('Location services are not available on this device.');
      return;
    }
    setGpsLoading(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onChange({ lat: position.coords.latitude, lng: position.coords.longitude });
        setGpsLoading(false);
      },
      () => {
        setGpsError('Could not get your location. Drop a pin on the map instead.');
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={useMyLocation}
          disabled={gpsLoading}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 transition-colors hover:border-blue-400 disabled:opacity-50"
        >
          {gpsLoading ? 'Locating…' : '📍 Use my location'}
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs text-slate-500 underline hover:text-slate-700"
          >
            Clear
          </button>
        ) : null}
      </div>

      <div
        ref={containerRef}
        data-testid="location-map"
        className="h-56 w-full overflow-hidden rounded-xl border border-slate-300"
      />

      <p className="text-xs text-slate-500">
        {value
          ? `Pin at ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)} — drag the pin or tap the map to adjust.`
          : 'Tap the map to drop a pin, or use your location above.'}
      </p>
      {gpsError && <p className="text-xs text-red-600">{gpsError}</p>}
    </div>
  );
}
