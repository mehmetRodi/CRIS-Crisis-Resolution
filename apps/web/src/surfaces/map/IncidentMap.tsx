import { lazy, Suspense } from 'react';

import { cn } from '../../lib/cn';
import type { IncidentMapProps } from './IncidentMapView';

export type { IncidentMapProps } from './IncidentMapView';

/**
 * Lazy boundary for the incident map (CRIS-13, ADR-0025).
 *
 * `maplibre-gl` is ~200 kB gzipped and appears only on operational surfaces and
 * the public map. Splitting it behind `React.lazy` keeps it out of the initial
 * bundle so the citizen `/report` path — the one most likely to be loaded on a
 * degraded network during an actual emergency — never pays for it.
 */
const IncidentMapView = lazy(() => import('./IncidentMapView'));

export function IncidentMap({ className, ...rest }: IncidentMapProps) {
  return (
    <div className={cn('relative h-full w-full', className)}>
      <Suspense
        fallback={
          // `role="status"`, not a bare div: on a slow connection this is on
          // screen for several seconds and is the only signal that the map is
          // coming rather than broken.
          <div
            role="status"
            className="flex h-full w-full items-center justify-center bg-surface-sunken text-sm text-fg-subtle"
          >
            Loading map…
          </div>
        }
      >
        <IncidentMapView {...rest} />
      </Suspense>
    </div>
  );
}
