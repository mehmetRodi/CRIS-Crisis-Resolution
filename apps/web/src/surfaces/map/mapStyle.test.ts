import { describe, expect, it } from 'vitest';
import { DEMO_MAP_STYLE, resolveMapStyle } from './mapStyle';

describe('resolveMapStyle', () => {
  it('uses a configured style URL and marks it non-demo', () => {
    const style = resolveMapStyle('https://maps.example/als/style.json');
    expect(style).toEqual({ url: 'https://maps.example/als/style.json', isDemo: false });
  });

  it('falls back to the public demo style when unset', () => {
    expect(resolveMapStyle(undefined)).toEqual({ url: DEMO_MAP_STYLE, isDemo: true });
  });

  it('treats a blank/whitespace value as unset', () => {
    expect(resolveMapStyle('   ').isDemo).toBe(true);
    expect(resolveMapStyle('').isDemo).toBe(true);
  });
});
