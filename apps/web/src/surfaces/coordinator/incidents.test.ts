import { describe, expect, it } from 'vitest';
import {
  Category,
  PriorityBand,
  ReportEventType,
  ReportStatus,
  UserRole,
  type PublicReport,
} from '@crisismap/shared';
import {
  applyFilters,
  bandOf,
  countByBand,
  countByCategory,
  countUnscored,
  EMPTY_FILTERS,
  filtersActive,
  matchesFilters,
  reconcileIncident,
  regionOptions,
  sortByPriority,
  sortTimeline,
  searchIncidents,
  sortByRecency,
  sortIncidents,
  toggleValue,
  toTimelineEvent,
  type IncidentFilters,
  type CoordinatorIncident,
  type TimelineEvent,
} from './incidents';

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

describe('reconcileIncident', () => {
  const coordinatorIncident = (
    overrides: Partial<CoordinatorIncident> = {},
  ): CoordinatorIncident => ({
    ...incident(),
    version: 1,
    confidence: null,
    scoreVersion: null,
    scoreBreakdown: null,
    entities: null,
    assignedTeamId: null,
    ...overrides,
  });

  it('upserts, bounds, and refuses to regress a newer optimistic-lock version', () => {
    const current = [
      coordinatorIncident({ reportId: 'existing', version: 3, priorityScore: 2 }),
      coordinatorIncident({ reportId: 'lower', priorityScore: 1 }),
    ];

    expect(
      reconcileIncident(
        current,
        coordinatorIncident({ reportId: 'existing', version: 2, priorityScore: 9 }),
        2,
      ),
    ).toEqual(current);

    const inserted = reconcileIncident(
      current,
      coordinatorIncident({ reportId: 'new', priorityScore: 10 }),
      2,
    );
    expect(inserted.map((item) => item.reportId)).toEqual(['new', 'existing']);
  });
});

describe('filtersActive', () => {
  it('is false for the empty filter and true once any facet is set', () => {
    expect(filtersActive(EMPTY_FILTERS)).toBe(false);
    expect(filtersActive({ ...EMPTY_FILTERS, categories: [Category.FIRE] })).toBe(true);
    expect(filtersActive({ ...EMPTY_FILTERS, statuses: [ReportStatus.NEW] })).toBe(true);
    expect(filtersActive({ ...EMPTY_FILTERS, regionIds: ['region-a'] })).toBe(true);
  });
});

describe('matchesFilters', () => {
  const filters: IncidentFilters = {
    categories: [Category.MEDICAL, Category.FIRE],
    statuses: [ReportStatus.VERIFIED],
    regionIds: ['region-a'],
  };

  it('passes an incident satisfying every non-empty facet (AND across facets)', () => {
    expect(
      matchesFilters(
        incident({ category: Category.FIRE, status: ReportStatus.VERIFIED, regionId: 'region-a' }),
        filters,
      ),
    ).toBe(true);
  });

  it('fails when any single facet is not satisfied', () => {
    const base = { category: Category.FIRE, status: ReportStatus.VERIFIED, regionId: 'region-a' };
    expect(matchesFilters(incident({ ...base, category: Category.FLOOD }), filters)).toBe(false);
    expect(matchesFilters(incident({ ...base, status: ReportStatus.NEW }), filters)).toBe(false);
    expect(matchesFilters(incident({ ...base, regionId: 'region-b' }), filters)).toBe(false);
  });

  it('treats a null category/region as not matching an active facet', () => {
    expect(
      matchesFilters(
        incident({ category: null, status: ReportStatus.VERIFIED, regionId: 'region-a' }),
        filters,
      ),
    ).toBe(false);
  });

  it('imposes no constraint from an empty facet', () => {
    // Only status is constrained; category/region are unconstrained (empty).
    expect(
      matchesFilters(incident({ category: null, regionId: null, status: ReportStatus.NEW }), {
        ...EMPTY_FILTERS,
        statuses: [ReportStatus.NEW],
      }),
    ).toBe(true);
  });
});

describe('applyFilters', () => {
  it('returns a copy of all incidents when no facet is active', () => {
    const input = [incident({ reportId: 'a' }), incident({ reportId: 'b' })];
    const result = applyFilters(input, EMPTY_FILTERS);
    expect(result.map((i) => i.reportId)).toEqual(['a', 'b']);
    expect(result).not.toBe(input); // new array, input not mutated
  });

  it('narrows to the matching incidents', () => {
    const input = [
      incident({ reportId: 'fire', category: Category.FIRE }),
      incident({ reportId: 'flood', category: Category.FLOOD }),
      incident({ reportId: 'medical', category: Category.MEDICAL }),
    ];
    const result = applyFilters(input, {
      ...EMPTY_FILTERS,
      categories: [Category.FIRE, Category.MEDICAL],
    });
    expect(result.map((i) => i.reportId)).toEqual(['fire', 'medical']);
  });
});

