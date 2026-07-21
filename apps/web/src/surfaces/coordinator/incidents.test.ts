import { describe, expect, it } from 'vitest';
import { Category, PriorityBand, type PublicReport } from '@crisismap/shared';
import { bandOf, countByBand, countByCategory, countUnscored, sortByPriority } from './incidents';

/** Minimal PublicReport factory — only the fields the read-model reads. */
function incident(overrides: Partial<PublicReport> = {}): PublicReport {
  return {
    reportId: 'r',
    status: 'AI_CLASSIFIED',
    category: null,
    urgency: null,
    priorityScore: null,
    priorityBand: null,
    summary: null,
    lat: null,
    lng: null,
    geohash: null,
    geohashPrefix: null,
    regionId: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

describe('bandOf', () => {
  it('prefers the persisted band', () => {
    expect(bandOf(incident({ priorityBand: PriorityBand.P1, priorityScore: 1 }))).toBe(
      PriorityBand.P1,
    );
  });

  it('derives the band from the score when no band is stored', () => {
    expect(bandOf(incident({ priorityScore: 9 }))).toBe(PriorityBand.P0);
    expect(bandOf(incident({ priorityScore: 2 }))).toBe(PriorityBand.P3);
  });

  it('returns null for not-yet-scored incidents', () => {
    expect(bandOf(incident())).toBeNull();
  });
});

describe('countByBand', () => {
  it('tallies scored incidents per band and ignores unscored ones', () => {
    const counts = countByBand([
      incident({ priorityBand: PriorityBand.P0 }),
      incident({ priorityBand: PriorityBand.P0 }),
      incident({ priorityScore: 6 }), // derives P1
      incident(), // unscored — excluded
    ]);
    expect(counts).toEqual({ P0: 2, P1: 1, P2: 0, P3: 0 });
  });
});

describe('countUnscored', () => {
  it('counts incidents with no band and no score', () => {
    expect(countUnscored([incident(), incident({ priorityBand: PriorityBand.P2 })])).toBe(1);
  });
});

describe('countByCategory', () => {
  it('groups by category, highest first, folding null into OTHER', () => {
    const result = countByCategory([
      incident({ category: Category.MEDICAL }),
      incident({ category: Category.MEDICAL }),
      incident({ category: Category.FIRE }),
      incident({ category: null }), // → OTHER
    ]);
    expect(result[0]).toEqual({ category: Category.MEDICAL, count: 2 });
    expect(result).toContainEqual({ category: Category.FIRE, count: 1 });
    expect(result).toContainEqual({ category: Category.OTHER, count: 1 });
  });
});

describe('sortByPriority', () => {
  it('orders by score desc, unscored last, newest first on ties', () => {
    const low = incident({ reportId: 'low', priorityScore: 2 });
    const high = incident({ reportId: 'high', priorityScore: 9 });
    const unscored = incident({ reportId: 'unscored' });
    const tieOld = incident({
      reportId: 'old',
      priorityScore: 5,
      createdAt: '2026-01-01T00:00:00Z',
    });
    const tieNew = incident({
      reportId: 'new',
      priorityScore: 5,
      createdAt: '2026-02-01T00:00:00Z',
    });

    const order = sortByPriority([low, unscored, tieOld, high, tieNew]).map((i) => i.reportId);
    expect(order).toEqual(['high', 'new', 'old', 'low', 'unscored']);
  });

  it('does not mutate the input', () => {
    const input = [incident({ priorityScore: 1 }), incident({ priorityScore: 9 })];
    const snapshot = [...input];
    sortByPriority(input);
    expect(input).toEqual(snapshot);
  });
});
