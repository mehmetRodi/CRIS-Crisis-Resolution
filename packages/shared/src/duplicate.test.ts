import { describe, expect, it } from 'vitest';
import {
  DUPLICATE_RADIUS_METERS,
  DUPLICATE_REVIEW_THRESHOLD,
  DUPLICATE_STRONG_THRESHOLD,
  DUPLICATE_WEIGHTS,
  DUPLICATE_WINDOW_MINUTES,
  DuplicateVerdict,
  distanceMeters,
  isCompatibleCategory,
  rankDuplicates,
  scoreDuplicate,
  similarityEntity,
  similarityLocation,
  similarityText,
  similarityTime,
  verdictForScore,
  type DuplicateSubject,
} from './duplicate';
import { Category } from './domain';

/** One degree of latitude in metres, for building precise test distances. */
const METERS_PER_DEG_LAT = (Math.PI / 180) * 6_371_000;

function subject(overrides: Partial<DuplicateSubject> = {}): DuplicateSubject {
  return {
    category: Category.FIRE,
    lat: 48.2,
    lng: 16.37,
    createdAt: '2026-07-31T10:00:00.000Z',
    text: 'Gas leak filling the stairwell at north bridge apartments',
    entities: {
      peopleAffected: 12,
      infrastructure: ['north bridge'],
      hazards: ['gas leak'],
    },
    ...overrides,
  };
}

/** Moves a subject `meters` due north, leaving everything else identical. */
function movedNorth(base: DuplicateSubject, meters: number): DuplicateSubject {
  return { ...base, lat: (base.lat as number) + meters / METERS_PER_DEG_LAT };
}

/** Shifts a subject's submit time by `minutes`. */
function shiftedByMinutes(base: DuplicateSubject, minutes: number): DuplicateSubject {
  return {
    ...base,
    createdAt: new Date(Date.parse(base.createdAt) + minutes * 60_000).toISOString(),
  };
}

