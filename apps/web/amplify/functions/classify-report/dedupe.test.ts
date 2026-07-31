import { describe, expect, it, vi } from 'vitest';
import { Category, DUPLICATE_WINDOW_MINUTES } from '@crisismap/shared';
import { resolveDuplicates, type DedupeDeps, type DedupeInput } from './dedupe';
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
    expect(links).toHaveLength(2);
    // Peer first: a new group must not leave this report alone in it.
    expect(links[0]).toMatchObject({
      reportId: 'r-peer',
      expectedVersion: 5,
      duplicateGroupId: 'group-new',
    });
    expect(links[1]).toMatchObject({
      reportId: 'r-subject',
      expectedVersion: 3,
      duplicateGroupId: 'group-new',
    });
  });

  it('joins an existing group rather than minting a second one', async () => {
    const { deps, links } = fakeDeps([candidate({ duplicateGroupId: 'group-7' })]);

    const result = await resolveDuplicates(deps, input());

    expect(result.duplicateGroupId).toBe('group-7');
    // Only the subject is written — the peer is already in the group.
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ reportId: 'r-subject', duplicateGroupId: 'group-7' });
    expect(links[0]?.detail).toMatchObject({ joinedExistingGroup: true });
  });

  it('converges several reports of one incident onto a single group', async () => {
    // Two strong matches, one already grouped — the group must win over minting.
    const { deps, links } = fakeDeps([
      candidate({ reportId: 'r-a', duplicateGroupId: null, version: 2 }),
      candidate({ reportId: 'r-b', duplicateGroupId: 'group-existing', version: 9 }),
    ]);

    const result = await resolveDuplicates(deps, input());

    expect(result.duplicateGroupId).toBe('group-existing');
    expect(links).toHaveLength(1);
    expect(links[0]?.reportId).toBe('r-subject');
  });

  it('abandons grouping when the peer write loses its race', async () => {
    const { deps, links, logs } = fakeDeps([candidate()], [false]);

    const result = await resolveDuplicates(deps, input());

    expect(result.duplicateGroupId).toBeNull();
    // Peer attempted, subject never written — no orphan group.
    expect(links).toHaveLength(1);
    expect(links[0]?.reportId).toBe('r-peer');
    expect(events(logs)).toContain('dedupe.peerLinkFailed');
  });

  it('reports no group when the subject write loses its race', async () => {
    const { deps, logs } = fakeDeps([candidate()], [true, false]);

    const result = await resolveDuplicates(deps, input());

    expect(result.duplicateGroupId).toBeNull();
    expect(events(logs)).toContain('dedupe.selfLinkFailed');
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

    expect(links[1]?.detail).toMatchObject({
      matchedReportId: 'r-peer',
      joinedExistingGroup: false,
    });
    expect(links[1]?.detail.score).toBeGreaterThanOrEqual(0.8);
    expect(links[1]?.detail).toHaveProperty('components');
  });
});
