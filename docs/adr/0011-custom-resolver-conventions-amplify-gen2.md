# ADR-0011: Custom AppSync resolver conventions for Amplify Gen 2

- **Status:** Accepted
- **Date:** 2026-07-08
- **Deciders:** Team (CRIS-9 deploy hardening; applies to CRIS-18/CRIS-19/CRIS-10)
- **Refines:** ADR-0007 (submitReport write path), ADR-0009 (real-time publish)

## Context

The first real deployment of the E2 API surface (`npx ampx sandbox`) exposed a gap our
unit tests could not: **the tests assert in-memory record shapes, never an actual DynamoDB
write or a GraphQL round-trip.** The `submitReport` path type-checked and passed all unit
tests, yet every live submission failed. Standing the backend up and smoke-testing
`submitReport` end-to-end (Cognito → AppSync → Lambda → DynamoDB → typed response) surfaced
five issues, four of them recurring traps for _any_ hand-written resolver. This ADR records
the conventions so CRIS-18 (transition engine), CRIS-19 (real-time), and the CRIS-10 workers
don't rediscover them one failed deploy at a time.

Amplify's own generated resolvers handle all of this automatically; the cost of writing our
own guarded resolvers (ADR-0007/0008/0009) is that we must reproduce it by hand.

## Decisions

1. **Strip `null`/`undefined` attributes before writing** (`forDynamoItem` in `core.ts`).
   DynamoDB rejects a `NULL`-typed value on any index key, and the `Report` table indexes
   several attributes that are legitimately unset at submit time (`regionId`, `category`,
   `geohashPrefix`, `priorityScore`, `geohash`, `duplicateGroupId`, `assignedTeamId` — filled
   in later by the geocode/classification pipeline, §5.4). Absence is the correct encoding of
   "not set yet"; a later update adds the attribute. The SDK's `removeUndefinedValues` drops
   `undefined` but **not** `null`, so the resolver must strip explicitly. This does not change
   the API contract — the mutation returns the full in-memory record (nulls included); only
   the persisted item is trimmed.

2. **Set Amplify's implicit non-null timestamps on every written item.** Amplify adds a
   non-nullable `updatedAt: AWSDateTime!` to every model (and a `createdAt` unless the model
   declares one explicitly) and populates it inside its managed resolvers. A custom resolver
   bypasses that machinery, so it must set `updatedAt` (and `createdAt` where implicit) itself
   — otherwise the value is `null` and **GraphQL cannot serialize the returned/read item**
   (`Cannot return null for non-nullable type 'AWSDateTime'`). On create, `updatedAt == createdAt`.

3. **Treat both cancellation _and_ token-mismatch as an idempotent replay.** (Refines
   ADR-0007 decision 2.) The resolver mints a fresh ULID + timestamps per invocation but reuses
   `clientRequestId` as the transaction `ClientRequestToken`. A retry therefore surfaces two
   different ways: `TransactionCanceledException` (the `attribute_not_exists` guard rejected the
   duplicate — the general case, and the only case after DynamoDB's transaction-idempotency
   window elapses) **or** `IdempotentParameterMismatchException` (within that window, the reused
   token clashes with this invocation's freshly generated ids). Both mean "already processed" →
   look up and return the original report, never surface an error.

4. **Resolver functions that also touch tables belong in the data stack**
   (`resourceGroupName: 'data'` in `defineFunction`). A function that is both an AppSync
   resolver (referenced by the schema) and granted table access in `backend.ts` makes the
   `function` and `data` nested stacks depend on each other → CloudFormation
   `CircularDependencyError`. Pinning such functions to the `data` stack breaks the cycle
   (Amplify's prescribed fix).

5. **Custom subscriptions require a `.handler()`, not just an auth rule.** A subscription tied
   to a mutation (`.for(a.ref(...))`) must declare both an authorization rule and a handler — an
   AppSync JS resolver that sets the subscription filter (`util.transform.toSubscriptionFilter`).
   Without it, schema synthesis fails (`InvalidSchemaError`). The three `onReportUpdate*`
   subscriptions are **temporarily disabled** (commented out in `data/resource.ts` with a
   `TODO(CRIS-19)`) so the rest of the backend can deploy; CRIS-19 restores them with handlers.

## Tradeoffs & consequences

- **Gain:** the guarded write path works against real AWS, and every future custom resolver
  has a checklist (mirrored in `docs/conventions.md`) instead of a deploy-fail-fix loop.
- **Give up:** custom resolvers carry boilerplate (null-strip + timestamp management) that
  Amplify's generated resolvers do for free — the accepted price of hand-written resolvers for
  the safety-critical paths.
- **Follow-ups / watch:**
  - **CRIS-18** — `transition-report` writes report updates and appends `ReportEvent`s; it must
    apply the same null-strip and set `updatedAt` on every write/append. When a transition bumps
    `version` it must bump `updatedAt` too.
  - **CRIS-19** — restore the three subscriptions with filter handlers; re-enable the block.
  - **CRIS-10** — the classification workers write reports on the internal path; same rules apply.
  - **Testing gap** — unit tests never caught any of these. Add at least one integration smoke
    test that exercises the write path against a sandbox before a path is considered "done";
    until that is automated, the manual `submitReport` smoke test is the gate.
