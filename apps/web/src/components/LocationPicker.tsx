import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { ReportLocation } from '@crisismap/shared';

import { resolveMapStyle } from '../surfaces/map/mapStyle';

interface LocationPickerProps {
  value: ReportLocation | null;
  onChange: (location: ReportLocation | null) => void;
}

const DEFAULT_CENTER: [number, number] = [0, 20];
const DEFAULT_ZOOM = 1.2;
const PIN_ZOOM = 15;
const MARKER_COLOR = '#2563eb';

function isSameLocation(a: ReportLocation | null, b: ReportLocation | null): boolean {
  return a !== null && b !== null && a.lat === b.lat && a.lng === b.lng;
}

/**
 * GPS + map-pin location input (CRIS-16). Citizens can tap "Use my location"
 * (browser Geolocation) or drop/drag a pin directly on the map; both paths
 * report through the same `onChange`. Location is always optional — an
 * emergency report must never be blocked by a denied permission or a bad fix.
 *
 * MapLibre + the shared style seam (`surfaces/map/mapStyle.ts`, ADR-0025) — no
 * API key needed until Amazon Location Service is wired (CRIS-7/CRIS-24). The
 * same helper backs CRIS-13's live incident map, so both surfaces render from
 * one tile source.
 */
export function LocationPicker({ value, onChange }: LocationPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  // Keeps the map's click/dragend handlers (bound once, on mount) calling the
  // latest onChange without recreating the map every time the parent re-renders.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  /**
   * The coordinate most recently emitted *by the map itself* (a click or a
   * marker drag). The sync effect below compares against it so a map-originated
   * change doesn't bounce the camera through `flyTo` — otherwise every click
   * would yank the viewport and force-zoom to `PIN_ZOOM`. Seeded with the
   * mount-time `value` because the constructor already centres there.
   */
  const selfEmittedRef = useRef<ReportLocation | null>(value);

  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  /** Records a coordinate as map-originated, then hands it up. */
  const commitFromMap = useCallback((location: ReportLocation) => {
    selfEmittedRef.current = location;
    onChangeRef.current(location);
  }, []);

  /**
   * Creates the marker on first use and moves it thereafter. Shared by the
   * map's own click handler and by the external-value sync below, so the
   * drag wiring exists in exactly one place.
   */
  const placeMarker = useCallback(
    (location: ReportLocation) => {
      const map = mapRef.current;
      if (!map) return;
      if (markerRef.current) {
        markerRef.current.setLngLat([location.lng, location.lat]);
        return;
      }
      const marker = new maplibregl.Marker({ draggable: true, color: MARKER_COLOR })
        .setLngLat([location.lng, location.lat])
        .addTo(map);
      marker.on('dragend', () => {
        const pos = marker.getLngLat();
        commitFromMap({ lat: pos.lat, lng: pos.lng });
      });
      markerRef.current = marker;
    },
    [commitFromMap],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const { url } = resolveMapStyle();
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: url,
      center: value ? [value.lng, value.lat] : DEFAULT_CENTER,
      zoom: value ? PIN_ZOOM : DEFAULT_ZOOM,
      // OpenFreeMap serves OpenStreetMap data under ODbL — attribution is
      // required, not optional. `compact` keeps it to a small (i) on mobile.
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    if (value) {
      placeMarker(value);
    }
    map.on('click', (e) => {
      const location = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      placeMarker(location);
      commitFromMap(location);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Map instance is created once on mount; external `value` changes (the GPS
    // button, Clear) are synced by the effect below rather than recreating the
    // map. `placeMarker`/`commitFromMap` are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync marker + camera when `value` changes from outside the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Cleared: drop the marker, otherwise a pin lingers on a map that reports
    // no location.
    if (!value) {
      markerRef.current?.remove();
      markerRef.current = null;
      selfEmittedRef.current = null;
      return;
    }

    const cameFromMap = isSameLocation(selfEmittedRef.current, value);
    selfEmittedRef.current = null;

    placeMarker(value);
    if (!cameFromMap) {
      map.flyTo({ center: [value.lng, value.lat], zoom: PIN_ZOOM });
    }
  }, [value, placeMarker]);

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
