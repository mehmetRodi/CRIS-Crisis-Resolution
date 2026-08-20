# ADR-0050: Proximity-alert pipeline (CRIS-34)

- **Status:** Accepted
- **Date:** 2026-08-17
- **Deciders:** Team (CRIS-34)
- **Refines:** ADR-0038 (conservative duplicate detection — the `classify-report` best-effort
  step pattern this reuses), ADR-0031 (classify worker pinned to the data stack)

## Context

The design doc's target architecture names a path the codebase has only ever scaffolded:
"threshold-crossing incidents enqueue alerts" through an SQS queue → Lambda → SNS/email/push
fan-out (§2.7, §5, Fig 10). Before this ticket, only the data model existed —
`AlertSubscription`/`AlertDelivery` (`data/resource.ts`) and the `AlertChannel`/
`AlertDeliveryStatus` enums (`packages/shared/src/domain.ts`) — with no queue, no dispatch
Lambda, no matching logic, and no actual delivery. `backend.ts`'s own comment called this out
explicitly as a deferred seam.

Per team discussion: **SMS (via SNS) and email (via SES) ship as real, working delivery now;
push is explicitly deferred.** Push needs device-token registration infrastructure — an SNS
Platform Application plus a token-collection flow in `apps/mobile` (and/or web) — that doesn't
exist anywhere in this app, a separate body of work. A subscription can still declare `PUSH` in
`channels`; the dispatcher logs and skips it rather than half-building a third send path.

This ticket builds the **pipeline** — matching and delivery — not a subscription-management
UI. `AlertSubscription` already authorizes `allow.ownerDefinedIn('userId')`, so a signed-in
user can create/manage their own subscription today via the generated
`client.models.AlertSubscription` CRUD, the same way `Team`/`Assignment` have no bespoke
management screen either. No ticket across Sprints 1–3 covers one, so it stays out of scope
here.

## Options considered

- **Trigger dispatch from a new DynamoDB-stream consumer on `Report`, independent of
  classification.** Would need its own stream filter/pipe and would re-read the report to get
  the classification fields `classify-report` already holds in memory. Rejected — `classify-report`
  already has the exact "durable write already committed, then a best-effort post-write step
  that must never re-drive the SQS message on failure" pattern this needs
  (`groupDuplicates`/`resolveDuplicates`, ADR-0038), and already computes every field an alert
  candidate needs.
- **Trigger dispatch from `publishReportUpdate`.** That mutation is the real-time fan-out point
  (CRIS-19/28), but it's called from multiple places (`classify-report`, `transition-report`)
  for reasons unrelated to first-time classification (e.g. a later status transition) — using it
  as the alert trigger would risk re-alerting on unrelated updates. Rejected.
- **Have `classify-report` itself match subscriptions and deliver alerts inline.** Fewer moving
  parts, but conflates two concerns with different failure/retry/scaling profiles in one Lambda,
  and a slow SNS/SES call would extend the classification worker's SQS visibility timeout budget
  for no classification-related reason. Rejected in favor of a second, independent queue +
  worker — mirroring why the classification pipeline itself is stream → queue → worker rather
  than doing everything inline.
- **A new best-effort `classify-report` step that enqueues a candidate onto a dedicated alert
  queue, consumed by a new `alert-dispatch` Lambda (chosen).** Same shape as the existing
  dedup step, decoupled scaling/failure domain, and matches the design doc's own diagram
  exactly (SQS alert queue → Alert Lambda → SNS).
