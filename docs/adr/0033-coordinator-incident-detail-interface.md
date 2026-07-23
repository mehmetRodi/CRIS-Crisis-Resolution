# ADR-0033: Coordinator incident-detail interface (CRIS-23)

- **Status:** Accepted
- **Date:** 2026-07-23
- **Deciders:** Team (CRIS-23)
- **Refines:** ADR-0023 (coordinator dashboard live read path), ADR-0028 (status-transition wiring),
  ADR-0032 (queue filters)
- **Anticipates:** CRIS-28 (subscriptions / dashboard-wide activity stream), CRIS-32 (guarded
  assignment & merge actions)

## Context

Selecting a queue row (added with the CRIS-18 transition wiring) opened a minimal detail panel:
the AI `summary` plus the status-transition controls. CRIS-23 owns the **incident-detail
interface** — the full, PII-free picture a coordinator needs to act on the selected incident
(design doc Fig 2): the classification snapshot, the AI summary, the extracted entities
(people affected / infrastructure / hazards), the **explainable** priority score breakdown, and
the incident's **audit timeline**.

Two data-shape facts drove the design:

1. **The list read already loads full `Report` rows.** `useLiveReports` pulls up to 250 reports
   and redacts each to `PublicReport` before it reaches the UI (ADR-0023). The extra triage
   fields the detail view needs — `confidence`, `scoreVersion`, `scoreBreakdown`, `entities` — are
   already on those rows; they are simply dropped by the redaction. None is PII.
2. **`PublicReport` is deliberately the lean, public projection.** It is shared with the live map
   and public queries (§5.3, §5.6), so it intentionally omits `entities`/`scoreBreakdown` — those
   must never reach an anonymous surface, and widening `PublicReport` would risk exactly that.
3. **The timeline lives in a different model.** `ReportEvent` (the immutable audit log, §5.1) is a
   separate table, read by the `eventsByReport` index — it is not part of any report row.

## Options considered

- **Widen `PublicReport` to carry the detail fields.** Rejected — it erodes the redaction
  boundary that ADR-0023 and §5.6 rest on; a field added for the coordinator view would silently
  flow to the public map/query projection.
- **Fetch the full `Report` again on selection (per-incident detail read).** Rejected for the
  report fields — the data is already in memory from the list read, so a second round-trip buys
  nothing and adds a loading state. (This _is_ the right shape for the timeline, which is not in
  memory — see the decision.)
- **Carry the coordinator-internal fields on `CoordinatorIncident`; read the timeline separately
  (chosen).** `CoordinatorIncident` is already "`PublicReport` + the operational fields an
  authenticated coordinator needs" (it is where `version` rides for the same reason). The triage
  fields join it there, populated from the existing list read. The timeline gets its own bounded
  read, keyed by the selected report.

## Decision

1. **Coordinator-internal triage fields ride on `CoordinatorIncident`, not `PublicReport`.**
   `confidence`, `scoreVersion`, `scoreBreakdown`, and `entities` are added to
   `CoordinatorIncident` and populated by `useLiveReports` from the row it already read — no extra
   request. `PublicReport` and the redaction allow-list are untouched, so the public/map surfaces
   are unaffected. The two `a.json()` columns (`scoreBreakdown`, `entities`) are untyped at read
   time, so they are parsed defensively through shared validators
   (`parseScoreBreakdown` — added here — and the existing `parseEntities`); both never throw and
   degrade a malformed value to `null`/empty rather than rendering garbage.
2. **The score breakdown is rendered as the "why this priority" panel.** Each additive factor
   (urgency, category, recency, corroboration) is shown as a proportional bar against the points
   it can contribute (the `*_MAX_POINTS` constants), with a non-zero manual adjustment surfaced
   separately (it may be negative). This realises the design guarantee that priority is a
   deterministic, **explainable** score — never opaque model output (§5.4.2).
3. **The per-incident timeline is a separate, bounded read** via `useIncidentTimeline`, which
   queries the `eventsByReport` index and projects each `ReportEvent` to a PII-free `TimelineEvent`
   (raw `actorId` reduced to `isSystem` + role; freeform `detail` narrowed to the known operator
   `note`). It is the _per-incident_ history — distinct from the dashboard-wide "Recent activity"
   stream still owned by CRIS-28. Like the feed, it is a one-shot read that degrades to
   `unauthenticated`/`error` rather than throwing. The query uses an **explicit selection set**
   (only the fields the projection maps) — not merely for economy but for correctness: the CRIS-18
   resolver writes `ReportEvent` rows directly, bypassing Amplify's auto-managed `updatedAt`, which
   is non-nullable in the generated schema; the default selection set therefore makes AppSync
   reject the whole query. Not requesting `updatedAt` avoids that. The proper backend fix
   (populate/relax `updatedAt` on the resolver write) is a CRIS-18 seam and would not repair rows
   already written.
4. **The dashboard stays presentational; selection stays internal.** Rather than lift selection to
   a controlled prop (which would break the component's standalone tests), the dashboard notifies
   the route wrapper via `onSelectIncident` and renders an injected `timeline` prop — mirroring the
   `onTransition` / `transition` injection from ADR-0028. The route wrapper drives
   `useIncidentTimeline(selectedId)` and refreshes both the feed and the timeline after a
   successful transition so a newly-appended audit event appears.

## Tradeoffs & consequences

- **Gain:** the full detail view renders instantly on selection (no spinner for the report fields);
  the redaction boundary is preserved; the explainable score builds directly on the deterministic
  scoring the pipeline already persists; the presentational/route-wrapper contract is unchanged.
- **Give up:** the report-derived detail is only as fresh/complete as the bounded 250-row list read
  (ADR-0032's ceiling applies here too); the timeline is a one-shot read, not live (CRIS-28).
  Selection is duplicated (internal view state + the wrapper's copy for the timeline read) — this
  is acceptable because the component is the sole writer and always notifies, but it is a seam to
  revisit if selection ever needs to be controlled (e.g. deep-linking to an incident).
- **Commits us to:** keeping `parseScoreBreakdown`/`parseEntities` in lockstep with the persisted
  `a.json()` shapes (the classification.test.ts sync guard covers `ScoreBreakdown`), and folding
  the timeline into the subscription-driven read path when CRIS-28 lands.
