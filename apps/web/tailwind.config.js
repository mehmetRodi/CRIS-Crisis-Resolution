/**
 * Tailwind theme (CRIS-54, ADR-0054).
 *
 * The colour scale is REPLACED, not extended. Tailwind's default palette
 * (`slate-200`, `blue-600`, …) is removed so a component physically cannot name
 * a raw colour step — the only way to colour something is through a semantic
 * token from `src/styles/tokens.css`. That is what keeps the deferred dark theme
 * a one-file change, and it turns "someone hard-coded a colour" from a review
 * catch into a build error.
 *
 * `transparent`, `current`, `inherit`, `white`, and `black` survive because they
 * are structural rather than palette choices (overlay scrims, borders that must
 * genuinely disappear, SVG `fill-current`).
 *
 * Every token is composed as `hsl(var(--x) / <alpha-value>)` so opacity
 * modifiers keep working: `bg-accent/10`, `border-border/60`.
 */

/** Builds `hsl(var(--token) / <alpha>)` so Tailwind opacity modifiers apply. */
const token = (name) => `hsl(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      white: '#ffffff',
      black: '#000000',

      bg: token('bg'),
      surface: {
        DEFAULT: token('surface'),
        sunken: token('surface-sunken'),
        hover: token('surface-hover'),
      },
      overlay: token('overlay'),

      fg: {
        DEFAULT: token('fg'),
        muted: token('fg-muted'),
        subtle: token('fg-subtle'),
        'on-solid': token('fg-on-solid'),
      },

      border: {
        DEFAULT: token('border'),
        strong: token('border-strong'),
      },

      accent: {
        DEFAULT: token('accent'),
        hover: token('accent-hover'),
        active: token('accent-active'),
        subtle: token('accent-subtle'),
        'subtle-fg': token('accent-subtle-fg'),
        border: token('accent-border'),
      },

      ring: token('ring'),

      // Priority bands. Named `severity-*` rather than `p0-*` so the intent
      // survives a future renaming of the bands themselves.
      severity: {
        p0: token('severity-p0'),
        'p0-subtle': token('severity-p0-subtle'),
        'p0-border': token('severity-p0-border'),
        p1: token('severity-p1'),
        'p1-subtle': token('severity-p1-subtle'),
        'p1-border': token('severity-p1-border'),
        p2: token('severity-p2'),
        'p2-subtle': token('severity-p2-subtle'),
        'p2-border': token('severity-p2-border'),
        p3: token('severity-p3'),
        'p3-subtle': token('severity-p3-subtle'),
        'p3-border': token('severity-p3-border'),
        none: token('severity-none'),
        'none-subtle': token('severity-none-subtle'),
        'none-border': token('severity-none-border'),
      },

      success: {
        DEFAULT: token('success'),
        subtle: token('success-subtle'),
        border: token('success-border'),
      },
      warning: {
        DEFAULT: token('warning'),
        subtle: token('warning-subtle'),
        border: token('warning-border'),
      },
      danger: {
        DEFAULT: token('danger'),
        subtle: token('danger-subtle'),
        border: token('danger-border'),
      },
      info: {
        DEFAULT: token('info'),
        subtle: token('info-subtle'),
        border: token('info-border'),
      },
    },

    extend: {
      fontFamily: {
        // Variable Inter, self-hosted via @fontsource-variable (no third-party
        // font request on the citizen path, which may be on a degraded network).
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        // Report IDs, geohashes, and coordinates are scanned character by
        // character and compared between screens; a proportional face makes that
        // materially harder.
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        md: 'var(--radius)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // The live-connection dot. A slow breath rather than a blink: a blinking
        // indicator in peripheral vision reads as an alarm, and in an incident
        // room every false alarm costs attention that belongs elsewhere.
        breathe: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
      },
      animation: {
        'fade-in': 'fade-in 120ms ease-out',
        'slide-up': 'slide-up 160ms cubic-bezier(0.16, 1, 0.3, 1)',
        breathe: 'breathe 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
