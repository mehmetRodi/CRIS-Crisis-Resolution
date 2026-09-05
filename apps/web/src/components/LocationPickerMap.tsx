import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Crosshair } from 'lucide-react';
import { TOKENS } from '@crisismap/design';
import type { ReportLocation } from '@crisismap/shared';

import { cn } from '../lib/cn';
import { resolveMapStyle } from '../surfaces/map/mapStyle';

interface LocationPickerProps {
  value: ReportLocation | null;
  onChange: (location: ReportLocation | null) => void;
}

const DEFAULT_CENTER: [number, number] = [0, 20];
const DEFAULT_ZOOM = 1.2;
const PIN_ZOOM = 15;

/**
 * The pin colour, read from the accent token at call time (CRIS-54).
 *
 * MapLibre's `Marker` takes a literal colour string, so it cannot reference a
 * CSS variable — but hard-coding a hex here would drift from `tokens.css` the
 * first time the accent changes. The fallback covers jsdom and the window
 * before the stylesheet applies, where an empty string would make MapLibre
 * throw rather than fall back on its own.
 */
function markerColor(): string {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') {
    return `hsl(${TOKENS.accent})`;
  }
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  return raw ? `hsl(${raw})` : `hsl(${TOKENS.accent})`;
}

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
 *
 * ── The heavy half (CRIS-54) ───────────────────────────────────────────────
 * This module imports `maplibre-gl` eagerly, which is why it is DEFAULT-exported
 * and reached through the `React.lazy` boundary in `LocationPicker.tsx` rather
 * than imported directly. Import it from that boundary only: a single eager
 * import anywhere in the graph pulls ~200 kB gzipped back into the entry chunk
 * and silently undoes the split.
 */
export default function LocationPickerMap({ value, onChange }: LocationPickerProps) {
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

  const [mapFailed, setMapFailed] = useState(false);
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
      const marker = new maplibregl.Marker({ draggable: true, color: markerColor() })
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
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: url,
        center: value ? [value.lng, value.lat] : DEFAULT_CENTER,
        zoom: value ? PIN_ZOOM : DEFAULT_ZOOM,
        // OpenFreeMap serves OpenStreetMap data under ODbL — attribution is
        // required, not optional. `compact` keeps it to a small (i) on mobile.
        attributionControl: { compact: true },
      });
    } catch {
      setMapFailed(true);
      return;
    }
    map.on('error', () => setMapFailed(true));
    mapRef.current = map;
    const resizeObserver =
      typeof ResizeObserver === 'function' ? new ResizeObserver(() => map.resize()) : null;
    resizeObserver?.observe(containerRef.current!);
    // Keep MapLibre's compass visible: after a trackpad/touch rotation it is
    // the one-click path back to a north-up, level orientation.
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');

    if (value) {
      placeMarker(value);
    }
    map.on('click', (e) => {
      const location = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      placeMarker(location);
      commitFromMap(location);
    });

    return () => {
      resizeObserver?.disconnect();
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
    // The control is aria-disabled, not disabled, so a second press still
    // reaches us while a fix is pending (ADR-0037).
    if (gpsLoading) return;
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
          // `aria-disabled` rather than `disabled` while the fix is in flight:
          // disabling the element the person just activated drops focus to the
          // document body mid-interaction. `useMyLocation` holds the re-entry
          // guard instead (ADR-0037). `aria-busy` carries the working state that
          // the label change conveys visually, and the emoji is decoration that
          // would otherwise be read as "round pushpin" ahead of the name.
          aria-disabled={gpsLoading}
          aria-busy={gpsLoading}
          className={cn(
            'inline-flex h-9 items-center gap-2 rounded-lg border border-border/80 bg-surface px-3 text-xs font-semibold text-fg shadow-2xs transition-all',
            gpsLoading
              ? 'opacity-50'
              : 'hover:bg-surface-hover hover:border-accent/40 active:scale-95',
          )}
        >
          <Crosshair
            aria-hidden="true"
            className={cn('size-4 shrink-0 text-accent', gpsLoading && 'animate-spin')}
          />
          {gpsLoading ? 'Locating…' : 'Use my location'}
        </button>
        {value ? (
          <div className="flex items-center gap-2">
            <span className="tabular rounded-md bg-accent/10 px-2 py-0.5 text-[11px] font-mono font-medium text-accent border border-accent/20">
              {value.lat.toFixed(4)}, {value.lng.toFixed(4)}
            </span>
            <button
              type="button"
              onClick={() => onChange(null)}
              // "Clear" alone gives no object; out of context it is unanswerable.
              aria-label="Clear selected location"
              className="rounded text-xs font-semibold text-danger/80 underline-offset-4 hover:text-danger hover:underline"
            >
              Clear
            </button>
          </div>
        ) : null}
      </div>

      <div className="relative">
        <div
          ref={containerRef}
          data-testid="location-map"
          // Named and given a role so the map is not an anonymous group in the
          // reading order. Pin-dropping is pointer-only by nature; the GPS button
          // above and the location-hint field below are the keyboard paths, and
          // location is never required (ADR-0037).
          role="application"
          aria-label="Location map — drop a pin to mark the incident"
          className="h-56 w-full overflow-hidden rounded-xl border border-border/80 shadow-2xs"
        />

        {mapFailed ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl border border-border bg-surface-sunken p-6 text-center text-sm text-fg-muted">
            Map unavailable. You can still use GPS or enter a landmark below.
          </div>
        ) : null}
      </div>

      {/* Already rendered in both states, so it is a live region that exists
          *before* its text changes — which is what makes "Use my location"
          succeeding audible rather than silent (ADR-0037). */}
      <p role="status" className="text-xs text-fg-muted">
        {mapFailed
          ? value
            ? `Location selected: ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}. Map unavailable.`
            : 'Map unavailable. Use GPS or enter a landmark below.'
          : value
            ? `Pin at ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)} — drag the pin or tap the map to adjust.`
            : 'Tap the map to drop a pin, or use your location above.'}
      </p>
      {/* Kept mounted for the same reason, and visually hidden while empty so an
          always-present region costs no layout. A denied permission is the most
          likely outcome of the button above; it must not fail quietly (CRIS-27). */}
      <p role="alert" className={gpsError ? 'text-xs font-medium text-danger' : 'sr-only'}>
        {gpsError}
      </p>
    </div>
  );
}
