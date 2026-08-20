import { describe, expect, it } from 'vitest';
import { ALERT_TRIGGER_BANDS, matchesSubscription, type AlertCandidate } from './alerts';
import { encodeGeohash } from './geohash';
import { Category, PriorityBand, Urgency } from './domain';

function candidate(overrides: Partial<AlertCandidate> = {}): AlertCandidate {
  return {
    reportId: 'report-1',
    category: Category.FIRE,
    urgency: Urgency.HIGH,
    priorityBand: PriorityBand.P0,
    regionId: 'region-a',
    lat: 41.0082,
    lng: 28.9784, // Istanbul
    geohashPrefix: 'sxk97',
    ...overrides,
  };
}

function subscription(overrides: Partial<Parameters<typeof matchesSubscription>[0]> = {}) {
  return {
    active: true,
    categories: null,
    minUrgency: null,
    centerGeohash: null,
    radiusMeters: null,
    ...overrides,
  };
}

describe('ALERT_TRIGGER_BANDS', () => {
  it('is P0 and P1 only', () => {
    expect(ALERT_TRIGGER_BANDS).toEqual([PriorityBand.P0, PriorityBand.P1]);
  });
});

describe('matchesSubscription', () => {
  it('matches an active subscription with no filters', () => {
    expect(matchesSubscription(subscription(), candidate())).toBe(true);
  });

  it('rejects an inactive subscription', () => {
    expect(matchesSubscription(subscription({ active: false }), candidate())).toBe(false);
  });

  it('filters by category, treating an unclassified candidate as excluded', () => {
    const sub = subscription({ categories: [Category.FIRE, Category.FLOOD] });
    expect(matchesSubscription(sub, candidate({ category: Category.FIRE }))).toBe(true);
    expect(matchesSubscription(sub, candidate({ category: Category.MEDICAL }))).toBe(false);
    expect(matchesSubscription(sub, candidate({ category: null }))).toBe(false);
  });

  it('filters by minimum urgency, treating an unknown urgency as excluded', () => {
    const sub = subscription({ minUrgency: Urgency.HIGH });
    expect(matchesSubscription(sub, candidate({ urgency: Urgency.CRITICAL }))).toBe(true);
    expect(matchesSubscription(sub, candidate({ urgency: Urgency.HIGH }))).toBe(true);
    expect(matchesSubscription(sub, candidate({ urgency: Urgency.MEDIUM }))).toBe(false);
    expect(matchesSubscription(sub, candidate({ urgency: null }))).toBe(false);
  });

  it('filters by radius around centerGeohash, treating an unlocated candidate as excluded', () => {
    const centerGeohash = encodeGeohash(41.0082, 28.9784); // Istanbul
    const sub = subscription({ centerGeohash, radiusMeters: 5000 });
    // Nearby point, within 5km.
    expect(matchesSubscription(sub, candidate({ lat: 41.02, lng: 28.98 }))).toBe(true);
    // Paris — far outside 5km.
    expect(matchesSubscription(sub, candidate({ lat: 48.8566, lng: 2.3522 }))).toBe(false);
    expect(matchesSubscription(sub, candidate({ lat: null, lng: null }))).toBe(false);
  });

  it('treats a subscription with no geofence as region-wide (no distance check)', () => {
    const sub = subscription();
    expect(matchesSubscription(sub, candidate({ lat: null, lng: null }))).toBe(true);
  });

  it('combines all active filters with AND', () => {
    const centerGeohash = encodeGeohash(41.0082, 28.9784);
    const sub = subscription({
      categories: [Category.FIRE],
      minUrgency: Urgency.HIGH,
      centerGeohash,
      radiusMeters: 5000,
    });
    expect(
      matchesSubscription(sub, candidate({ category: Category.FIRE, urgency: Urgency.CRITICAL })),
    ).toBe(true);
    expect(
      matchesSubscription(
        sub,
        candidate({ category: Category.MEDICAL, urgency: Urgency.CRITICAL }),
      ),
    ).toBe(false);
  });
});
