import type { PublicReport } from '@crisismap/shared';

import { bandOf } from '../coordinator/incidents';

/**
 * Turn redacted incidents into the GeoJSON the map source consumes (CRIS-54).
 *
 * Pure and DOM-free so the projection is unit-testable without WebGL — the
 * previous map rendered no data at all, so this transformation is new surface
 * area and needs its own tests rather than being buried inside a `useEffect`.
 *
 * ── What is allowed onto the map ───────────────────────────────────────────
 * Feature properties are an explicit allow-list of PII-free fields. The input is
 * already the redacted `PublicReport` projection (§5.6), but feature properties
 * end up serialised into a WebGL buffer and are readable from any popup or
 * `queryRenderedFeatures` call, so spreading the whole object here would be a
 * standing invitation for a future non-public field to ride along. `summary` is
 * the AI-generated text; the untrusted raw report body is never present on
 * `PublicReport` and must never be plotted.
 */

export interface IncidentFeatureProperties {
  reportId: string;
  /** Priority band, or `'NONE'` for a not-yet-scored report. */
  band: string;
  status: string;
  category: string;
  summary: string;
}

/** Sentinel for reports with no band. Kept out of `PriorityBand` on purpose. */
export const UNSCORED_BAND = 'NONE';

export interface IncidentFeatureCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    id: string;
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: IncidentFeatureProperties;
  }[];
}

/**
 * True when an incident can actually be placed on a map.
 *
 * Reports arrive before geocoding resolves (§5.2), so a null coordinate is an
 * ordinary intermediate state, not a data fault. `0, 0` is a real location in
 * the Gulf of Guinea and a classic "unset" sentinel, but rejecting it would
 * discard a genuine report from that region — so it is kept, and the far more
 * common `null` case is what filters out.
 */
export function isPlottable(
  incident: PublicReport,
): incident is PublicReport & { lat: number; lng: number } {
  return (
    typeof incident.lat === 'number' &&
    typeof incident.lng === 'number' &&
    Number.isFinite(incident.lat) &&
    Number.isFinite(incident.lng)
  );
}

export function toIncidentGeoJson(incidents: readonly PublicReport[]): IncidentFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: incidents.filter(isPlottable).map((incident) => ({
      type: 'Feature',
      // MapLibre needs a stable feature id for `setFeatureState` and for
      // reconciling updates without re-adding every point on each tick.
      id: incident.reportId,
      geometry: { type: 'Point', coordinates: [incident.lng, incident.lat] },
      properties: {
        reportId: incident.reportId,
        band: bandOf(incident) ?? UNSCORED_BAND,
        status: incident.status,
        category: incident.category ?? 'OTHER',
        // Empty string rather than null: MapLibre drops null-valued properties,
        // which would make `['get', 'summary']` return undefined in expressions.
        summary: incident.summary ?? '',
      },
    })),
  };
}

/** How many of `incidents` carry coordinates — drives the map's status line. */
export function plottableCount(incidents: readonly PublicReport[]): number {
  return incidents.filter(isPlottable).length;
}
