import {
  Category,
  PriorityBand,
  priorityBandForScore,
  type PublicReport,
  type ReportStatus,
} from '@crisismap/shared';

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

/* -------------------------------------------------------------------------- */
/* Queue filters — design doc §2.4 ("filter by category, status, region")      */
/* -------------------------------------------------------------------------- */

/**
 * The active facet selection for the priority queue (CRIS-22). Each facet is a
 * set of allowed values; an **empty** facet imposes no constraint (it is not
 * "match nothing"). A report passes iff it satisfies every non-empty facet, so
 * facets combine with AND across dimensions and OR within a dimension — the
 * usual faceted-search semantics coordinators expect.
 *
 * Filtering is a pure, client-side narrowing of the already-loaded feed — it
 * changes nothing about how data is read. Server-side, GSI-backed filtering and
 * pagination are a later optimization (see ADR-0032); the bounded `READ_LIMIT`
 * list is the working set today.
 */
export interface IncidentFilters {
  categories: readonly Category[];
  statuses: readonly ReportStatus[];
  /** Region ids are data-driven (see `regionOptions`), not a fixed enum. */
  regionIds: readonly string[];
}

/** The no-op filter: every facet empty, so nothing is narrowed. */
export const EMPTY_FILTERS: IncidentFilters = {
  categories: [],
  statuses: [],
  regionIds: [],
};

/** True when at least one facet constrains the queue (drives the "clear" affordance). */
export function filtersActive(filters: IncidentFilters): boolean {
  return (
    filters.categories.length > 0 || filters.statuses.length > 0 || filters.regionIds.length > 0
  );
}

/**
 * Whether a single incident satisfies every non-empty facet. An incident with a
 * `null` category/region can never satisfy a non-empty category/region facet —
 * "unclassified" is simply not one of the selected values, so it is excluded
 * while that facet is active (the same way it would be under a server filter).
 */
export function matchesFilters(incident: PublicReport, filters: IncidentFilters): boolean {
  if (
    filters.categories.length > 0 &&
    !(incident.category != null && filters.categories.includes(incident.category))
  ) {
    return false;
  }
  if (filters.statuses.length > 0 && !filters.statuses.includes(incident.status)) {
    return false;
  }
  if (
    filters.regionIds.length > 0 &&
    !(incident.regionId != null && filters.regionIds.includes(incident.regionId))
  ) {
    return false;
  }
  return true;
}

/**
 * Narrow a list to the incidents matching `filters`. Returns a new array (the
 * input is never mutated) and is generic over the incident type so a
 * `CoordinatorIncident` keeps its `version` through the filter. When no facet is
 * active this is a straight copy — callers can filter unconditionally.
 */
export function applyFilters<T extends PublicReport>(
  incidents: readonly T[],
  filters: IncidentFilters,
): T[] {
  if (!filtersActive(filters)) return [...incidents];
  return incidents.filter((incident) => matchesFilters(incident, filters));
}

/**
 * The distinct, non-empty region ids present in the loaded feed, sorted for a
 * stable facet order. Region is data-driven — coordinators can only filter by
 * regions that actually appear in the current working set, so the facet never
 * offers a region with zero incidents.
 */
export function regionOptions(incidents: readonly PublicReport[]): string[] {
  const seen = new Set<string>();
  for (const incident of incidents) {
    if (incident.regionId) seen.add(incident.regionId);
  }
  return [...seen].sort();
}

/**
 * Toggle `value`'s membership in a facet list, returning a new array. Adds it
 * when absent, removes it when present — the primitive behind clicking a facet
 * chip. Order is preserved for existing values; a newly-added value is appended.
 */
export function toggleValue<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}