- **Denormalize recipient phone/email onto `AlertSubscription`.** Avoids a Cognito call per
  dispatch, but duplicates data that can go stale (a user changes their email in Cognito, the
  subscription doesn't know). Rejected — `alert-dispatch` calls `cognito-idp:AdminGetUser` at
  dispatch time instead, reusing the exact account/region-wildcard-userpool ARN pattern already
  built for `citizenRoleAssignment` (CRIS-24, ADR-0041).
- **Email via an SNS topic subscription.** SNS's `Publish` API has no direct-to-arbitrary-address
  mode for email — only a topic ARN (which requires every recipient to confirm a subscription,
  unworkable for a dynamic per-user list built from `AlertSubscription`) or a platform-endpoint
  ARN (push). Rejected in favor of Amazon SES's `SendEmail`, the direct-to-address equivalent
  SNS doesn't offer.
- **Discover candidate subscriptions by `regionId` only.** The first cut of this design did
  exactly that — until real end-to-end testing showed `Report.regionId` is never actually set
  by either citizen client today (neither `apps/web` nor `apps/mobile` collects one), which
  would have made every region-scoped subscription permanently unreachable, and a
  geofence-only subscription (`centerGeohash`/`radiusMeters`, no region) was _already_
  undiscoverable by construction — region-only lookup can't find it regardless. Rejected in
  favor of two independent, merged candidate-discovery paths (see Decision).
- **Decompose a subscription's radius into the full set of geohash-prefix cells it could touch**
  (mirroring how the map-viewport query covers a bounding box). More correct at cell
  boundaries, but a materially bigger change for a proximity feature with no subscription-
  management UI yet to even exercise the difference. Rejected for now in favor of the same
  single-cell-lookup tradeoff `classify-report`'s own duplicate-candidate query already accepts
  (ADR-0038) — consistent with existing precedent, revisit if it proves too lossy in practice.

## Decision

1. **`classify-report` gains a new best-effort step** (`alert-enqueue.ts`): `shouldAlert(status,
priorityBand)` is a pure gate — only `AI_CLASSIFIED` (never `NEEDS_VERIFICATION`; the system
   doesn't alert the public off a classification it isn't confident enough in to skip human
   review) at `P0`/`P1` (`ALERT_TRIGGER_BANDS`, `packages/shared/src/alerts.ts`) enqueues. The
   enqueued message carries only PII-free fields (`reportId`, `category`, `urgency`,
   `priorityBand`, `regionId`, `lat`, `lng`, `geohashPrefix`) — no report text, no reporter
   data, the same discipline already applied to the classification queue's own payload.
   Idempotency is inherited for free: this step only runs on the path already gated by
   `report.lastProcessedEventId` (§5.4.4), so a redelivered classification message doesn't
   re-enqueue.
2. **A new `alert-dispatch` Lambda** consumes a second, independently-encrypted SQS queue +
   DLQ (same KMS/retry shape as the classification pipeline). It discovers candidate
   subscriptions via **two independent GSI lookups, merged by id**: `subscriptionsByRegion`
   (the candidate's `regionId`) and a new `subscriptionsByGeohashPrefix` (the candidate's
   `geohashPrefix`, matched against a new stored `AlertSubscription.centerGeohashPrefix` —
   DynamoDB can't derive a prefix at query time, so it's stored, the same reason `Report` stores
   both `geohash` and `geohashPrefix`). Neither signal is required on either side: a
   region-scoped subscription with no geofence, a geofence-only subscription with no region, and
   a report with only one of the two resolved, all still find each other. Each merged candidate
   then passes through a pure predicate (`matchesSubscription`,
   `packages/shared/src/alerts.ts`): `active`, `categories` (empty = any), `minUrgency`, and —
   when the subscription sets both `centerGeohash` and `radiusMeters` — an exact great-circle
   distance check (`decodeGeohash`, new in `geohash.ts`; `distanceMeters`, reused from
   `duplicate.ts` rather than duplicated).
   **Conservative by construction**, matching the existing dedup philosophy: any field a filter
   depends on that the candidate doesn't have resolves to "does not match."
3. **Delivery is idempotent per recipient per channel.** Before attempting a send,
   `alert-dispatch` conditionally `Put`s a new `AlertDelivery` keyed by a deterministic id
   (`` `${reportId}#${recipientId}#${channel}` ``, condition `attribute_not_exists(id)` — the
   same idempotency pattern already used for `ReportEvent`/`Assignment` puts), so an
   at-least-once SQS redelivery can't double-dispatch. SMS sends via `SNSClient.Publish({
PhoneNumber })`; email via `SESv2Client.SendEmail`. A per-recipient delivery failure is
   caught, recorded as `AlertDelivery.status = FAILED`, and logged — it never fails the whole
   SQS record, the same "one bad candidate must not block the others" discipline as `classify-
report`'s dedup/publish steps.
4. **Recipient contact info comes from Cognito** (`cognito-idp:AdminGetUser`), not a
   denormalized field — see "Options considered."
5. **`alert-dispatch` is traced (X-Ray) but not added to the observability dashboard's fixed
   `BackendFunctions` map** — that interface is reserved for the original classification
   pipeline (mirrors how `assignTeam`/`createMediaUploadUrl`/`listVolunteerTasks` aren't in it
   either). CloudWatch alarms/dashboard coverage for the new alert queue's DLQ is left to
   CRIS-35 ("system testing, alarms and runbook"), which explicitly owns that scope.

## Tradeoffs & consequences

- **Gain:** the design doc's alert pipeline is real and working for two of its three channels,
  closing a long-standing deferred seam; the same guarded, idempotent, best-effort discipline
  already proven for classification/dedup/publish now covers alerting too.
- **Give up / interim:** push notifications remain undelivered (declarable, silently skipped
  with a log line) until device-token infrastructure exists; a report with neither a `regionId`
  nor a resolved location can never match anything (correctly — there is nothing to be
  "proximate" to); geofence matching only checks the report's location against the _single_
  geohash-prefix cell the subscription's `centerGeohash` falls in, not every cell its
  `radiusMeters` could reach, so a subscription can miss a report near a cell boundary (the
  same accepted tradeoff `classify-report`'s own duplicate-candidate query already makes,
  ADR-0038); `AlertSubscription.centerGeohashPrefix` must currently be computed and supplied by
  whoever creates the subscription (`geohashPrefix(centerGeohash)`, `@crisismap/shared`) —
  there is no subscription-management UI or guarded mutation yet to compute it automatically,
  so a manually-created subscription with a mismatched prefix silently never matches; the SES
  sender identity and its DNS verification are an account-level prerequisite this stack doesn't
  manage — email delivery silently fails (recorded `FAILED`, logged) until that's set up; both
  new physical GSI names (`alertSubscriptionsByRegionId`,
  `alertSubscriptionsByCenterGeohashPrefix`) are best-effort derivations from the Amplify
  transformer's naming rule, unverified against a deployed schema (same caveat already
  documented for `REPORT_GEO_INDEX_NAME`, ADR-0011) — wrong would silently match zero
  subscriptions rather than error, until deploy-time introspection confirms them.
- **Commits us to:** a future ticket adding push must add the token-registration and platform-
  application infrastructure this ADR deliberately left out; a future subscription-management UI
  (or a guarded `createAlertSubscription`-equivalent mutation) must compute
  `centerGeohashPrefix` server-side rather than trusting a client-supplied value; if single-cell
  geofence matching proves too lossy in practice, a future revision needs the same
  viewport-style multi-prefix decomposition `packages/shared` doesn't yet have; CRIS-35 must
  extend the observability dashboard/alarms to cover the new `AlertQueue`/`AlertDlq`.
