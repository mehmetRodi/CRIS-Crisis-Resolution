import { randomUUID } from 'node:crypto';
import {
  DUPLICATE_WINDOW_MINUTES,
  DuplicateVerdict,
  rankDuplicates,
  type DuplicateMatch,
  type DuplicateSubject,
} from '@crisismap/shared';
import type { ReportStore } from './store';

/**
 * Conservative duplicate grouping for the classify worker (design doc §5.4.3,
 * CRIS-31).
 *
 * Runs **after** the durable classification write and is **best-effort** — the
 * same contract as the `publishReportUpdate` fan-out. Grouping is an advisory
 * pointer that helps a coordinator; losing it must never cost a classification,
 * so every failure path here degrades to "not grouped" rather than throwing.
 *
 * The scoring itself lives in `@crisismap/shared` (`rankDuplicates`); this module
 * owns only the I/O around it: which candidates to fetch, which group to join,
 * and what to record.
 *
 * **Reports are grouped, never merged or deleted** (§5.4.3). `duplicateGroupId`
 * is a pointer; every original submission survives intact as evidence.
 */

export interface DedupeDeps {
  store: Pick<ReportStore, 'findDuplicateCandidates' | 'linkDuplicateGroup'>;
  log: (entry: Record<string, unknown>) => void;
  /** Group-id factory. Injected so tests are deterministic. */
  newGroupId?: () => string;
}

export interface DedupeInput {
  reportId: string;
  /** The report's current version (post-classification write). */
  version: number;
  /** Facts about the report being classified, for scoring. */
  subject: DuplicateSubject;
  /** GSI partition to search. Absent when geocoding did not resolve a location. */
  geohashPrefix?: string | null;
  /** Current time, ISO-8601. Injected so the recency window is testable. */
  now: string;
}

export interface DedupeResult {
  /** The group the report was placed in, or null when it stayed ungrouped. */
  duplicateGroupId: string | null;
  /** Strong matches (Ds ≥ 0.80) that drove the grouping. */
  linked: DuplicateMatch[];
  /** Borderline matches (0.65 ≤ Ds < 0.80) — surfaced, never auto-grouped. */
  suggested: DuplicateMatch[];
}

const EMPTY: DedupeResult = { duplicateGroupId: null, linked: [], suggested: [] };

/**
 * Finds near-duplicates of a just-classified report and groups it with them.
 *
 * Skipped entirely for an unlocated report: without coordinates the location
 * term is 0, which caps `Ds` at 0.60 — below the review band — so no candidate
 * could qualify and the query would be pure cost.
 */
export async function resolveDuplicates(
  deps: DedupeDeps,
  input: DedupeInput,
): Promise<DedupeResult> {
  const { reportId, geohashPrefix } = input;
  if (!geohashPrefix) {
    deps.log({ event: 'dedupe.skip.unlocated', reportId });
    return EMPTY;
  }

  const since = new Date(Date.parse(input.now) - DUPLICATE_WINDOW_MINUTES * 60_000).toISOString();

  const candidates = await deps.store.findDuplicateCandidates({
    geohashPrefix,
    excludeReportId: reportId,
    since,
  });

  const ranked = rankDuplicates(input.subject, candidates);
  const linked = ranked.filter((m) => m.verdict === DuplicateVerdict.STRONG);
  const suggested = ranked.filter((m) => m.verdict === DuplicateVerdict.REVIEW);

  if (suggested.length > 0) {
    // Recorded, never acted on: 0.65–0.79 is a coordinator review suggestion
    // (§5.4.3), and auto-grouping at that confidence risks merging two real
    // incidents — the one failure mode dedup must not have.
    deps.log({
      event: 'dedupe.suggest',
      reportId,
      matches: suggested.map((m) => ({ reportId: m.reportId, score: m.score })),
    });
  }

  if (linked.length === 0) {
    deps.log({ event: 'dedupe.none', reportId, candidates: candidates.length });
    return { ...EMPTY, suggested };
  }

  const strongest = linked[0]!;
  // Prefer joining an existing group over minting one: several reports of the
  // same incident must converge on a single group, not pair off.
  const existing = linked.find((m) => m.duplicateGroupId)?.duplicateGroupId ?? null;

  let groupId = existing;
  if (!groupId) {
    groupId = (deps.newGroupId ?? randomUUID)();
    // A new group needs both members written. Link the peer first: if that write
    // loses its race, we abandon the grouping rather than stranding this report
    // alone in a group no one else points at.
    const peer = candidates.find((c) => c.reportId === strongest.reportId);
    const peerLinked =
      peer !== undefined &&
      (await deps.store.linkDuplicateGroup({
        reportId: peer.reportId,
        expectedVersion: peer.version,
        duplicateGroupId: groupId,
        detail: { score: strongest.score, components: strongest.components, peer: reportId },
      }));

    if (!peerLinked) {
      deps.log({ event: 'dedupe.peerLinkFailed', reportId, peerId: strongest.reportId });
      return { ...EMPTY, suggested };
    }
  }

  const selfLinked = await deps.store.linkDuplicateGroup({
    reportId,
    expectedVersion: input.version,
    duplicateGroupId: groupId,
    detail: {
      score: strongest.score,
      components: strongest.components,
      matchedReportId: strongest.reportId,
      joinedExistingGroup: existing !== null,
    },
  });

  if (!selfLinked) {
    deps.log({ event: 'dedupe.selfLinkFailed', reportId, duplicateGroupId: groupId });
    return { ...EMPTY, suggested };
  }

  deps.log({
    event: 'dedupe.linked',
    reportId,
    duplicateGroupId: groupId,
    score: strongest.score,
    matched: linked.length,
  });
  return { duplicateGroupId: groupId, linked, suggested };
}
