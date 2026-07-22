/**
 * Resolves the MapLibre style the base map renders from (CRIS-13, ADR-0025).
 *
 * The design target is **Amazon Location Service** (design doc §4, §2.4), but its
 * map resource and browser authorization are not wired yet. Until then the base
 * map renders from a free, no-key public style so
 * the surface is real and manually verifiable today. When `VITE_MAP_STYLE_URL` is
 * set — the deployed ALS style descriptor, once it exists — it takes precedence
 * with no code change. This is the single seam where the tile source is chosen.
 */

/** MapLibre's free demo vector style. No API key; adequate for a scaffold base map. */
export const DEMO_MAP_STYLE = 'https://demotiles.maplibre.org/style.json';

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
