import { Category, PriorityBand, priorityBandForScore, type PublicReport } from '@crisismap/shared';

/**
 * Coordinator dashboard read-model (CRIS-12 → CRIS-22 read path).
 *
 * Pure, framework-free helpers for turning a list of redacted incidents
 * (`PublicReport`, see `@crisismap/shared`) into the shapes the dashboard
 * renders: priority-band counts, category breakdown, and a priority-ordered
 * queue. Kept out of the React component so the ranking/aggregation logic is
 * unit-testable without a DOM (see `incidents.test.ts`).
 *
 * The dashboard deliberately consumes the redacted `PublicReport` projection,
 * never the raw `Report`: the queue must never surface reporter identity,
 * contact, or the untrusted free-text body (design doc §5.6). The live read
 * hook maps AppSync results through `toPublicReport` before they reach here.
 */

/**
 * A redacted incident enriched with the operational fields an authenticated
 * coordinator needs to act on it (CRIS-18). `PublicReport` is deliberately the
 * PII-free *public* projection (map + public queries), so it omits the
 * optimistic-lock `version` that `updateReportStatus` requires (§5.3). `version`
 * is not PII — it is a concurrency token — so rather than widen `PublicReport`
 * (and risk it leaking to the public surfaces), the coordinator read attaches it
 * here. Everything that consumes `PublicReport` still accepts a
 * `CoordinatorIncident` unchanged, since it is a strict superset.
 */
export interface CoordinatorIncident extends PublicReport {
  /** Optimistic-lock version, passed back as `expectedVersion` on a transition. */
  version: number;
}

/**
 * The dashboard's incident feed as a state machine. The presentational
 * component renders one branch per state; `idle` is the default (pre-wired
 * shell) so the component renders without a backend session in unit tests.
 *
 *   idle            → not yet wired to a data source (default / shell)
 *   loading         → a read is in flight
 *   unauthenticated → no coordinator session; reads are gated (graceful degrade
 *                     when there is no authenticated session)
 *   error           → the read failed or was rejected (e.g. wrong role)
 *   ready           → incidents loaded (possibly empty)
 */
export type IncidentFeedState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'error'; message: string }
  | { status: 'ready'; incidents: CoordinatorIncident[] };

/**
 * The priority band to display for an incident. Prefer the persisted
 * `priorityBand` (the deterministic score's own band, §5.4.2); fall back to
 * deriving it from `priorityScore` for older records written before the band
 * was stored. Returns `null` for not-yet-scored reports (NEW / PROCESSING) —
 * they are counted separately, not forced into a band.
 */
export function bandOf(incident: PublicReport): PriorityBand | null {
  if (incident.priorityBand) return incident.priorityBand;
  if (incident.priorityScore != null) return priorityBandForScore(incident.priorityScore);
  return null;
}

/** Counts of scored incidents per band. Unscored incidents are excluded. */
export function countByBand(incidents: readonly PublicReport[]): Record<PriorityBand, number> {
  const counts: Record<PriorityBand, number> = {
    [PriorityBand.P0]: 0,
    [PriorityBand.P1]: 0,
    [PriorityBand.P2]: 0,
    [PriorityBand.P3]: 0,
  };
  for (const incident of incidents) {
    const band = bandOf(incident);
    if (band) counts[band] += 1;
  }
  return counts;
}

/** Number of incidents not yet scored (NEW / PROCESSING) — no band assigned. */
export function countUnscored(incidents: readonly PublicReport[]): number {
  return incidents.filter((incident) => bandOf(incident) === null).length;
}

/**
 * Active-incident counts per category, highest first. Categories with no
 * incidents are omitted (the distribution shows only what is live). `null`
 * categories (not yet classified) are grouped under `OTHER` for display.
 */
export function countByCategory(
  incidents: readonly PublicReport[],
): { category: Category; count: number }[] {
  const counts = new Map<Category, number>();
  for (const incident of incidents) {
    const category = (incident.category as Category | null) ?? Category.OTHER;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Incidents ordered for the coordinator queue: highest `priorityScore` first,
 * unscored incidents last, ties broken by most-recently reported. Returns a new
 * array — the input is not mutated. Generic over the incident type so a
 * `CoordinatorIncident` keeps its `version` through the sort (the queue selects a
 * row and hands its `version` to `updateReportStatus`).
 */
export function sortByPriority<T extends PublicReport>(incidents: readonly T[]): T[] {
  return [...incidents].sort((a, b) => {
    const scoreA = a.priorityScore ?? -1;
    const scoreB = b.priorityScore ?? -1;
    if (scoreB !== scoreA) return scoreB - scoreA;
    // Newest first within the same score.
    const timeA = a.createdAt ? Date.parse(a.createdAt) : 0;
    const timeB = b.createdAt ? Date.parse(b.createdAt) : 0;
    return timeB - timeA;
  });
}
