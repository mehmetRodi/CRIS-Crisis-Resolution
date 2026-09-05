/**
 * The colour palette, as the single source of truth for both clients
 * (CRIS-57, ADR-0057).
 *
 * ── Why the values are bare HSL triples ────────────────────────────────────
 * `'172 52% 26%'`, not `'hsl(172 52% 26%)'` and not `'#12908f'`. The web app
 * composes them as `hsl(var(--token) / <alpha-value>)` so Tailwind opacity
 * modifiers (`bg-accent/10`) keep working, which a complete colour function
 * cannot support. React Native cannot read CSS variables at all, so it calls
 * {@link color} to assemble a literal string at module load.
 *
 * The web app's `styles/tokens.css` still holds these values literally —
 * a browser needs them in CSS, and no import can bridge that. A drift test
 * (`apps/web/src/styles/tokens.test.ts`) parses that file and asserts it matches
 * this module exactly, so the duplication cannot silently diverge.
 *
 * ── Palette rationale (ADR-0054) ───────────────────────────────────────────
 * The accent is TEAL, deliberately not blue and deliberately not warm. Priority
 * bands P0–P3 own the entire warm spectrum, so a warm accent would make an
 * ordinary "Send" button read as a critical incident at a glance — the one
 * confusion this product cannot afford. `--info` (205°) sits close to the accent
 * (184°), so INFO IS NEVER USED FOR AN INTERACTIVE ELEMENT.
 */

export const TOKENS = {
  /* ── Canvas & surfaces ─────────────────────────────────────────────────── */
  /* A faintly cool off-white rather than pure white: a full-bleed white canvas
     under a dense incident table is fatiguing over a long shift, and it leaves
     no lighter value available for raised surfaces to sit on. */
  bg: '160 18% 96%',
  surface: '0 0% 100%',
  /** Recessed wells — filter trays, empty states, table headers. */
  'surface-sunken': '160 18% 93%',
  /** Hover/pressed fill for rows and ghost buttons. */
  'surface-hover': '160 20% 95%',
  overlay: '205 30% 12%',

  /* ── Text ──────────────────────────────────────────────────────────────── */
  /* Near-black with a cool cast, never pure black — pure black on off-white
     over-contrasts and vibrates at small sizes. */
  fg: '200 32% 10%',
  'fg-muted': '205 12% 40%',
  'fg-subtle': '205 11% 55%',
  /** Only for text on a saturated fill (accent buttons, severity chips). */
  'fg-on-solid': '0 0% 100%',

  /* ── Lines ─────────────────────────────────────────────────────────────── */
  border: '165 15% 86%',
  'border-strong': '205 16% 78%',

  /* ── Accent (teal) ─────────────────────────────────────────────────────── */
  accent: '172 52% 26%',
  'accent-hover': '172 54% 21%',
  'accent-active': '172 56% 17%',
  /** Tinted background for selected rows and active facets. */
  'accent-subtle': '160 30% 90%',
  'accent-subtle-fg': '172 55% 21%',
  'accent-border': '165 28% 72%',

  /* ── Focus ring ────────────────────────────────────────────────────────── */
  /* Lighter and more saturated than `accent` so the ring stays visible when it
     lands ON an accent-filled control. */
  ring: '184 76% 38%',

  /* ── Priority bands (design doc §5.4.2) ────────────────────────────────── */
  /* Ordered red → orange → amber → neutral. P3 is deliberately CHROMATICALLY
     NEUTRAL rather than green: green reads as "resolved / good", but P3 is a
     real open incident that merely ranks last. */
  'severity-p0': '358 68% 46%',
  'severity-p0-subtle': '358 74% 96%',
  'severity-p0-border': '358 60% 86%',

  'severity-p1': '20 84% 45%',
  'severity-p1-subtle': '26 86% 95%',
  'severity-p1-border': '24 72% 84%',

  'severity-p2': '38 88% 42%',
  'severity-p2-subtle': '44 90% 94%',
  'severity-p2-border': '40 74% 82%',

  'severity-p3': '205 12% 48%',
  'severity-p3-subtle': '205 20% 95%',
  'severity-p3-border': '205 16% 85%',

  /* Not-yet-scored (NEW / PROCESSING). Distinct from P3 — "no band computed" is
     not the same claim as "ranks lowest", and no surface may imply it. */
  'severity-none': '205 10% 66%',
  'severity-none-subtle': '205 18% 96%',
  'severity-none-border': '205 14% 88%',

  /* ── Feedback ──────────────────────────────────────────────────────────── */
  success: '154 62% 30%',
  'success-subtle': '152 52% 94%',
  'success-border': '152 40% 80%',

  warning: '38 88% 42%',
  'warning-subtle': '44 90% 94%',
  'warning-border': '40 74% 82%',

  danger: '358 68% 46%',
  'danger-subtle': '358 74% 96%',
  'danger-border': '358 60% 86%',

  /** Passive informational surfaces ONLY — see the palette note above. */
  info: '205 78% 38%',
  'info-subtle': '205 76% 95%',
  'info-border': '205 56% 82%',
} as const;

export type TokenName = keyof typeof TOKENS;

/**
 * Corner radii, in PIXELS.
 *
 * Pixels rather than rem because React Native has no relative unit — a `rem`
 * would have to be converted somewhere, and doing it here keeps the shared value
 * unambiguous. The web stylesheet expresses the same numbers in rem (÷16), which
 * the drift test checks.
 */
export const RADII = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  /** Fully rounded — dots, pills, avatars. */
  full: 999,
} as const;

export type RadiusName = keyof typeof RADII;

/**
 * The spacing scale, in pixels. Web uses Tailwind's own (identical) 4px scale,
 * so this exists for React Native, which has no utility classes.
 *
 * Named steps rather than Tailwind's numeric ones (`SPACE[4]`) on purpose:
 * JavaScript reorders integer-like object keys into ascending numeric order
 * ahead of every other key, so a `{ '0.5': 2, '1': 4, '1.5': 6 }` object does
 * NOT iterate in the order it is written. Anything deriving an ordered scale
 * from it would silently get the wrong sequence.
 */
export const SPACE = {
  '2xs': 2,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  '2xl': 20,
  '3xl': 24,
  '4xl': 32,
  '5xl': 48,
} as const;

export type SpaceName = keyof typeof SPACE;

/**
 * A token as a colour string usable anywhere a literal colour is required —
 * React Native styles, and canvas contexts like MapLibre that cannot resolve
 * CSS variables.
 *
 * Emits the COMMA-separated `hsl(h, s%, l%)` form rather than the modern
 * space-separated one. React Native's colour parser accepts the legacy syntax on
 * every supported platform version; space-separated CSS Color 4 syntax is not
 * universally handled, and an unparsed colour string silently renders as black.
 */
export function color(name: TokenName): string {
  const [h, s, l] = TOKENS[name].split(' ');
  return `hsl(${h}, ${s}, ${l})`;
}

/**
 * A token at partial opacity, for scrims and overlays.
 *
 * `alpha` is clamped rather than trusted: an out-of-range value produces an
 * invalid colour string, which React Native renders as opaque black instead of
 * throwing — a failure that is easy to ship and hard to spot.
 */
export function colorAlpha(name: TokenName, alpha: number): string {
  const [h, s, l] = TOKENS[name].split(' ');
  const clamped = Math.min(1, Math.max(0, alpha));
  return `hsla(${h}, ${s}, ${l}, ${clamped})`;
}
