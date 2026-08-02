import { describe, expect, it, vi } from 'vitest';
import { Category, DUPLICATE_WINDOW_MINUTES } from '@crisismap/shared';
import { resolveDuplicates, type DedupeDeps, type DedupeInput } from './dedupe';
import { DUPLICATE_GROUP_MAX_MEMBERS } from './store';
import type {
  DuplicateCandidateRecord,
  FindDuplicateCandidatesInput,
  LinkDuplicateGroupInput,
} from './store';

/**
 * Duplicate-grouping orchestration (§5.4.3, CRIS-31).
 *
 * The similarity maths is covered in `@crisismap/shared`'s duplicate.test.ts;
 * these tests own the I/O decisions around it — which candidates are fetched,
 * which group is joined, and what happens when a write loses its race.
 */

const NOW = '2026-07-31T12:00:00.000Z';

/** A candidate near-identical to the subject — scores STRONG. */
function candidate(overrides: Partial<DuplicateCandidateRecord> = {}): DuplicateCandidateRecord {
  return {
    reportId: 'r-peer',
    category: Category.FIRE,
    lat: 48.2,
    lng: 16.37,
    createdAt: NOW,
    text: 'Gas leak filling the stairwell at north bridge apartments',
    entities: { peopleAffected: 12, infrastructure: ['north bridge'], hazards: ['gas leak'] },
    duplicateGroupId: null,
    version: 5,
    ...overrides,
  };
}

function input(overrides: Partial<DedupeInput> = {}): DedupeInput {
  return {
    reportId: 'r-subject',
    version: 3,
    geohashPrefix: 'u2edk',
    now: NOW,
    streamEventId: 'evt-1',
    subject: {
      category: Category.FIRE,
      lat: 48.2,
      lng: 16.37,
      createdAt: NOW,
      text: 'Gas leak filling the stairwell at north bridge apartments',
      entities: { peopleAffected: 12, infrastructure: ['north bridge'], hazards: ['gas leak'] },
    },
    ...overrides,
  };
}

function fakeDeps(candidates: DuplicateCandidateRecord[], linkResults: boolean[] = []) {
  const queries: FindDuplicateCandidatesInput[] = [];
  const links: LinkDuplicateGroupInput[] = [];
  const logs: Record<string, unknown>[] = [];
  let linkCall = 0;

  const deps: DedupeDeps = {
    store: {
      findDuplicateCandidates: vi.fn(async (q: FindDuplicateCandidatesInput) => {
        queries.push(q);
        return candidates;
      }),
      linkDuplicateGroup: vi.fn(async (l: LinkDuplicateGroupInput) => {
        links.push(l);
        return linkResults[linkCall++] ?? true;
      }),
    },
    log: (entry) => logs.push(entry),
    newGroupId: () => 'group-new',
  };
  return { deps, queries, links, logs };
}

const events = (logs: Record<string, unknown>[]) => logs.map((l) => l.event);

