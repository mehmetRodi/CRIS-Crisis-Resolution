# ADR-0023: Coordinator dashboard live incident read path

- **Status:** Accepted
- **Date:** 2026-07-15
- **Deciders:** Team (CRIS-12)
- **Refines:** ADR-0022 (coordinator dashboard shell), ADR-0009 (public projection)
- **Anticipates:** CRIS-22 (queue + filters), CRIS-7 (auth), CRIS-28 (subscriptions)

## Context

ADR-0022 shipped the coordinator dashboard as a **shell** — every region a labeled
placeholder. Manual review flagged the obvious gap: the dashboard shows no incidents, so it
can't be used or evaluated as a command view. The backend is now deployed (AppSync +
Cognito + DynamoDB, `eu-central-1`), the `Report` model and its GSIs exist (CRIS-8), and the
`submitReport` write path is live (CRIS-9) — so real reports can be created but nothing reads
them back.

We chose to wire the dashboard's **read path** now, ahead of the full CRIS-22 queue, so the
end-to-end loop (submit → store → see it on the dashboard) is demonstrable. This deliberately
crosses the CRIS-12 shell boundary; recording it here keeps that decision explicit.

Two constraints shaped the design:

1. **Reads are gated behind an authenticated Cognito user** (`allow.authenticated().to(['read'])`
   on `Report`), but there is **no sign-in UI yet** — that's CRIS-7. A dashboard that hard-requires
   a session would just error for every visitor today.
2. **PII must never reach the UI** (design doc §5.6): the raw report `text`, reporter identity,
   and contact are off-limits to the coordinator queue.

## Options considered

- **Wait for CRIS-22 to do everything (queue + filters + pagination + realtime).** Keeps the
  boundary clean but leaves the reviewed-against gap open indefinitely. Rejected — the read
  path is small, high-value, and unblocks manual verification.
- **Assume a signed-in coordinator; error otherwise.** Simplest, but produces a broken screen
  for everyone until CRIS-7. Rejected.
- **Add a local mock/seed data path.** Renders nicely offline but doesn't prove the real
  wiring and adds a fake code path to maintain. Rejected for the primary flow.
- **One-shot authenticated read that degrades gracefully (chosen).** Read live data when a
  session exists; otherwise show a "sign in as a coordinator" prompt instead of erroring.

## Decision

1. **Presentational component + injected feed.** `CoordinatorDashboard` stays presentational
   and takes an optional `feed: IncidentFeedState` prop (`idle | loading | unauthenticated |
error | ready`). It defaults to `idle`, which reproduces the ADR-0022 shell, so unit tests
   and any non-wired mount are unchanged. The route wrapper (`CoordinatorRoute`) owns the data
   source.
2. **`useLiveReports` hook.** Checks for a Cognito session (`getCurrentUser`) first; with no
   session it resolves to `unauthenticated` (graceful degrade, not an error). With a session it
   lists `Report` through the shared AppSync client and maps each record through
   `toPublicReport` (`@crisismap/shared`) **before** it leaves the hook — the UI layer only ever
   holds the redacted, PII-free projection (§5.6, ADR-0009).
3. **Pure read-model helpers.** Band resolution, count-by-band, count-by-category, and the
   priority sort live in `incidents.ts` (framework-free, unit-tested) — not in the component.
4. **One-shot read + manual refresh, not realtime.** This is a `list()` with a Refresh button.
   Live push (AppSync subscriptions) remains CRIS-28; the "Live updates: not connected"
   indicator stays accurate.

## Tradeoffs & consequences

- **Gain:** submit → dashboard is demonstrable today; the redaction boundary is enforced in the
  client read path; ranking logic is testable in isolation; the component is trivially testable
  with a fixture feed.
- **Give up:** no filters, pagination, or realtime yet (CRIS-22 / CRIS-28); the `Report.list`
  scan is bounded to 250 records as an interim cap; the deployed model has no `summary` field
  yet, so the queue shows category/urgency/status rather than an AI summary until CRIS-11/20.
- **Commits us to:** CRIS-7 turning the `unauthenticated` prompt into a real coordinator
  session; CRIS-22 replacing the one-shot list with the GSI-backed, filterable, paginated queue
  and adding row selection into the CRIS-23 detail rail; CRIS-28 swapping refresh for
  subscription-driven updates.
