import { describe, expect, it } from 'vitest';
import { PriorityBand, ReportStatus, type PublicReport } from '@crisismap/shared';

import { UNSCORED_BAND, isPlottable, plottableCount, toIncidentGeoJson } from './incidentGeoJson';

function report(overrides: Partial<PublicReport> = {}): PublicReport {
  return {
    reportId: 'r1',
    status: ReportStatus.VERIFIED,
    category: 'FIRE',
    urgency: 'HIGH',
    priorityScore: 7.2,
    priorityBand: PriorityBand.P1,
    summary: 'Stairwell fire.',
    lat: 41.02,
    lng: 28.98,
    geohash: null,
    geohashPrefix: null,
    regionId: 'kadikoy',
    createdAt: '2026-08-31T10:00:00.000Z',
    updatedAt: '2026-08-31T10:00:00.000Z',
    ...overrides,
  };
}

describe('isPlottable', () => {
  it('rejects a report whose location has not been resolved yet', () => {
    // Reports arrive before geocoding runs (§5.2), so this is an ordinary
    // intermediate state rather than a data fault.
    expect(isPlottable(report({ lat: null, lng: null }))).toBe(false);
    expect(isPlottable(report({ lat: 1, lng: null }))).toBe(false);
  });

  it('keeps a report at exactly 0,0', () => {
    // A classic "unset" sentinel, but also a real location in the Gulf of
    // Guinea. Rejecting it would silently discard genuine reports from there.
    expect(isPlottable(report({ lat: 0, lng: 0 }))).toBe(true);
  });

  it('rejects non-finite coordinates rather than handing NaN to WebGL', () => {
    expect(isPlottable(report({ lat: Number.NaN, lng: 0 }))).toBe(false);
  });
});

describe('toIncidentGeoJson', () => {
  it('projects only the PII-free allow-list onto map features', () => {
    // Feature properties end up in a WebGL buffer and are readable from any
    // popup or `queryRenderedFeatures` call, so this list is a hard boundary.
    const [feature] = toIncidentGeoJson([report()]).features;
    expect(Object.keys(feature!.properties).sort()).toEqual([
      'band',
      'category',
      'reportId',
      'status',
      'summary',
    ]);
  });

  it('orders coordinates lng,lat as GeoJSON requires, not lat,lng', () => {
    // Swapping these is silent: the pins simply appear somewhere else on Earth.
    const [feature] = toIncidentGeoJson([report({ lat: 41.02, lng: 28.98 })]).features;
    expect(feature!.geometry.coordinates).toEqual([28.98, 41.02]);
  });

  it('drops reports with no location instead of plotting them at a default', () => {
    const collection = toIncidentGeoJson([
      report(),
      report({ reportId: 'r2', lat: null, lng: null }),
    ]);
    expect(collection.features.map((f) => f.id)).toEqual(['r1']);
  });

  it('marks an unscored report distinctly rather than as P3', () => {
    // "Not assessed" and "ranks lowest" are different claims; colouring the
    // first as the second tells a coordinator the AI reviewed it and found it
    // routine, which is the opposite of the truth.
    const [feature] = toIncidentGeoJson([
      report({ priorityBand: null, priorityScore: null }),
    ]).features;
    expect(feature!.properties.band).toBe(UNSCORED_BAND);
    expect(feature!.properties.band).not.toBe(PriorityBand.P3);
  });

  it('derives the band from the score when none was persisted', () => {
    const [feature] = toIncidentGeoJson([
      report({ priorityBand: null, priorityScore: 9.1 }),
    ]).features;
    expect(feature!.properties.band).toBe(PriorityBand.P0);
  });

  it('substitutes an empty summary rather than null', () => {
    // MapLibre drops null-valued properties, which would make `['get','summary']`
    // return undefined inside style expressions.
    const [feature] = toIncidentGeoJson([report({ summary: null })]).features;
    expect(feature!.properties.summary).toBe('');
  });

  it('carries a stable feature id so updates reconcile in place', () => {
    const [feature] = toIncidentGeoJson([report()]).features;
    expect(feature!.id).toBe('r1');
  });
});

describe('plottableCount', () => {
  it('counts only what the map can actually show', () => {
    expect(plottableCount([report(), report({ lat: null, lng: null })])).toBe(1);
  });
});