describe('resolveDuplicates', () => {
  it('skips an unlocated report without querying — it could never qualify anyway', async () => {
    const { deps, queries, logs } = fakeDeps([candidate()]);

    const result = await resolveDuplicates(deps, input({ geohashPrefix: null }));

    expect(queries).toHaveLength(0);
    expect(result.duplicateGroupId).toBeNull();
    expect(events(logs)).toContain('dedupe.skip.unlocated');
  });

  it('queries its own geohash cell over the §5.4.3 recency window', async () => {
    const { deps, queries } = fakeDeps([]);

    await resolveDuplicates(deps, input());

    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({
      geohashPrefix: 'u2edk',
      excludeReportId: 'r-subject',
    });
    const expectedSince = new Date(
      Date.parse(NOW) - DUPLICATE_WINDOW_MINUTES * 60_000,
    ).toISOString();
    expect(queries[0]?.since).toBe(expectedSince);
  });

  it('links nothing when there are no candidates', async () => {
    const { deps, links, logs } = fakeDeps([]);

    const result = await resolveDuplicates(deps, input());

    expect(links).toHaveLength(0);
    expect(result).toEqual({ duplicateGroupId: null, linked: [], suggested: [] });
    expect(events(logs)).toContain('dedupe.none');
  });

  it('mints a group and links both members when neither is grouped yet', async () => {
    const { deps, links } = fakeDeps([candidate()]);

    const result = await resolveDuplicates(deps, input());

    expect(result.duplicateGroupId).toBe('group-new');
    // One atomic write, not two independent ones.
    expect(links).toHaveLength(1);
    expect(links[0]?.duplicateGroupId).toBe('group-new');
    expect(links[0]?.members).toHaveLength(2);
    expect(links[0]?.members).toEqual([
      expect.objectContaining({ reportId: 'r-subject', expectedVersion: 3 }),
      expect.objectContaining({ reportId: 'r-peer', expectedVersion: 5 }),
    ]);
  });

  it('gives each linked report its own derived, stable eventId', async () => {
    // Both appends trace to one classification, so a shared stream event id must
    // still yield distinct `eventId`s — and a redelivery must reproduce them
    // rather than append a second pair (§5.4.4).
    const { deps, links } = fakeDeps([candidate()]);

    await resolveDuplicates(deps, input({ streamEventId: 'evt-42' }));

    expect(links[0]?.members.map((m) => m.eventId)).toEqual([
      'evt-42#dup#r-subject',
      'evt-42#dup#r-peer',
    ]);
  });

  it('joins an existing group rather than minting a second one', async () => {
    const { deps, links } = fakeDeps([candidate({ duplicateGroupId: 'group-7' })]);

    const result = await resolveDuplicates(deps, input());

    expect(result.duplicateGroupId).toBe('group-7');
    // Only the subject is written — the peer is already in the group.
    expect(links[0]?.members).toHaveLength(1);
    expect(links[0]?.members[0]).toMatchObject({ reportId: 'r-subject' });
    expect(links[0]?.members[0]?.detail).toMatchObject({ joinedExistingGroup: true });
  });

  it('converges several reports of one incident onto a single group', async () => {
    // Two strong matches, one already grouped. The existing group wins over
    // minting, AND the ungrouped match joins it too — leaving r-a stranded would
    // split one incident across a group and a loose report.
    const { deps, links } = fakeDeps([
      candidate({ reportId: 'r-a', duplicateGroupId: null, version: 2 }),
      candidate({ reportId: 'r-b', duplicateGroupId: 'group-existing', version: 9 }),
    ]);

    const result = await resolveDuplicates(deps, input());

    expect(result.duplicateGroupId).toBe('group-existing');
    expect(links[0]?.duplicateGroupId).toBe('group-existing');
    expect(links[0]?.members.map((m) => m.reportId).sort()).toEqual(['r-a', 'r-subject']);
    // r-b is already in the group — no redundant write.
    expect(links[0]?.members.map((m) => m.reportId)).not.toContain('r-b');
  });

  it('names a report that is actually in the joined group on the audit detail', async () => {
    // The anchor must be the match that supplied the group, not merely the
    // highest-scoring one — otherwise the audit points a coordinator at a report
    // that is not in the group they are looking at.
    const near = candidate({ reportId: 'r-near', duplicateGroupId: null, version: 2 });
    const grouped = candidate({
      reportId: 'r-grouped',
      duplicateGroupId: 'group-existing',
      version: 9,
      // Slightly weaker than r-near, but it is the one carrying the group.
      createdAt: new Date(Date.parse(NOW) - 5 * 60_000).toISOString(),
    });
    const { deps, links } = fakeDeps([near, grouped]);

    await resolveDuplicates(deps, input());

    const subjectMember = links[0]?.members.find((m) => m.reportId === 'r-subject');
    expect(subjectMember?.detail).toMatchObject({
      matchedReportId: 'r-grouped',
      joinedExistingGroup: true,
    });
  });

  it('abandons the whole grouping when the transaction loses its race', async () => {
    // Atomicity collapses the old two-write failure modes into one: either every
    // member landed or none did, so there is no partial state to unwind.
    const { deps, links, logs } = fakeDeps([candidate()], [false]);

    const result = await resolveDuplicates(deps, input());

    expect(result.duplicateGroupId).toBeNull();
    expect(links).toHaveLength(1);
    expect(events(logs)).toContain('dedupe.linkFailed');
  });

  it('caps members at the transaction limit and says so', async () => {
    // A silently short group would read as "these are all the duplicates".
    const many = Array.from({ length: DUPLICATE_GROUP_MAX_MEMBERS + 5 }, (_, i) =>
      candidate({ reportId: `r-${i}`, duplicateGroupId: null, version: 2 }),
    );
    const { deps, links, logs } = fakeDeps(many);

    await resolveDuplicates(deps, input());

    expect(links[0]?.members).toHaveLength(DUPLICATE_GROUP_MAX_MEMBERS);
    // The subject is never the one dropped.
    expect(links[0]?.members[0]?.reportId).toBe('r-subject');
    expect(events(logs)).toContain('dedupe.membersCapped');
  });

  it('suggests borderline matches for review without grouping them', async () => {
    // ~1 km away and 30 min later → Ds ≈ 0.70, the REVIEW band.
    const drifted = candidate({
      lat: 48.2 + 1_000 / ((Math.PI / 180) * 6_371_000),
      createdAt: new Date(Date.parse(NOW) - 30 * 60_000).toISOString(),
    });
    const { deps, links, logs } = fakeDeps([drifted]);

    const result = await resolveDuplicates(deps, input());

    expect(result.duplicateGroupId).toBeNull();
    expect(result.linked).toHaveLength(0);
    expect(result.suggested).toHaveLength(1);
    expect(result.suggested[0]?.reportId).toBe('r-peer');
    // Recorded for a coordinator, never auto-applied.
    expect(links).toHaveLength(0);
    expect(events(logs)).toContain('dedupe.suggest');
  });

  it('ignores a candidate in a different category however close it is', async () => {
    const { deps, links } = fakeDeps([candidate({ category: Category.FLOOD })]);

    const result = await resolveDuplicates(deps, input());

    expect(result.duplicateGroupId).toBeNull();
    expect(result.linked).toHaveLength(0);
    expect(result.suggested).toHaveLength(0);
    expect(links).toHaveLength(0);
  });

  it('records the score and components on the audit detail', async () => {
    const { deps, links } = fakeDeps([candidate()]);

    await resolveDuplicates(deps, input());

    const subjectMember = links[0]?.members[0];
    expect(subjectMember?.detail).toMatchObject({
      matchedReportId: 'r-peer',
      joinedExistingGroup: false,
    });
    expect(subjectMember?.detail.score).toBeGreaterThanOrEqual(0.8);
    expect(subjectMember?.detail).toHaveProperty('components');
  });
});