describe('duplicate detection weights (design doc §5.4.3)', () => {
  it('uses the documented weights', () => {
    expect(DUPLICATE_WEIGHTS).toEqual({
      location: 0.4,
      text: 0.25,
      time: 0.2,
      entity: 0.15,
    });
  });

  it('sums the weights to 1 so Ds stays in [0,1] and the thresholds keep meaning', () => {
    const total = Object.values(DUPLICATE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('uses the documented band thresholds', () => {
    expect(DUPLICATE_STRONG_THRESHOLD).toBe(0.8);
    expect(DUPLICATE_REVIEW_THRESHOLD).toBe(0.65);
  });
});

describe('verdictForScore', () => {
  it('bands scores per §5.4.3', () => {
    expect(verdictForScore(0.95)).toBe(DuplicateVerdict.STRONG);
    expect(verdictForScore(0.72)).toBe(DuplicateVerdict.REVIEW);
    expect(verdictForScore(0.4)).toBe(DuplicateVerdict.DISTINCT);
  });

  it('treats both thresholds as inclusive lower bounds', () => {
    expect(verdictForScore(DUPLICATE_STRONG_THRESHOLD)).toBe(DuplicateVerdict.STRONG);
    expect(verdictForScore(DUPLICATE_REVIEW_THRESHOLD)).toBe(DuplicateVerdict.REVIEW);
    // Just under each boundary drops a band.
    expect(verdictForScore(0.79)).toBe(DuplicateVerdict.REVIEW);
    expect(verdictForScore(0.64)).toBe(DuplicateVerdict.DISTINCT);
  });
});

describe('distanceMeters', () => {
  it('is zero for the same point', () => {
    expect(distanceMeters(48.2, 16.37, 48.2, 16.37)).toBe(0);
  });

  it('measures a known north-south offset', () => {
    const a = subject();
    const b = movedNorth(a, 1_000);
    expect(distanceMeters(a.lat as number, a.lng as number, b.lat as number, b.lng as number)) //
      .toBeCloseTo(1_000, 0);
  });

  it('is symmetric', () => {
    const forward = distanceMeters(48.2, 16.37, 51.5, -0.12);
    const backward = distanceMeters(51.5, -0.12, 48.2, 16.37);
    expect(forward).toBeCloseTo(backward, 6);
  });
});

describe('similarityLocation (L)', () => {
  it('is 1 at the same point and 0 at the radius', () => {
    const a = subject();
    expect(similarityLocation(a, a)).toBe(1);
    expect(similarityLocation(a, movedNorth(a, DUPLICATE_RADIUS_METERS))).toBeCloseTo(0, 3);
  });

  it('falls off linearly between them', () => {
    const a = subject();
    expect(similarityLocation(a, movedNorth(a, DUPLICATE_RADIUS_METERS / 2))).toBeCloseTo(0.5, 3);
  });

  it('never goes negative beyond the radius', () => {
    const a = subject();
    expect(similarityLocation(a, movedNorth(a, DUPLICATE_RADIUS_METERS * 10))).toBe(0);
  });

  it('scores 0 when either report is unlocated — unknown is not evidence of sameness', () => {
    const located = subject();
    const unlocated = subject({ lat: null, lng: null });
    expect(similarityLocation(located, unlocated)).toBe(0);
    expect(similarityLocation(unlocated, located)).toBe(0);
    expect(similarityLocation(unlocated, unlocated)).toBe(0);
  });
});

describe('similarityTime (G)', () => {
  it('is 1 for simultaneous reports and 0 at the window edge', () => {
    const a = subject();
    expect(similarityTime(a, a)).toBe(1);
    expect(similarityTime(a, shiftedByMinutes(a, DUPLICATE_WINDOW_MINUTES))).toBe(0);
  });

  it('is symmetric — order of submission does not matter', () => {
    const a = subject();
    const b = shiftedByMinutes(a, 20);
    expect(similarityTime(a, b)).toBeCloseTo(similarityTime(b, a), 10);
  });

  it('falls off linearly inside the window', () => {
    const a = subject();
    expect(similarityTime(a, shiftedByMinutes(a, DUPLICATE_WINDOW_MINUTES / 2))).toBeCloseTo(
      0.5,
      6,
    );
  });

  it('scores 0 for an unparseable timestamp rather than throwing', () => {
    const a = subject();
    expect(similarityTime(a, subject({ createdAt: 'not-a-date' }))).toBe(0);
  });
});

describe('similarityText (T)', () => {
  it('is 1 for identical text', () => {
    const a = subject();
    expect(similarityText(a, a)).toBe(1);
  });

  it('scores partial keyword overlap by Jaccard', () => {
    const a = subject({ text: 'Gas leak filling the stairwell at north bridge apartments' });
    const b = subject({ text: 'Strong gas leak smell in stairwell near north bridge' });
    // A = {gas, leak, filling, stairwell, north, bridge, apartments}
    // B = {strong, gas, leak, smell, stairwell, north, bridge}
    // |A∩B| = 5 (gas, leak, stairwell, north, bridge); |A∪B| = 9
    expect(similarityText(a, b)).toBeCloseTo(5 / 9, 6);
  });

  it('is 0 for unrelated text', () => {
    const a = subject({ text: 'Gas leak filling the stairwell' });
    const b = subject({ text: 'Flooding submerged the riverside carpark' });
    expect(similarityText(a, b)).toBe(0);
  });

  it('ignores case and punctuation', () => {
    const a = subject({ text: 'Gas leak, stairwell!' });
    const b = subject({ text: 'GAS   LEAK -- STAIRWELL' });
    expect(similarityText(a, b)).toBe(1);
  });

  it('does not let stopwords alone create overlap', () => {
    const a = subject({ text: 'the and for are but not you all' });
    const b = subject({ text: 'the and for are but not you all' });
    // Every token is a stopword, so both sets are empty → 0, not 1.
    expect(similarityText(a, b)).toBe(0);
  });

  it('scores 0 when either report has no text', () => {
    const a = subject();
    expect(similarityText(a, subject({ text: null }))).toBe(0);
    expect(similarityText(a, subject({ text: '' }))).toBe(0);
  });
});

describe('similarityEntity (E)', () => {
  it('is 1 for identical entity sets', () => {
    const a = subject();
    expect(similarityEntity(a, a)).toBe(1);
  });

  it('pools infrastructure and hazards, normalizing case and whitespace', () => {
    const a = subject({
      entities: { peopleAffected: null, infrastructure: ['North Bridge'], hazards: ['Gas Leak'] },
    });
    const b = subject({
      entities: {
        peopleAffected: null,
        infrastructure: ['  north bridge '],
        hazards: ['gas leak'],
      },
    });
    expect(similarityEntity(a, b)).toBe(1);
  });

  it('scores partial overlap', () => {
    const a = subject({
      entities: { peopleAffected: null, infrastructure: ['north bridge'], hazards: ['gas leak'] },
    });
    const b = subject({
      entities: {
        peopleAffected: null,
        infrastructure: ['north bridge'],
        hazards: ['road blocked'],
      },
    });
    // ∩ = {north bridge}; ∪ = {north bridge, gas leak, road blocked}
    expect(similarityEntity(a, b)).toBeCloseTo(1 / 3, 6);
  });

  it('ignores peopleAffected — agreeing on a magnitude is weak evidence', () => {
    const a = subject({
      entities: { peopleAffected: 12, infrastructure: [], hazards: [] },
    });
    const b = subject({
      entities: { peopleAffected: 12, infrastructure: [], hazards: [] },
    });
    expect(similarityEntity(a, b)).toBe(0);
  });

  it('scores 0 when entities are absent', () => {
    const a = subject();
    expect(similarityEntity(a, subject({ entities: null }))).toBe(0);
  });
});

describe('isCompatibleCategory', () => {
  it('accepts only identical categories in the MVP', () => {
    expect(isCompatibleCategory(Category.FIRE, Category.FIRE)).toBe(true);
    expect(isCompatibleCategory(Category.FIRE, Category.FLOOD)).toBe(false);
  });
});

describe('scoreDuplicate (Ds)', () => {
  it('links two near-identical nearby reports strongly', () => {
    const a = subject();
    const b = subject({ text: 'Strong gas leak smell in stairwell near north bridge' });
    const result = scoreDuplicate(a, b);

    // L=1, G=1, E=1, T=5/9 → 0.4 + 0.2 + 0.15 + 0.25·(5/9) = 0.8889
    expect(result.score).toBeCloseTo(0.89, 2);
    expect(result.verdict).toBe(DuplicateVerdict.STRONG);
  });

  it('returns the component breakdown so a coordinator can see why', () => {
    const a = subject();
    const result = scoreDuplicate(a, a);
    expect(result.components).toEqual({ location: 1, text: 1, time: 1, entity: 1 });
    expect(result.score).toBe(1);
  });

  it('gates out an incompatible category regardless of every other signal', () => {
    const a = subject({ category: Category.FIRE });
    // Identical in every other respect — same point, same instant, same text.
    const b = subject({ category: Category.FLOOD });
    const result = scoreDuplicate(a, b);

    expect(result.score).toBe(0);
    expect(result.verdict).toBe(DuplicateVerdict.DISTINCT);
    // The gate is a precondition, not a weighted term — no component leaks through.
    expect(result.components).toEqual({ location: 0, text: 0, time: 0, entity: 0 });
  });

  it('can never auto-group an unlocated report, however well everything else matches', () => {
    const a = subject({ lat: null, lng: null });
    const b = subject({ lat: null, lng: null });
    const result = scoreDuplicate(a, b);

    // Perfect T, G, E caps at 0.25 + 0.20 + 0.15 = 0.60, below the review band.
    expect(result.score).toBeCloseTo(0.6, 6);
    expect(result.score).toBeLessThan(DUPLICATE_REVIEW_THRESHOLD);
    expect(result.verdict).toBe(DuplicateVerdict.DISTINCT);
  });

  it('bands on the raw score, not the rounded one, at the 0.80 boundary', () => {
    // Constructed so Ds is exactly 0.795: L=1 (same point), G=1 (same instant),
    // T=12/25=0.48 (12 shared of 25 distinct tokens), E=1/2 (1 shared of 2).
    //   0.40·1 + 0.25·0.48 + 0.20·1 + 0.15·0.5 = 0.795
    // `round2(0.795)` is 0.80, so rounding before banding would auto-group this
    // pair — silently moving the published threshold. It must stay REVIEW.
    const shared = Array.from({ length: 12 }, (_, i) => `shared${i}`);
    const onlyA = Array.from({ length: 8 }, (_, i) => `alpha${i}`);
    const onlyB = Array.from({ length: 5 }, (_, i) => `bravo${i}`);

    const a = subject({
      text: [...shared, ...onlyA].join(' '),
      entities: { peopleAffected: 0, infrastructure: ['north bridge', 'east pier'], hazards: [] },
    });
    const b = subject({
      text: [...shared, ...onlyB].join(' '),
      entities: { peopleAffected: 0, infrastructure: ['north bridge'], hazards: [] },
    });

    const result = scoreDuplicate(a, b);

    expect(result.components).toEqual({ location: 1, text: 0.48, time: 1, entity: 0.5 });
    // Displayed score rounds up to the threshold...
    expect(result.score).toBe(0.8);
    // ...but the verdict is decided on the raw 0.795, which is below it.
    expect(result.verdict).toBe(DuplicateVerdict.REVIEW);
  });

  it('suggests review for a moderately distant, moderately delayed match', () => {
    const a = subject();
    const b = shiftedByMinutes(movedNorth(a, DUPLICATE_RADIUS_METERS / 2), 30);
    const result = scoreDuplicate(a, b);

    // L=0.5, G=0.5, T=1, E=1 → 0.2 + 0.1 + 0.25 + 0.15 = 0.70
    expect(result.score).toBeCloseTo(0.7, 2);
    expect(result.verdict).toBe(DuplicateVerdict.REVIEW);
  });

  it('is symmetric', () => {
    const a = subject();
    const b = shiftedByMinutes(movedNorth(a, 800), 12);
    expect(scoreDuplicate(a, b).score).toBe(scoreDuplicate(b, a).score);
  });

  it('treats two distant, unrelated reports as distinct', () => {
    const a = subject();
    const b = subject({
      lat: 51.5,
      lng: -0.12,
      createdAt: '2026-07-31T18:00:00.000Z',
      text: 'Flooding submerged the riverside carpark',
      entities: { peopleAffected: null, infrastructure: ['carpark'], hazards: ['flooding'] },
    });
    expect(scoreDuplicate(a, b).verdict).toBe(DuplicateVerdict.DISTINCT);
  });
});

describe('rankDuplicates', () => {
  it('returns matches strongest-first and drops distinct ones', () => {
    const base = subject();
    const strong = { ...subject(), reportId: 'r-strong' };
    const review = {
      ...shiftedByMinutes(movedNorth(base, DUPLICATE_RADIUS_METERS / 2), 30),
      reportId: 'r-review',
    };
    const distinct = {
      ...subject({ lat: 51.5, lng: -0.12, text: 'Flooding at the riverside carpark' }),
      reportId: 'r-distinct',
    };

    const ranked = rankDuplicates(base, [review, distinct, strong]);

    expect(ranked.map((m) => m.reportId)).toEqual(['r-strong', 'r-review']);
    expect(ranked[0]?.verdict).toBe(DuplicateVerdict.STRONG);
    expect(ranked[1]?.verdict).toBe(DuplicateVerdict.REVIEW);
  });

  it('breaks ties deterministically by reportId, whatever order candidates arrive in', () => {
    const base = subject();
    const b = { ...subject(), reportId: 'b' };
    const a = { ...subject(), reportId: 'a' };
    const c = { ...subject(), reportId: 'c' };

    expect(rankDuplicates(base, [b, a, c]).map((m) => m.reportId)).toEqual(['a', 'b', 'c']);
    expect(rankDuplicates(base, [c, b, a]).map((m) => m.reportId)).toEqual(['a', 'b', 'c']);
  });

  it("carries each candidate's existing group so the worker can join it", () => {
    const base = subject();
    const ranked = rankDuplicates(base, [
      { ...subject(), reportId: 'r1', duplicateGroupId: 'group-7' },
    ]);
    expect(ranked[0]?.duplicateGroupId).toBe('group-7');
  });

  it('normalizes a missing group to null rather than undefined', () => {
    const ranked = rankDuplicates(subject(), [{ ...subject(), reportId: 'r1' }]);
    expect(ranked[0]?.duplicateGroupId).toBeNull();
  });

  it('returns an empty list when there are no candidates', () => {
    expect(rankDuplicates(subject(), [])).toEqual([]);
  });
});
