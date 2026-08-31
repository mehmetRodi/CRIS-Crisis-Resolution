import { describe, expect, it } from 'vitest';

import { RADII, SPACE, TOKENS, color, colorAlpha, type TokenName } from './tokens';

describe('TOKENS', () => {
  it('stores every value as a bare HSL triple, never a colour function', () => {
    // The web app interpolates these into `hsl(var(--x) / <alpha-value>)` so
    // Tailwind opacity modifiers work. A complete colour function here would
    // break every `bg-accent/10` in the product.
    for (const [name, value] of Object.entries(TOKENS)) {
      expect(value, name).toMatch(/^\d{1,3} \d{1,3}% \d{1,3}%$/);
    }
  });

  it('keeps the accent clear of the warm severity spectrum', () => {
    // The whole reason the accent is teal (ADR-0054): if an ordinary button
    // shared a hue with P0–P2, it would read as a critical incident at a glance.
    const hue = (name: TokenName) => Number(TOKENS[name].split(' ')[0]);
    const accent = hue('accent');
    expect(accent).toBeGreaterThan(150);
    expect(accent).toBeLessThan(200);
    for (const band of ['severity-p0', 'severity-p1', 'severity-p2'] as const) {
      const distance = Math.min(Math.abs(hue(band) - accent), 360 - Math.abs(hue(band) - accent));
      expect(distance, band).toBeGreaterThan(90);
    }
  });

  it('keeps P3 chromatically neutral rather than green', () => {
    // Green reads as "resolved"; P3 is an open incident that merely ranks last.
    const [, saturation] = TOKENS['severity-p3'].split(' ');
    expect(Number.parseInt(saturation!, 10)).toBeLessThan(20);
  });

  it('gives unscored a different colour from P3', () => {
    // "Not yet assessed" is not the same claim as "ranks lowest", and a
    // coordinator scanning a queue has to be able to tell them apart.
    expect(TOKENS['severity-none']).not.toBe(TOKENS['severity-p3']);
    expect(TOKENS['severity-none-subtle']).not.toBe(TOKENS['severity-p3-subtle']);
  });

  it('pairs every severity and feedback token with subtle and border variants', () => {
    for (const base of [
      'severity-p0',
      'severity-p1',
      'severity-p2',
      'severity-p3',
      'severity-none',
      'success',
      'warning',
      'danger',
      'info',
    ] as const) {
      expect(TOKENS, base).toHaveProperty(`${base}-subtle`);
      expect(TOKENS, base).toHaveProperty(`${base}-border`);
    }
  });
});

describe('color', () => {
  it('emits the comma-separated form React Native can parse', () => {
    // React Native's colour parser does not reliably accept space-separated
    // CSS Color 4 syntax, and an unparsed colour renders as opaque black
    // rather than throwing — a failure that is easy to ship and hard to spot.
    expect(color('accent')).toBe('hsl(184, 82%, 28%)');
    expect(color('surface')).toBe('hsl(0, 0%, 100%)');
  });
});

describe('colorAlpha', () => {
  it('emits an hsla string', () => {
    expect(colorAlpha('overlay', 0.4)).toBe('hsla(205, 30%, 12%, 0.4)');
  });

  it('clamps out-of-range alpha rather than emitting an invalid colour', () => {
    expect(colorAlpha('overlay', 2)).toBe('hsla(205, 30%, 12%, 1)');
    expect(colorAlpha('overlay', -1)).toBe('hsla(205, 30%, 12%, 0)');
  });
});

describe('scales', () => {
  it('keeps radii ascending so a "larger" name is never smaller', () => {
    expect(RADII.sm).toBeLessThan(RADII.md);
    expect(RADII.md).toBeLessThan(RADII.lg);
    expect(RADII.lg).toBeLessThan(RADII.xl);
    expect(RADII.xl).toBeLessThan(RADII.full);
  });

  it('keeps the spacing scale ascending and on whole pixels', () => {
    // Ascending iteration order is only safe because the keys are NON-numeric:
    // JavaScript hoists integer-like keys into ascending numeric order ahead of
    // everything else, so a Tailwind-style `{ '0.5': 2, '1': 4 }` object would
    // not iterate in written order. This assertion is what pins that choice.
    const values = Object.values(SPACE);
    for (const value of values) expect(Number.isInteger(value)).toBe(true);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
  });
});
