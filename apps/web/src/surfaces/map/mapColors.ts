import { PriorityBand } from '@crisismap/shared';

/**
 * Resolve design tokens into concrete colours for MapLibre (CRIS-54, ADR-0054).
 *
 * The map draws to a WebGL canvas, so its paint properties take literal colour
 * strings — `var(--severity-p0)` means nothing to MapLibre. Rather than
 * hard-coding hex values (which would silently drift from `tokens.css`, and
 * would not follow a future dark theme), this reads the SAME custom properties
 * the rest of the UI uses off the document root and assembles them into
 * `hsl(...)` strings.
 *
 * The fallbacks are not decorative: `getComputedStyle` returns an empty string
 * in jsdom and before the stylesheet has applied, and MapLibre throws on an
 * invalid colour rather than skipping the layer — an empty string would take the
 * whole map down instead of mis-tinting one marker.
 */

/** Literal fallbacks, kept in step with `styles/tokens.css` by hand. */
const FALLBACK = {
  p0: 'hsl(358 68% 46%)',
  p1: 'hsl(20 84% 45%)',
  p2: 'hsl(38 88% 42%)',
  p3: 'hsl(205 12% 48%)',
  none: 'hsl(205 10% 66%)',
  surface: 'hsl(0 0% 100%)',
  fg: 'hsl(205 32% 13%)',
  accent: 'hsl(184 82% 28%)',
} as const;

function readToken(name: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw ? `hsl(${raw})` : fallback;
}

export interface MapPalette {
  p0: string;
  p1: string;
  p2: string;
  p3: string;
  /** Not-yet-scored incidents — distinct from P3 (see `domain-display.ts`). */
  none: string;
  surface: string;
  fg: string;
  accent: string;
}

/**
 * Read the current palette. Called at layer-creation time rather than module
 * scope so it picks up the stylesheet once it has actually applied.
 */
export function mapPalette(): MapPalette {
  return {
    p0: readToken('--severity-p0', FALLBACK.p0),
    p1: readToken('--severity-p1', FALLBACK.p1),
    p2: readToken('--severity-p2', FALLBACK.p2),
    p3: readToken('--severity-p3', FALLBACK.p3),
    none: readToken('--severity-none', FALLBACK.none),
    surface: readToken('--surface', FALLBACK.surface),
    fg: readToken('--fg', FALLBACK.fg),
    accent: readToken('--accent', FALLBACK.accent),
  };
}

/**
 * A MapLibre `match` expression mapping a feature's `band` property to its
 * colour. Unscored incidents fall through to the neutral default — they must not
 * inherit P3's colour, because "not assessed" is a different claim from "ranks
 * lowest" and a coordinator scanning the map has to be able to tell them apart.
 */
export function bandColorExpression(palette: MapPalette): unknown[] {
  return [
    'match',
    ['get', 'band'],
    PriorityBand.P0,
    palette.p0,
    PriorityBand.P1,
    palette.p1,
    PriorityBand.P2,
    palette.p2,
    PriorityBand.P3,
    palette.p3,
    palette.none,
  ];
}

/**
 * Cluster colour: the WORST band anywhere inside the cluster wins.
 *
 * This is the single most important expression on the map. A cluster tinted by
 * its average or its most common band can render a group containing one P0 as
 * routine grey, which would hide a life-threatening incident behind a
 * zoom-level accident. The per-band counts come from the source's
 * `clusterProperties` (see `IncidentMapView`).
 */
export function clusterColorExpression(palette: MapPalette): unknown[] {
  return [
    'case',
    ['>', ['get', 'p0'], 0],
    palette.p0,
    ['>', ['get', 'p1'], 0],
    palette.p1,
    ['>', ['get', 'p2'], 0],
    palette.p2,
    palette.p3,
  ];
}
