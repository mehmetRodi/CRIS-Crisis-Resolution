# ADR-0009: Public projection + write-then-publish real-time

- **Status:** Accepted
- **Date:** 2026-07-06
- **Deciders:** Team (CRIS-19)
- **Ticket:** CRIS-19 (epic CRIS-E2)

## Context

Coordinators and the public map need near-real-time updates (p95 < 2 s), but two design
constraints shape how (design doc §5.3, §5.6):

- Reporter identity/contact, internal notes, and the raw (untrusted) report text must never
  leak to public consumers.
- AppSync subscriptions fire on AppSync **mutations**, not on raw DynamoDB writes, and the
  durable write must not depend on AppSync availability.

## Decisions

1. **Separate `PublicReport` type + `toPublicReport` allow-list.** The redacted shape is a
   distinct GraphQL type and a matching `@crisismap/shared` interface. `toPublicReport` builds
   the projection from an explicit field allow-list (`PUBLIC_REPORT_FIELDS`), not by deleting
   keys — so a newly-added sensitive field cannot accidentally pass through. A unit test
   asserts identity/contact/text/notes never appear. The map renders the AI `summary`, never
   the raw `text`.

2. **Write-then-publish via an internal `publishReportUpdate` mutation.** A worker writes the
   report durably to DynamoDB and _then_ calls `publishReportUpdate` to fan the redacted update
   out to subscribers. The durable write stays independent of AppSync (a publish failure never
   loses the report — it retries). This is the design's answer to open question #3, chosen over
   client polling for the < 2 s propagation target.

3. **The publish channel is redacted by construction.** `publishReportUpdate`'s arguments are
   exactly the public fields, so PII has no wire representation on the real-time path — the
   type system is the guarantee, not a runtime filter.

4. **Three subscriptions for the three read shapes.** `onReportUpdate` (live map),
   `onReportUpdateByRegion` (region dashboard), `onReportUpdateByStatus` (work-queues), matching
   the GSI access patterns from ADR-0006.

## Tradeoffs & consequences

- **Gain:** PII cannot leak through public reads or the real-time channel; durable writes are
  decoupled from AppSync; the three read surfaces get targeted, filtered streams.
- **Give up:** an extra mutation hop per update (worker → publish → subscribers) versus a
  hypothetical direct stream-to-subscription, which AppSync doesn't offer.
- **Deferred to owning tickets:** the classification worker becoming the IAM-only caller of
  `publishReportUpdate` and the guest/public-map auth mode (CRIS-10 / CRIS-13); today the
  mutation is ADMIN-gated and subscriptions are `authenticated`, kept aligned to avoid a
  subscription/mutation auth-mode mismatch. The redacted public _queries_ (`getPublicReport` /
  `listPublicReports`) are a thin follow-up over `toPublicReport`.
