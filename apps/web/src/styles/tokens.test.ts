import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RADII, TOKENS, type TokenName } from '@crisismap/design';

/**
 * Drift guard between `tokens.css` and `@crisismap/design` (CRIS-57, ADR-0057).
 *
 * The palette lives once, in `@crisismap/design`. But a browser needs the values
 * as literal CSS custom properties and no import can bridge TypeScript into a
 * stylesheet, so `tokens.css` restates them. That duplication is unavoidable;
 * letting it drift is not.
 *
 * This test parses the real stylesheet and asserts it matches the shared module
 * exactly, in both directions. Without it, a colour changed in one place and not
 * the other would produce a web app and a mobile app that quietly disagree — the
 * exact failure the shared package was created to prevent.
 *
 * The parse is deliberately naive: a token declaration is `--name: value;`.
 * Anything more sophisticated risks the test agreeing with a stylesheet a
 * browser would read differently.
 */
// Resolved from the Vitest root (`apps/web`) rather than from `import.meta.url`:
// under the jsdom environment Vite rewrites module URLs to a non-`file:` scheme,
// which `fileURLToPath` rejects.
const CSS = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

/**
 * Comments are stripped once, up front, and every assertion below reads this.
 * The file documents the dark-theme seam by SHOWING the selectors it would use,
 * so a check against the raw text would match its own instructions.
 */
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `--name: value;` declaration in the file, comments stripped. */
function parseDeclarations(): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const match of RULES.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    declarations.set(match[1]!, match[2]!.trim());
  }
  return declarations;
}

const declared = parseDeclarations();

describe('tokens.css', () => {
  it('declares every colour token from @crisismap/design, with the same value', () => {
    for (const [name, value] of Object.entries(TOKENS)) {
      expect(declared.get(name), `--${name} missing or changed in tokens.css`).toBe(value);
    }
  });

  it('declares no colour token the shared module does not know about', () => {
    // The reverse direction matters just as much: a token added only to the
    // stylesheet is invisible to React Native, so mobile would silently fall
    // back to some other colour rather than fail.
    const shared = new Set<string>(Object.keys(TOKENS));
    const radiusOrShadow = /^(radius|shadow)/;
    for (const name of declared.keys()) {
      if (radiusOrShadow.test(name)) continue;
      expect(shared.has(name), `--${name} exists in tokens.css but not in @crisismap/design`).toBe(
        true,
      );
    }
  });

  it('expresses the shared radii in rem, matching their pixel values', () => {
    // The shared scale is in pixels because React Native has no relative unit;
    // the stylesheet uses rem. Same numbers, divided by 16.
    const expected: Record<string, number> = {
      'radius-sm': RADII.sm,
      radius: RADII.md,
      'radius-lg': RADII.lg,
      'radius-xl': RADII.xl,
    };
    for (const [cssName, px] of Object.entries(expected)) {
      expect(declared.get(cssName), `--${cssName}`).toBe(`${px / 16}rem`);
    }
  });

  it('keeps the dark-theme seam empty, as ADR-0054 decided', () => {
    // Shipping light-only was a decision, not an oversight. If a dark block
    // appears, the tokens above are no longer the whole palette and this drift
    // guard would stop covering it — so the decision has to be revisited
    // deliberately rather than drifted into.
    expect(RULES).not.toMatch(/\[data-theme=['"]dark['"]\]\s*\{[^}]*--/);
    expect(RULES).not.toMatch(/@media[^{]*prefers-color-scheme:\s*dark[^{]*\{[\s\S]*?--\w/);
  });

  it('names no raw hex or rgb colour outside the shadow definitions', () => {
    // Shadows legitimately use `hsl(... / alpha)` literals. A bare hex anywhere
    // else means a colour escaped the token system.
    const colourDeclarations = [...RULES.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].filter(
      ([, name]) => !/^shadow/.test(name!),
    );
    for (const [, name, value] of colourDeclarations) {
      expect(value, `--${name}`).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(value, `--${name}`).not.toMatch(/\brgba?\(/i);
    }
  });
});

describe('token naming', () => {
  it('exposes each token as a kebab-case name usable as a CSS custom property', () => {
    for (const name of Object.keys(TOKENS) as TokenName[]) {
      expect(name, name).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
    }
  });
});
