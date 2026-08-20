# ADR-0053: Durable proximity-alert handoff and retry-safe delivery

- **Status:** Accepted
- **Date:** 2026-08-20
- **Deciders:** Team (CRIS-34 review hardening)
- **Supersedes:** ADR-0050 decisions 1 and 3; refines its identity, validation, and deployment details

## Context

Review of ADR-0050's first implementation found that its two best-effort boundaries could lose
alerts permanently. A queue-send failure happened after classification idempotency had already
been committed, so the classifier could not safely replay the send. At dispatch, every existing
delivery row was treated as terminal, including `FAILED` and abandoned `PENDING` rows. The review
also found four production-only contract gaps: Amplify owner fields contain
`<sub>::<username>` rather than a raw Cognito username, user-authored malformed geohashes could
throw out an entire SQS record, direct DynamoDB writes omitted Amplify's implicit `updatedAt`, and
the documented deploy workflow did not provide an SES-verified sender.

## Decision

1. A second EventBridge Pipe consumes the existing Report stream and selects only durable
   `MODIFY` events that newly cross into `AI_CLASSIFIED` P0/P1. It sends only `reportId` and the
   crossing `priorityBand` to the encrypted alert queue. The dispatch worker re-reads the other
   PII-free matching fields with a DynamoDB projection. Pipe delivery uses the existing bounded
   retry and stream-pipe DLQ policy. The classifier no longer owns an SQS client or a best-effort
   alert callback.
2. An `AlertDelivery` attempt is acquired with one conditional DynamoDB update. New, `FAILED`,
   and expired `PENDING` records can be claimed; `SENT` and actively leased `PENDING` records are
   skipped. The update increments `attempts` and maintains both `createdAt` and `updatedAt`.
   Dispatch finishes the remaining fan-out, then fails the SQS record when any retryable Cognito,
   SNS, SES, or persistence error occurred. Missing contact data is recorded but treated as
   permanent.
3. Cognito lookup extracts the stable `sub` from Amplify's default `<sub>::<username>` owner
   value while preserving plain legacy usernames. Only `UserNotFoundException` becomes a missing
   contact; infrastructure errors propagate into the retry path.
4. Matching requires `active === true`. Partial, negative-radius, or malformed geofences are a
   conservative non-match and can never throw out the candidate's fan-out.
5. `ALERT_FROM_EMAIL` is mandatory at synthesis and is passed explicitly by the deploy workflow.
   The address or domain must already be verified in SES in the deployment Region.
6. `alert-dispatch` errors, `AlertDlq`, and a distinct alert-stream pipe DLQ page through the
   existing operations topic; the incident runbook records each safe recovery path. Alert and
   classification stream records cannot share a DLQ because their canonical queue messages differ.

## Consequences

- A transient handoff or provider failure no longer silently loses an alert, and successful
  recipient/channel deliveries remain idempotent across retries.
- Delivery is at-least-once at the external-provider boundary. If SNS/SES accepts a send and the
  Lambda crashes before recording `SENT`, an expired lease can cause a duplicate; neither direct
  phone-number SNS publish nor SES simple send provides a shared application idempotency key.
- The Report stream now has two independent readers (classification and alerting). Do not add a
  third direct stream consumer without first introducing a fan-out layer or verifying service
  reader limits for the deployed workload.
- A mismatched client-supplied `centerGeohashPrefix` can still make a subscription undiscoverable
  until a guarded subscription mutation computes it server-side, but malformed data can no
  longer poison other recipients.
