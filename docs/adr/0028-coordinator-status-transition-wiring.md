# ADR-0028: Coordinator status-transition wiring (frontend)

- **Status:** Accepted
- **Date:** 2026-07-22
- **Deciders:** Team (CRIS-18)
- **Refines:** ADR-0008 (report transition engine), ADR-0023 (dashboard live read path), ADR-0009 (public projection)
- **Anticipates:** CRIS-22 (queue + filters), CRIS-23 (incident detail), CRIS-32 (guarded coordinator actions), CRIS-24 (Cognito roles), CRIS-28 (subscriptions)

## Context

The `updateReportStatus` mutation and its guarded engine (`transition-report`) landed with
the CRIS-E2 backend work and are documented in ADR-0008: legality via `STATUS_TRANSITIONS`,
per-transition role authority via `TRANSITION_ROLES`, an `expectedVersion` optimistic lock,
and an appended `STATUS_CHANGED` audit event. A stale version returns a `CONFLICT` error
(design doc §5.3).

Nothing in the web or mobile clients called that mutation — the coordinator dashboard read
incidents (ADR-0023) but every response action was a disabled placeholder. This ADR records
wiring the **client side** of the state machine so a coordinator can actually drive a report
from `AI_CLASSIFIED`/`NEEDS_VERIFICATION` through `VERIFIED → IN_PROGRESS → RESOLVED` (or
`REJECTED`), and reopen a resolved report.

This is intentionally a narrow slice. It touches surfaces owned by later tickets — row
selection (CRIS-22), the rich incident detail with score breakdown and timeline (CRIS-23),
and the full guarded-action UX including assignment and merge (CRIS-32). We wire only the
minimum of each needed to invoke the mutation, and mark the rest as deferred in code.

Two constraints shaped the design:

1. **The optimistic lock needs `version`.** The dashboard consumes `PublicReport`
   (ADR-0009), the redacted, PII-free projection used by the public map and queries — and it
   deliberately omits `version`. But `updateReportStatus` requires `expectedVersion`.
2. **The dashboard is presentational** (ADR-0022/0023): the route wrapper owns data and
   effects so the component is testable with fixtures. Transition orchestration must not put
   AWS calls back into the component.

## Options considered

- **Widen `PublicReport` to carry `version`.** Simplest, but pollutes the *public* projection
  with an internal concurrency token and risks it leaking onto the map/public surfaces.
  Rejected — the projection's value is that it is a strict PII-free allow-list.
- **Re-fetch the report inside the mutation wrapper to read a fresh version.** Removes the
  need to thread `version` through the feed, but defeats the optimistic lock: it papers over
  concurrent edits instead of detecting them, and adds a read per action. Rejected.
- **Put `useReportTransition` state inside the dashboard component.** Fewer props, but drags
  effectful mutation state into the presentational layer, breaking the ADR-0023 boundary and
  fixture-based tests. Rejected.
- **Thread `version` via a coordinator-only incident type, orchestrate in the route wrapper
  (chosen).**

## Decision

1. **`CoordinatorIncident = PublicReport + version`.** A coordinator-local type
   (`surfaces/coordinator/incidents.ts`) extends the redacted projection with the optimistic-
   lock `version` only. `version` is a concurrency token, not reporter PII, so it is safe for
   the authenticated coordinator read to carry it; the public projection stays untouched.
   Because it is a strict superset, every existing `PublicReport` consumer (band counts,
   category breakdown, priority sort) accepts it unchanged; `sortByPriority` is made generic so
   the sort preserves `version`.
2. **`transitionReportStatus` client wrapper** (`lib/transition-report.ts`, mirrors
   `submit-report.ts`). Calls `client.mutations.updateReportStatus` on the default Cognito
   user-pool auth mode (the mutation is group-gated, unlike the guest `submitReport`). It maps
   the resolver's stable message prefixes (`CONFLICT:` / `FORBIDDEN:` / `ILLEGAL_TRANSITION:` /
   `NOT_FOUND:`) to a typed `TransitionError` with a machine-readable `code`, so the UI can
   branch — most importantly on `CONFLICT`.
3. **`useReportTransition` hook** owns the `idle → submitting → success/error` lifecycle. On
   success the route wrapper re-reads the feed (`onSuccess: refresh`) so the queue reflects the
   new status and a fresh `version`. The hook lives in the route wrapper, and the dashboard
   receives `onTransition` + `transition` props — keeping it presentational (ADR-0023).
4. **Client offers only coordinator-legal moves.** The detail panel computes available buttons
   from `STATUS_TRANSITIONS` narrowed by `canActorTransition(COORDINATOR, …)`, mirroring the
   server's `TRANSITION_ROLES`. This is a UX affordance only — **the resolver remains the sole
   authority**; a move the client mistakenly offers still returns `FORBIDDEN`.
5. **Minimal selection.** Queue rows become selectable (click / keyboard) purely to feed the
   detail panel; multi-select and the rich detail view remain CRIS-22/23. When no
   `onTransition` is injected (the shell / unit mounts), the panel keeps its disabled
   placeholder actions.

## Tradeoffs & consequences

- **Gain:** submit → classify → **act** is now demonstrable end-to-end; the optimistic lock and
  its `CONFLICT` path are exercised from the UI; the redaction boundary is preserved (the
  public projection never gained `version`); the mutation wrapper and hook are unit-tested in
  isolation and the dashboard stays fixture-testable.
- **Give up / interim:** the client computes legal moves for the **COORDINATOR** role only —
  a RESPONDER using this surface would be offered coordinator-only moves (e.g. Reject) and get
  a server `FORBIDDEN`. Reading the caller's actual Cognito groups to gate the affordance is
  deferred to CRIS-24. After a successful transition we re-list the whole feed rather than
  patching the one row (fine at the interim 250-record cap; revisited with CRIS-28
  subscriptions). No timeline/score-breakdown detail yet (CRIS-23); no assignment/merge
  (CRIS-32).
- **Commits us to:** CRIS-24 gating offered actions by the caller's real role; CRIS-32
  absorbing this control into the full guarded-action panel (assignment, merge, bulk); CRIS-28
  replacing the refresh-on-success with subscription-driven reconciliation.
