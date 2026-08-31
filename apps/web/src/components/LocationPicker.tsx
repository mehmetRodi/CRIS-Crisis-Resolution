import { lazy, Suspense } from 'react';
import type { ReportLocation } from '@crisismap/shared';

export interface LocationPickerProps {
  value: ReportLocation | null;
  onChange: (location: ReportLocation | null) => void;
}

/**
 * Lazy boundary for the report form's location picker (CRIS-54, ADR-0025).
 *
 * The picker pulls in `maplibre-gl` (~200 kB gzipped). Until now it did so
 * EAGERLY: the report form imports the picker, so every citizen loading
 * `/report` downloaded and parsed a WebGL map engine before the form's first
 * paint — on the one surface most likely to be opened on a degraded network
 * during an actual disaster. ADR-0025 already split the incident map for
 * exactly this reason; this import was quietly defeating it, because a single
 * eager import anywhere in the graph pulls the module back into the entry
 * chunk no matter how many other call sites are lazy.
 *
 * Behind the boundary, the form renders immediately and the map streams in.
 * Location is optional (ADR-0021/CRIS-16), so nothing is blocked while it
 * arrives.
 */
const LocationPickerMap = lazy(() => import('./LocationPickerMap'));

export function LocationPicker(props: LocationPickerProps) {
  return (
    <Suspense
      fallback={
        // Reserves the picker's height so the form does not jump when the chunk
        // lands, and announces itself — on a slow connection this is on screen
        // for several seconds and is otherwise indistinguishable from a map
        // that failed to load.
        <div
          role="status"
          className="flex h-56 w-full items-center justify-center rounded-lg border border-border bg-surface-sunken text-sm text-fg-subtle"
        >
          Loading map…
        </div>
      }
    >
      <LocationPickerMap {...props} />
    </Suspense>
  );
}
