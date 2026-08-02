import { randomUUID } from 'node:crypto';
import {
  DUPLICATE_WINDOW_MINUTES,
  DuplicateVerdict,
  rankDuplicates,
  type DuplicateMatch,
  type DuplicateSubject,
} from '@crisismap/shared';
import {
  DUPLICATE_GROUP_MAX_MEMBERS,
  type DuplicateGroupMember,
  type ReportStore,
} from './store';

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
  /**
   * The stream event id driving this classification. Used to derive a stable
   * `eventId` per audit append, so a redelivery re-appends the same event rather
   * than a duplicate one (§5.4.4).
   */
  streamEventId: string;
}

/**
 * A single link writes one audit event per *report* touched, so the stream event
 * id alone would collide between the self-link and the peer-link. Scoping by
 * report keeps each append individually idempotent while still tracing both back
 * to the one classification that caused them.
 */
function linkEventId(streamEventId: string, reportId: string): string {
  return `${streamEventId}#dup#${reportId}`;
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

  // Prefer joining an existing group over minting one, so several reports of the
  // same incident converge on a single group instead of pairing off. The anchor
  // is the strongest match that already belongs to a group; it is what the audit
  // detail names, so the report a coordinator is pointed at is one that is
  // genuinely *in* the group they are looking at.
  const anchor = linked.find((m) => m.duplicateGroupId) ?? null;
  const groupId = anchor?.duplicateGroupId ?? (deps.newGroupId ?? randomUUID)();
  const justification = anchor ?? linked[0]!;

  const versions = new Map(candidates.map((c) => [c.reportId, c.version]));

  // Every ungrouped strong match joins too, not just this report. Linking only
  // the subject would strand the others: a third report of the same incident
  // would stay ungrouped while the first two paired off. Matches already in a
  // *different* group are left where they are — merging two groups is an
  // unbounded rewrite of both memberships, deferred (ADR-0038).
  const joiners = linked.filter((m) => !m.duplicateGroupId && versions.has(m.reportId));

  const members: DuplicateGroupMember[] = [
    {
      reportId,
      expectedVersion: input.version,
      eventId: linkEventId(input.streamEventId, reportId),
      detail: {
        score: justification.score,
        components: justification.components,
        matchedReportId: justification.reportId,
        joinedExistingGroup: anchor !== null,
      },
    },
    ...joiners.map((match) => ({
      reportId: match.reportId,
      expectedVersion: versions.get(match.reportId)!,
      eventId: linkEventId(input.streamEventId, match.reportId),
      detail: { score: match.score, components: match.components, peer: reportId },
    })),
  ];

  // The transaction caps at 50 members. Truncation keeps this report (index 0)
  // and drops the weakest joiners, and is logged — a silently short group would
  // read as "these are all the duplicates" when it isn't.
  if (members.length > DUPLICATE_GROUP_MAX_MEMBERS) {
    deps.log({
      event: 'dedupe.membersCapped',
      reportId,
      eligible: members.length,
      linked: DUPLICATE_GROUP_MAX_MEMBERS,
    });
    members.length = DUPLICATE_GROUP_MAX_MEMBERS;
  }

  const written = await deps.store.linkDuplicateGroup({ duplicateGroupId: groupId, members });

  if (!written) {
    // One transaction, so one failure mode: a member moved under us and nothing
    // was written. No partial grouping to unwind.
    deps.log({
      event: 'dedupe.linkFailed',
      reportId,
      duplicateGroupId: groupId,
      members: members.length,
    });
    return { ...EMPTY, suggested };
  }

  deps.log({
    event: 'dedupe.linked',
    reportId,
    duplicateGroupId: groupId,
    score: justification.score,
    matched: linked.length,
    members: members.length,
    joinedExistingGroup: anchor !== null,
  });
  return { duplicateGroupId: groupId, linked, suggested };
}