describe('regionOptions', () => {
  it('returns the distinct non-empty region ids, sorted', () => {
    expect(
      regionOptions([
        incident({ regionId: 'region-b' }),
        incident({ regionId: 'region-a' }),
        incident({ regionId: 'region-b' }),
        incident({ regionId: null }),
      ]),
    ).toEqual(['region-a', 'region-b']);
  });
});

describe('toggleValue', () => {
  it('adds an absent value and removes a present one, without mutating', () => {
    const input = ['a', 'b'];
    expect(toggleValue(input, 'c')).toEqual(['a', 'b', 'c']);
    expect(toggleValue(input, 'a')).toEqual(['b']);
    expect(input).toEqual(['a', 'b']);
  });
});

describe('toTimelineEvent', () => {
  it('projects a status-change event, extracting the operator note from detail', () => {
    const event = toTimelineEvent({
      eventId: 'evt-1',
      type: ReportEventType.STATUS_CHANGED,
      fromStatus: 'AI_CLASSIFIED',
      toStatus: 'VERIFIED',
      actorId: 'user-123',
      actorRole: UserRole.COORDINATOR,
      version: 3,
      detail: { note: 'confirmed by field team' },
      createdAt: '2026-07-15T11:00:00Z',
    });
    expect(event).toEqual<TimelineEvent>({
      eventId: 'evt-1',
      type: ReportEventType.STATUS_CHANGED,
      fromStatus: 'AI_CLASSIFIED',
      toStatus: 'VERIFIED',
      actorRole: UserRole.COORDINATOR,
      isSystem: false,
      note: 'confirmed by field team',
      version: 3,
      createdAt: '2026-07-15T11:00:00Z',
    });
  });

  it('flags SYSTEM actors and tolerates a missing/blank note', () => {
    const event = toTimelineEvent({
      eventId: 'evt-2',
      type: ReportEventType.CLASSIFIED,
      actorId: 'SYSTEM',
      detail: { note: '   ' },
    });
    expect(event.isSystem).toBe(true);
    expect(event.actorRole).toBeNull();
    expect(event.note).toBeNull();
  });

  it('degrades an unknown type/role rather than dropping the entry', () => {
    const event = toTimelineEvent({ eventId: 'evt-3', type: 'BOGUS', actorRole: 'WIZARD' });
    expect(event.type).toBe(ReportEventType.STATUS_CHANGED);
    expect(event.actorRole).toBeNull();
    expect(event.note).toBeNull();
  });

  it('falls back to the record id when eventId is absent', () => {
    expect(toTimelineEvent({ id: 'row-1' }).eventId).toBe('row-1');
  });
});

