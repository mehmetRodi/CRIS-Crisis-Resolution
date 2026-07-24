/**
 * Resolves the MapLibre style the location-pin picker renders from (CRIS-16).
 *
 * The design target is Amazon Location Service (design doc §4, §2.4), but ALS
 * needs a deployed backend plus Cognito/API-key auth (CRIS-24, CRIS-7). Until
 * then this renders from a free, no-key public style so the picker is real and
 * manually verifiable today. When `VITE_MAP_STYLE_URL` is set — the deployed
 * ALS style descriptor, once it exists — it takes precedence with no code
 * change. CRIS-13's live map (`surfaces/map/mapStyle.ts`) has the identical
 * shape but its own separate copy — deliberately not shared, to keep this
 * ticket's diff scoped to its own files; worth de-duping in a follow-up.
 */

/**
 * OpenFreeMap's "Liberty" style — full OSM vector data (place names down to
 * village level, roads, buildings), free and keyless, no rate limit. Used
 * instead of MapLibre's own `demotiles.maplibre.org` style (what CRIS-13
 * uses), which is intentionally bare — country outlines only, no place
 * names — and unusable for actually placing a pin near a named location.
 */
export const DEMO_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

export interface ResolvedMapStyle {
  /** Style descriptor URL passed to `maplibregl.Map({ style })`. */
  url: string;
  /** True when falling back to the public demo style (no ALS style configured). */
  isDemo: boolean;
}

/**
 * Picks the map style: a configured `VITE_MAP_STYLE_URL` if present and
 * non-blank, otherwise the public demo style. `styleUrl` is a parameter (not
 * read inline) so the resolution is unit-testable without touching `import.meta.env`.
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
