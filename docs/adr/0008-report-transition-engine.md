# ADR-0008: Report state-machine transition engine

- **Status:** Accepted
- **Date:** 2026-07-06
- **Deciders:** Team (CRIS-18)
- **Ticket:** CRIS-18 (epic CRIS-E2)

## Context

Every report status change must be structurally legal, authorized for the actor's role,
version-checked, and audited (design doc §5.1). The design's API surface names several
transition mutations (`verifyReport`, `updateReportStatus`, `resolveReport`, `assignReport`),
which risks four near-duplicate resolvers each re-implementing the same guards.

## Decisions

1. **One generic engine, not per-verb resolvers.** A single `updateReportStatus` mutation and
   `transition-report` function drive _all_ human lifecycle transitions. `verifyReport` /
   `resolveReport` are thin semantic aliases over the same engine (a specific `toStatus`);
   they are added in their owning UI flows rather than duplicating the guard logic.
   `assignReport` is deliberately _not_ folded in — assignment mutates the `Assignment`
   entity, not the report status, and belongs to the E4 dispatch flow.

2. **Role authority lives in `@crisismap/shared` as `TRANSITION_ROLES`.** The per-transition
   allow-list sits next to `STATUS_TRANSITIONS` as domain vocabulary, is unit-tested to be a
   subset of the structural machine, and is imported by the resolver — so the frontend and
   backend share one authority on who-can-do-what. `ADMIN` is a global override;
   classification transitions (`NEW→PROCESSING`, etc.) are reserved for the `SYSTEM` actor and
   cannot be driven through this human mutation.

3. **Optimistic lock enforced twice.** The pure core rejects a mismatched `expectedVersion`
   for a fast, clear error; the DynamoDB `TransactWriteItems` re-checks `version` in its
   `ConditionExpression` to close the read-modify-write race. Both map to the same
   machine-readable `CONFLICT` the design specifies (§5.3).

4. **Update + audit event are one transaction.** The report update and the immutable
   `STATUS_CHANGED` `ReportEvent` are written atomically, so the audit log can never disagree
   with the report's current version.

## Tradeoffs & consequences

- **Gain:** a single place to reason about transition safety; no guard drift across verbs;
  shared role authority; race-free version bumps with a guaranteed audit trail.
- **Give up:** verb-specific side effects (e.g. writing a `Verification` evidence record on
  confirm, or setting resolution metadata on resolve) are layered on by the specific flows,
  not handled by the generic engine.
- **Deferred to owning tickets:** `verifyReport` writing a `Verification` record (E4 /
  verification flow); `assignReport` and the team task board (E4); the pipeline's internal
  transitions (CRIS-10).
