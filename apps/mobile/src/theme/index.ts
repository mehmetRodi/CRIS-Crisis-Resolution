import { Platform, type TextStyle, type ViewStyle } from 'react-native';
import { RADII, SPACE, TOKENS, color, colorAlpha } from '@crisismap/design';

/**
 * The Expo app's theme, derived from `@crisismap/design` (CRIS-57, ADR-0057).
 *
 * Every colour here is resolved from the SAME token module the web app's
 * `tokens.css` mirrors, so the two clients cannot drift apart the way they did
 * before: this file previously hard-coded a slate-and-blue palette copied by
 * hand from Tailwind, and it stayed on that palette for the whole of the web
 * redesign.
 *
 * Nothing below invents a colour. If a value is needed that is not here, it is
 * added to the design package and both clients get it.
 */

/**
 * Colours, resolved to literal `hsl(...)` strings at module load.
 *
 * React Native cannot read CSS variables, so the indirection the web enjoys
 * (`hsl(var(--accent) / 0.1)`) does not exist here — a colour is fixed the
 * moment this module is imported. That is also why a dark theme on mobile will
 * need a provider rather than a stylesheet swap; see ADR-0057.
 */
export const colors = {
  bg: color('bg'),
  surface: color('surface'),
  surfaceSunken: color('surface-sunken'),
  surfaceHover: color('surface-hover'),
  /** Scrim behind modals. */
  overlay: colorAlpha('overlay', 0.4),

  fg: color('fg'),
  fgMuted: color('fg-muted'),
  fgSubtle: color('fg-subtle'),
  /** Only for text on a saturated fill. */
  fgOnSolid: color('fg-on-solid'),

  border: color('border'),
  borderStrong: color('border-strong'),

  accent: color('accent'),
  /** Pressed state. RN has no `:hover`, so the web's hover step is reused. */
  accentPressed: color('accent-hover'),
  accentActive: color('accent-active'),
  accentSubtle: color('accent-subtle'),
  accentSubtleFg: color('accent-subtle-fg'),
  accentBorder: color('accent-border'),

  ring: color('ring'),

  severity: {
    p0: color('severity-p0'),
    p0Subtle: color('severity-p0-subtle'),
    p0Border: color('severity-p0-border'),
    p1: color('severity-p1'),
    p1Subtle: color('severity-p1-subtle'),
    p1Border: color('severity-p1-border'),
    p2: color('severity-p2'),
    p2Subtle: color('severity-p2-subtle'),
    p2Border: color('severity-p2-border'),
    p3: color('severity-p3'),
    p3Subtle: color('severity-p3-subtle'),
    p3Border: color('severity-p3-border'),
    /** Not-yet-scored. Deliberately not P3's colour — see `UNSCORED_LABEL`. */
    none: color('severity-none'),
    noneSubtle: color('severity-none-subtle'),
    noneBorder: color('severity-none-border'),
  },

  success: color('success'),
  successSubtle: color('success-subtle'),
  successBorder: color('success-border'),

  warning: color('warning'),
  warningSubtle: color('warning-subtle'),
  warningBorder: color('warning-border'),

  danger: color('danger'),
  dangerSubtle: color('danger-subtle'),
  dangerBorder: color('danger-border'),

  info: color('info'),
  infoSubtle: color('info-subtle'),
  infoBorder: color('info-border'),
} as const;

export const radii = RADII;
export const space = SPACE;

/**
 * Type scale.
 *
 * ── Why this is the SYSTEM font, not Inter ─────────────────────────────────
 * The web app self-hosts Inter. Matching it here would mean `expo-font` plus a
 * bundled Inter family, and a font-load gate in front of first paint — on the
 * one screen most likely to be opened one-handed, under stress, during an
 * actual emergency. San Francisco and Roboto are the platform faces users
 * already read everything else in, they need no loading step, and they are
 * closer to Inter than to anything else.
 *
 * The part of the web decision that DOES carry over is tabular numerals:
 * `numeric` below pins digit width so counters and coordinates do not jitter as
 * they change.
 */
export const type = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: '700' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  heading: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  small: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  /** Section headers: short, upper-case, widely tracked. */
  overline: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
} as const satisfies Record<string, TextStyle>;

/** Digits that update in place must not change width as they change value. */
export const numeric: TextStyle = { fontVariant: ['tabular-nums'] };

/**
 * Elevation. iOS and Android express depth through entirely different
 * properties, so each shade sets both — `elevation` alone is invisible on iOS,
 * and `shadowOpacity` alone is invisible on Android.
 */
function shadow(elevation: number, opacity: number, radius: number, offsetY: number): ViewStyle {
  return Platform.select({
    ios: {
      shadowColor: color('fg'),
      shadowOpacity: opacity,
      shadowRadius: radius,
      shadowOffset: { width: 0, height: offsetY },
    },
    default: { elevation },
  }) as ViewStyle;
}

export const shadows = {
  xs: shadow(1, 0.05, 2, 1),
  sm: shadow(2, 0.07, 4, 2),
  md: shadow(6, 0.1, 12, 4),
} as const;

/**
 * Visually hidden but still in the accessibility tree — the React Native
 * counterpart of the web's `sr-only`.
 *
 * `display: 'none'` or `opacity: 0` alone would remove it from the tree
 * entirely and silence any live region inside it, which is the opposite of what
 * this is for (ADR-0037).
 */
export const srOnly: ViewStyle = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  opacity: 0,
};

/** Minimum comfortable touch target. Below this, taps miss under stress. */
export const MIN_TOUCH_TARGET = 44;

export { TOKENS };
