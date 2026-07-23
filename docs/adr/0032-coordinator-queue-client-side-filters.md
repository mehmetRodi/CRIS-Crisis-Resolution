# ADR-0032: Coordinator queue interactive filters (client-side, over the loaded feed)

- **Status:** Accepted
- **Date:** 2026-07-23
- **Deciders:** Team (CRIS-22)
- **Refines:** ADR-0023 (coordinator dashboard live read path), ADR-0022 (dashboard shell)
- **Anticipates:** CRIS-28 (subscriptions), server-side GSI-backed filtering/pagination

## Context

ADR-0023 wired the coordinator dashboard's read path: a bounded, one-shot `Report.list`
(`READ_LIMIT = 250`), redacted to `PublicReport`, rendered as a priority-ordered queue. It
explicitly deferred **filters** to CRIS-22. Until now the Filters region rendered read-only
facet chips — category and status labels with no behaviour — so coordinators could not narrow
the queue at all.

CRIS-22 owns the "priority incident queue and filters". The queue itself already ranks and
renders (it landed alongside the CRIS-18 transition wiring); the missing half is
**interactive filtering** by category, status, and region (design doc §2.4, "filter by
category, status, region"; Fig 11).

Two forces shaped the design:

1. **The working set is already in memory.** The read path pulls up to 250 redacted incidents
   into the client in one shot. Narrowing that set is a pure, synchronous operation — no
   round-trip is needed to make the facets useful today.
2. **The component is deliberately presentational** (ADR-0022/0023): the route wrapper owns
   the data source, and the dashboard renders whatever `feed` it is handed. Filtering should
   not change that contract or add a new data dependency.

## Options considered

- **Server-side filtered queries (GSI-backed).** Push category/status/region into the
  AppSync query so only matching rows are read. This is the right end-state for scale and
  pairs with pagination, but it needs new access patterns/GSIs and a query-param plumbing
  layer the one-shot read doesn't have yet. Rejected as premature — the loaded set is small
  and bounded, and CRIS-28 will reshape the read path anyway (subscriptions).
- **Keep facets read-only, defer all filtering to a later ticket.** Rejected — leaves the
  reviewed-against gap (no way to narrow the queue) open with no benefit; the client-side
  version is small and immediately useful.
- **Client-side faceted narrowing over the loaded feed (chosen).** Pure filter functions in
  `incidents.ts`; the presentational component holds the selection as view state and narrows
  the rows it renders. No read-path or route-wrapper change.

## Decision

1. **Pure, framework-free filter model in `incidents.ts`.** An `IncidentFilters` value (three
   facets: `categories`, `statuses`, `regionIds`) with `matchesFilters` / `applyFilters`,
   `filtersActive`, `regionOptions` (data-driven region list), and a `toggleValue` primitive.
   All unit-tested without a DOM, matching the existing read-model helpers.
2. **Faceted-search semantics.** An empty facet imposes no constraint; a report passes iff it
   satisfies every non-empty facet — AND across dimensions, OR within one. A `null`
   category/region never satisfies a non-empty category/region facet (unclassified rows drop
   out while that facet is active), mirroring how a server-side filter would behave.
3. **Selection is view state in the presentational component**, alongside `selectedReportId`.
   Toggling a facet chip (`aria-pressed`, keyboard-operable) narrows only the **queue**; the
   metrics strip and category distribution stay global situational-overview surfaces. The
   queue shows a "showing N of M" summary and a "Clear filters" affordance, and distinguishes
   "no incidents yet" from "no incidents match the current filters".
4. **Region facet is derived from the loaded feed**, not a fixed enum — coordinators can only
   filter by regions that actually appear, so the facet never offers an empty region.

## Tradeoffs & consequences

- **Gain:** immediately useful filtering with no backend change; the narrowing logic is pure
  and testable in isolation; the presentational/route-wrapper contract is untouched; the
  redaction boundary is unaffected (filters run on already-redacted `PublicReport`s).
- **Give up:** filtering only covers what the bounded 250-row read pulled in — a facet cannot
  surface an incident that wasn't read. This is acceptable while the working set is small, but
  it is a correctness ceiling to remember: the "of M" count is "of the loaded feed", not "of
  all incidents".
- **Commits us to:** revisiting this when the read path grows past a single bounded list —
  server-side filtered queries + pagination (and, with CRIS-28, subscription-driven updates)
  supersede the in-memory narrowing. The pure `matchesFilters`/`IncidentFilters` shape is a
  natural seam to translate into query parameters at that point.
