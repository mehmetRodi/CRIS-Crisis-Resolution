import { describe, expect, it } from 'vitest';

import {
  absoluteTime,
  formatConfidence,
  formatScore,
  pluralize,
  relativeTime,
  shortId,
} from './format';

const NOW = new Date('2026-08-31T12:00:00.000Z');

describe('relativeTime', () => {
  it('reports a clock-skewed future timestamp as "now" rather than counting up', () => {
    // A report created moments ago can land a few seconds in the future when
    // the browser clock trails the server's. "in 3 seconds" reads as a bug.
    expect(relativeTime('2026-08-31T12:00:20.000Z', NOW)).toBe('now');
  });

  it.each([
    ['2026-08-31T11:59:30.000Z', 'now'],
    ['2026-08-31T11:56:00.000Z', '4m'],
    ['2026-08-31T09:00:00.000Z', '3h'],
    ['2026-08-25T12:00:00.000Z', '6d'],
  ])('renders %s as %s', (value, expected) => {
    expect(relativeTime(value, NOW)).toBe(expected);
  });

  it('switches to an absolute date once relative time stops being useful', () => {
    // "127d" tells a coordinator nothing they can act on.
    expect(relativeTime('2026-01-02T12:00:00.000Z', NOW)).toMatch(/2026/);
  });

  it('renders an em dash for a missing or unparseable timestamp', () => {
    expect(relativeTime(null, NOW)).toBe('—');
    expect(relativeTime('not a date', NOW)).toBe('—');
  });
});

describe('absoluteTime', () => {
  it('never renders "Invalid Date" to a user', () => {
    expect(absoluteTime('nonsense')).toBe('—');
    expect(absoluteTime(undefined)).toBe('—');
  });
});

describe('formatScore', () => {
  it('always shows one decimal so queue scores stay column-aligned', () => {
    expect(formatScore(8)).toBe('8.0');
    expect(formatScore(7.25)).toBe('7.3');
  });

  it('distinguishes an unscored report from a score of zero', () => {
    expect(formatScore(null)).toBe('—');
    expect(formatScore(0)).toBe('0.0');
  });
});

describe('formatConfidence', () => {
  it('renders model confidence as a whole percentage', () => {
    expect(formatConfidence(0.925)).toBe('93%');
    expect(formatConfidence(null)).toBe('—');
  });
});

describe('shortId', () => {
  it('truncates only when there is something to truncate', () => {
    expect(shortId('01JABCDEF0123456789')).toBe('01JABCDE…');
    expect(shortId('short')).toBe('short');
  });
});

describe('pluralize', () => {
  it('agrees in number', () => {
    expect(pluralize(1, 'incident')).toBe('1 incident');
    expect(pluralize(0, 'incident')).toBe('0 incidents');
    expect(pluralize(2, 'incident')).toBe('2 incidents');
  });
});
