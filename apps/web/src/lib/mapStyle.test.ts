import { describe, expect, it } from 'vitest';

import { DEMO_MAP_STYLE, resolveMapStyle } from './mapStyle';

describe('resolveMapStyle', () => {
  it('falls back to the demo style when unset', () => {
    expect(resolveMapStyle(undefined)).toEqual({ url: DEMO_MAP_STYLE, isDemo: true });
  });

  it('falls back to the demo style when blank', () => {
    expect(resolveMapStyle('   ')).toEqual({ url: DEMO_MAP_STYLE, isDemo: true });
  });

  it('uses the configured style when present', () => {
    expect(resolveMapStyle('https://example.com/style.json')).toEqual({
      url: 'https://example.com/style.json',
      isDemo: false,
    });
  });
});
