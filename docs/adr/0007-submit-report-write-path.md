# ADR-0007: submitReport write path — transactional create + idempotency

- **Status:** Accepted
- **Date:** 2026-07-06
- **Deciders:** Team (CRIS-9)
- **Ticket:** CRIS-9 (epic CRIS-E2)

## Context

`submitReport` is the fast, durable write path (design doc §3, §5.3): a report must be
acknowledged as `NEW` with p95 < 800 ms and never lost, and retried submissions must not
create duplicates (§5.4.4). The design already mandates client-request-id idempotency and
optimistic concurrency; this ADR records _how_ we implement the create.

## Decisions

1. **Single DynamoDB transaction across three tables.** The resolver writes the
   `IdempotencyRecord`, the `Report` (`status = NEW`, `version = 1`), and the opening
   `SUBMITTED` `ReportEvent` in one `TransactWriteItems`, each guarded by
   `attribute_not_exists(...)`. Either all three land or none do — the report and its audit
   trail can never diverge, and a duplicate `clientRequestId` is rejected atomically.

2. **Idempotent replay returns the original report.** When the transaction is cancelled
   because the idempotency guard already exists, the handler looks up the stored `reportId`
   and returns that report — so a client retry observes the same successful result rather than
   an error.

3. **`reportId` is a ULID minted server-side, reused as Amplify's `id`.** ULIDs are
   time-sortable, so the primary key doubles as a rough creation order. The handler generates
   it; the client never supplies the report id.

4. **Identity is resolved server-side.** `reporterId` comes from the Cognito identity on the
   request, never from a mutation argument. Anonymous submissions (guest/IAM) carry no
   identity and the core logic strips any contact data (§2.1, §5.6).

5. **Pure core, thin adapter.** All construction/validation lives in a dependency-free
   `core.ts` with unit tests; `handler.ts` only performs the AWS I/O. This keeps the
   safety-critical logic testable without deploying (docs/conventions.md → Testing).

## Tradeoffs & consequences

- **Gain:** exactly-once report creation under retries, an audit event guaranteed to accompany
  every report, and testable write-path logic.
- **Give up:** a transaction over three tables costs more write capacity than a single put and
  couples their availability for the write; acceptable for the low-frequency submit path and
  well within on-demand limits.
- **Deferred:** computing the geohash at submit time when the client supplies device
  coordinates (today geohash is resolved by the async geocode step, CRIS-10); rate limiting of
  anonymous submissions (WAF/throttling, §5.6, open question #5).
