import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { resolveMapStyle } from './mapStyle';

/**
 * The live incident **base map** view (CRIS-13, ADR-0025).
 *
 * This is the heavy half of the map surface — it pulls in `maplibre-gl` (~200 kB
 * gzipped) and its stylesheet, so it is **lazy-loaded** via {@link IncidentMap} and
 * never lands in the initial bundle (keeps the citizen `/report` path lean; design
 * doc §3.2). Default-exported because `React.lazy` requires a default export.
 *
 * Base map only: it renders no incident data. Markers, clustering, and
 * viewport-driven fetching are owned by later tickets (CRIS-22, design doc §5.2).
 * Tile source is resolved once in {@link resolveMapStyle} — a free public demo
 * style today, Amazon Location once `VITE_MAP_STYLE_URL` is wired (CRIS-24).
 *
 * Resilience (design doc §1: stay usable when a dependency degrades): a style
 * fetch/render failure surfaces a quiet inline notice instead of a blank canvas
 * or a thrown error.
 */
export interface IncidentMapProps {
  /**
   * Initial viewport center `[lng, lat]`. Initial-only — later tickets drive the
   * viewport imperatively as incidents load (CRIS-22). Defaults to a neutral wide
   * view; there is no incident data to frame yet.
   */
  center?: [number, number];
  /** Initial zoom (initial-only, see {@link center}). */
  zoom?: number;
  /** Extra classes for the map root. The map fills its container (`h-full w-full`). */
  className?: string;
}

/** Neutral wide default — nothing to frame until incidents load (CRIS-22). */
const DEFAULT_CENTER: [number, number] = [10, 47];
const DEFAULT_ZOOM = 3;

export default function IncidentMapView({
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  className,
}: IncidentMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const style = resolveMapStyle();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      style: style.url,
      center,
      zoom,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    const onError = () => setFailed(true);
    map.on('error', onError);

    return () => {
      map.off('error', onError);
      map.remove();
    };
    // `center`/`zoom` are initial-only (see prop docs); re-init solely on a
    // tile-source change so a later ALS switch takes effect without a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style.url]);

  return (
    <div className={`relative h-full w-full ${className ?? ''}`}>
      <div
        ref={containerRef}
        role="application"
        aria-label="Incident map"
        className="h-full w-full"
      />
      {style.isDemo ? (
        <span className="pointer-events-none absolute left-2 top-2 z-[1] rounded bg-slate-900/80 px-2 py-0.5 text-xs font-medium text-white">
          Demo tiles — Amazon Location wires in with CRIS-24
        </span>
      ) : null}
      {failed ? (
        // Degradation is silent for a non-sighted user — the canvas simply stays
        // empty — so the notice is announced rather than merely drawn (CRIS-27).
        <div
          role="status"
          className="absolute inset-0 z-[1] flex items-center justify-center bg-slate-50/95 p-4 text-center"
        >
          <p className="text-sm text-slate-500">
            Map unavailable — base tiles could not be loaded.
          </p>
        </div>
      ) : null}
    </div>
  );
}