describe('sortTimeline', () => {
  const at = (eventId: string, createdAt: string | null, version: number): TimelineEvent => ({
    eventId,
    type: ReportEventType.STATUS_CHANGED,
    fromStatus: null,
    toStatus: null,
    actorRole: null,
    isSystem: false,
    note: null,
    version,
    createdAt,
  });

  it('orders newest-first and does not mutate the input', () => {
    const input = [
      at('old', '2026-07-15T10:00:00Z', 1),
      at('new', '2026-07-15T12:00:00Z', 3),
      at('mid', '2026-07-15T11:00:00Z', 2),
    ];
    expect(sortTimeline(input).map((e) => e.eventId)).toEqual(['new', 'mid', 'old']);
    expect(input[0]?.eventId).toBe('old');
  });

  it('breaks ties on the same timestamp by higher version', () => {
    const ts = '2026-07-15T10:00:00Z';
    expect(sortTimeline([at('v1', ts, 1), at('v2', ts, 2)]).map((e) => e.eventId)).toEqual([
      'v2',
      'v1',
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* Queue search, ordering, and the band facet (CRIS-54)                        */
/* -------------------------------------------------------------------------- */

describe('searchIncidents', () => {
  const feed = [
    incident({ reportId: 'a', summary: 'Gas leak in the stairwell', regionId: 'kadikoy' }),
    incident({ reportId: 'b', summary: 'Bridge collapse', category: Category.STRUCTURAL_DAMAGE }),
  ];

  it('returns everything for a blank or whitespace-only query', () => {
    expect(searchIncidents(feed, '')).toHaveLength(2);
    expect(searchIncidents(feed, '   ')).toHaveLength(2);
  });

  it('matches the AI summary case-insensitively', () => {
    expect(searchIncidents(feed, 'GAS').map((i) => i.reportId)).toEqual(['a']);
  });

  it('matches region, category, status, and id as well as summary', () => {
    expect(searchIncidents(feed, 'kadikoy').map((i) => i.reportId)).toEqual(['a']);
    expect(searchIncidents(feed, 'structural').map((i) => i.reportId)).toEqual(['b']);
    expect(searchIncidents(feed, 'ai_classified')).toHaveLength(2);
  });

  it('tolerates an incident with nothing to match against', () => {
    expect(searchIncidents([incident({ reportId: 'c' })], 'anything')).toEqual([]);
  });

  it('does not mutate its input', () => {
    const original = [...feed];
    searchIncidents(feed, 'gas');
    expect(feed).toEqual(original);
  });
});

describe('sortByRecency', () => {
  it('puts the newest report first', () => {
    const sorted = sortByRecency([
      incident({ reportId: 'old', createdAt: '2026-08-01T00:00:00.000Z' }),
      incident({ reportId: 'new', createdAt: '2026-08-31T00:00:00.000Z' }),
    ]);
    expect(sorted.map((i) => i.reportId)).toEqual(['new', 'old']);
  });

  it('sorts a report with no usable timestamp last, not first', () => {
    // A missing date parses to NaN. Left unhandled, comparator NaNs make the
    // order arbitrary — and an undated report floating to the top of a "newest"
    // list would read as the most recent thing that happened.
    const sorted = sortByRecency([
      incident({ reportId: 'undated', createdAt: null }),
      incident({ reportId: 'bad', createdAt: 'not a date' }),
      incident({ reportId: 'dated', createdAt: '2026-08-31T00:00:00.000Z' }),
    ]);
    expect(sorted[0]?.reportId).toBe('dated');
    expect(
      sorted
        .slice(1)
        .map((i) => i.reportId)
        .sort(),
    ).toEqual(['bad', 'undated']);
  });
});

describe('sortIncidents', () => {
  const feed = [
    incident({ reportId: 'low-recent', priorityScore: 1, createdAt: '2026-08-31T00:00:00.000Z' }),
    incident({ reportId: 'high-old', priorityScore: 9, createdAt: '2026-08-01T00:00:00.000Z' }),
  ];

  it('ranks by priority by default', () => {
    expect(sortIncidents(feed, 'priority').map((i) => i.reportId)).toEqual([
      'high-old',
      'low-recent',
    ]);
  });

  it('surfaces what just arrived when sorting by recency', () => {
    // A priority sort actively hides a newly-arrived low-priority report at the
    // bottom of a long queue, which is the wrong view while a situation is
    // still unfolding.
    expect(sortIncidents(feed, 'recent').map((i) => i.reportId)).toEqual([
      'low-recent',
      'high-old',
    ]);
  });
});

describe('priority band facet', () => {
  it('counts as active and narrows to the selected bands', () => {
    const filters: IncidentFilters = { ...EMPTY_FILTERS, priorityBands: [PriorityBand.P0] };
    expect(filtersActive(filters)).toBe(true);
    expect(matchesFilters(incident({ priorityBand: PriorityBand.P0 }), filters)).toBe(true);
    expect(matchesFilters(incident({ priorityBand: PriorityBand.P1 }), filters)).toBe(false);
  });

  it('matches the DISPLAYED band, so a scored record with no stored band counts', () => {
    const filters: IncidentFilters = { ...EMPTY_FILTERS, priorityBands: [PriorityBand.P0] };
    // The queue already renders this as P0 via `bandOf`; the facet must agree,
    // or filtering would hide a row the user can see is a P0.
    expect(matchesFilters(incident({ priorityBand: null, priorityScore: 9 }), filters)).toBe(true);
  });

  it('excludes an unscored report from every band facet', () => {
    const filters: IncidentFilters = { ...EMPTY_FILTERS, priorityBands: [PriorityBand.P3] };
    // "Not yet assessed" is not the same claim as "ranks lowest".
    expect(matchesFilters(incident({ priorityBand: null, priorityScore: null }), filters)).toBe(
      false,
    );
  });

  it('treats an absent priorityBands field as no constraint', () => {
    // Filter objects written before this facet existed must still mean
    // "unfiltered" rather than "match nothing".
    const legacy = { categories: [], statuses: [], regionIds: [] } as IncidentFilters;
    expect(filtersActive(legacy)).toBe(false);
    expect(matchesFilters(incident(), legacy)).toBe(true);
  });
});
