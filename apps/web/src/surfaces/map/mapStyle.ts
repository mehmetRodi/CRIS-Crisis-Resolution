/**
 * Resolves the MapLibre style every web map renders from (CRIS-13, ADR-0025).
 *
 * The design target is **Amazon Location Service** (design doc §4, §2.4), but its
 * map resource and browser authorization are not wired yet. Until then the base
 * map renders from a free, no-key public style so
 * the surface is real and manually verifiable today. When `VITE_MAP_STYLE_URL` is
 * set — the deployed ALS style descriptor, once it exists — it takes precedence
 * with no code change. This is the single seam where the tile source is chosen.
 *
 * Shared by both web maps — CRIS-13's live incident map (`IncidentMapView`) and
 * CRIS-16's report-form location picker (`components/LocationPicker`) — so the
 * ALS cutover is one edit, not two (ADR-0034).
 */

/**
 * OpenFreeMap's "Liberty" style — full OpenStreetMap vector data (place names
 * down to village level, roads, buildings), free and keyless, no rate limit.
 *
 * Replaced MapLibre's own `demotiles.maplibre.org` in CRIS-16 (ADR-0034):
 * demotiles is intentionally bare — country outlines only, no place names —
 * which is fine for a scaffold base map but unusable for the report form's
 * location picker, where a citizen has to place a pin near a named place.
 *
 * Serves OSM data under ODbL, so any map rendering it must show attribution.
 */
export const DEMO_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

export interface ResolvedMapStyle {
  /** Style descriptor URL passed to `maplibregl.Map({ style })`. */
  url: string;
  /** True when falling back to the public demo style (no ALS style configured). */
  isDemo: boolean;
}

/**
 * Picks the base-map style: a configured `VITE_MAP_STYLE_URL` if present and
 * non-blank, otherwise the public demo style. `styleUrl` is a parameter (not read
 * inline) so the resolution is unit-testable without touching `import.meta.env`.
 */
export function resolveMapStyle(
  styleUrl: string | undefined = import.meta.env.VITE_MAP_STYLE_URL,
): ResolvedMapStyle {
  const configured = styleUrl?.trim();
  if (configured) {
    return { url: configured, isDemo: false };
  }
  return { url: DEMO_MAP_STYLE, isDemo: true };
}
