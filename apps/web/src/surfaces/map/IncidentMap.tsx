import { lazy, Suspense } from 'react';

import type { IncidentMapProps } from './IncidentMapView';

export type { IncidentMapProps } from './IncidentMapView';

/**
 * Lazy boundary for the incident base map (CRIS-13, ADR-0025).
 *
 * `maplibre-gl` is large (~200 kB gzipped) and the map appears only on the
 * coordinator surfaces (`/coordinator`, `/map`). Splitting it behind `React.lazy`
 * keeps it out of the initial bundle so latency-critical citizen surfaces — the
 * `/report` emergency form (ADR-0021) — don't pay for it. The public API is
 * unchanged: consumers render `<IncidentMap />` and get the map plus a loading
 * placeholder while the chunk streams in.
 */
const IncidentMapView = lazy(() => import('./IncidentMapView'));

export function IncidentMap({ className, ...rest }: IncidentMapProps) {
  return (
    <div className={`relative ${className ?? ''}`}>
      <Suspense
        fallback={
          <div className="flex h-full w-full items-center justify-center bg-slate-50 text-sm text-slate-400">
            Loading map…
          </div>
        }
      >
        <IncidentMapView {...rest} />
      </Suspense>
    </div>
  );
}
