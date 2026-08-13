# ADR-0046: Authenticated AppSync subscriptions with durable snapshot reconciliation

- **Status:** Accepted
- **Date:** 2026-08-14
- **Deciders:** Team (CRIS-28)
- **Refines:** ADR-0009 (real-time read path), ADR-0023 (coordinator read path), ADR-0040/0042
  (volunteer task projection)

## Context

The CRIS-19 worker already writes classification results durably and then invokes the redacted
`publishReportUpdate` mutation, but no AppSync subscription consumes that mutation. Coordinator and
volunteer surfaces therefore depend on manual refresh. Human status transitions also write directly
to DynamoDB and append an audit event without invoking the publisher, so enabling only the existing
worker fan-out would still leave other open dashboards stale after an operator action.

Two access and consistency constraints shape CRIS-28:

- The `/map` route is public, but it still renders only a base map. There is no public initial-report
  query or incident-marker overlay. Amplify Gen 2 also rejects Identity Pool authorization
  (`allow.guest()` / `allow.authenticated('identityPool')`) on the custom AppSync JS handlers required
  by these subscriptions. Anonymous access would therefore require adding API-key authorization and
  its expiry/rotation lifecycle for a stream the current map cannot use.
- `PublicReport` intentionally omits the coordinator's optimistic-lock `version` and internal triage
  detail. Applying a subscription payload directly would make status actions stale after a worker
  update. WebSocket reconnection can also leave a delivery gap; subscriptions are a notification
  path, not the durable source of truth.

## Options considered

- **Open the unfiltered stream through a public API key now.** This prepares anonymous access, but
  introduces a new public authorization mode and operating lifecycle without a useful public read
  surface. Rejected until the baseline public query and incident overlay are implemented together.
- **Enable only classification notifications.** Smallest backend change, but human transitions would
  converge only in the browser that initiated them. Rejected because it does not create a real-time
  operational view.
- **Use authenticated custom subscriptions and publish from every durable report writer, with
  snapshot reconciliation** (chosen). This completes the current operational surfaces without
  widening anonymous access and treats DynamoDB-backed reads as recovery authority.

## Decision

1. The schema exposes three Cognito User Pool-authenticated subscriptions over the PII-free
   `PublicReport` returned by `publishReportUpdate`: unfiltered `onReportUpdate`,
   `onReportUpdateByRegion(regionId)`, and `onReportUpdateByStatus(status)`. Custom AppSync JS
   handlers are mandatory; the filtered variants install enhanced equality filters through
   `extensions.setSubscriptionFilter(util.transform.toSubscriptionFilter(...))`.
2. Anonymous subscription access remains deferred. When the public map gains an initial public
   query and incident overlay, its authorization mode (including API-key expiry/rotation if that
   remains the supported Amplify path) must be decided and delivered with that complete read path.
3. Both direct report writers publish only after their durable write: the classification worker and
   `transition-report`. Each has schema-level IAM `mutate` access and calls the shared IAM publisher.
   Transition publication is best-effort and bounded to eight seconds; failure never rolls back the
   committed report/audit event and is emitted as a structured `transition.publish.failed` log.
4. Operational clients load a bounded durable snapshot first and subscribe only after Cognito
   authentication succeeds. The coordinator treats an event as an invalidation signal and fetches
   only the affected `Report`, then redacts it before updating the UI. This refreshes `version` and
   internal triage detail without widening `PublicReport`. The selected audit timeline refreshes for
   the affected report.
5. The volunteer board applies the already-redacted report fields locally while preserving the
   assignment/team labels from its server-enforced snapshot. Rejected tasks are removed and workflow
   lanes are recomputed through shared domain logic. Assignment mutations remain deferred and are not
   represented by this report-only channel.
6. Amplify's connection-state events drive an explicit UI indicator. After a disrupted WebSocket
   reconnects, each surface reloads its durable snapshot once so missed notifications cannot leave
   it stale. Manual refresh remains as operator recovery when subscription registration or
   reconciliation fails.
7. The coordinator's dashboard-wide Recent activity panel is a bounded, session-only list derived
   from `PublicReport` events (report id, resulting status, redacted summary, and update time). It is
   not presented as the durable audit log and resets on reload; the selected incident's
   `ReportEvent` timeline remains authoritative. A durable cross-report activity feed would require
   a separate indexed server projection and is outside CRIS-28.

## Tradeoffs & consequences

- Coordinator and volunteer views converge after AI classification and human status transitions,
  while the channel remains structurally PII-free and the durable write stays independent of
  AppSync availability.
- The transition function receives Amplify's API-wide IAM `mutate` grant because Gen 2 has no
  field-scoped function grant. It is trusted internal code and invokes only `publishReportUpdate`,
  but that broader technical capability remains a blast-radius constraint.
- The global operational views currently consume the unfiltered subscription. Region/status
  endpoints are available and server-filtered for future scoped views; using them will reduce fan-out
  when the UI and identity model can express one authoritative scope.
- A subscription notification causes one staff `Report.get` per coordinator client. This is more
  expensive than blindly merging the payload but is required to keep concurrency tokens correct.
- Publish invocation/error metrics and structured logs cover the server fan-out. End-to-end
  client-delivery latency still needs a deployed integration/system test and telemetry owned by
  CRIS-29/35; source-level tests cannot validate WebSocket authorization or propagation timing.
- Dashboard-wide activity has no historical baseline by design. Operators use the selected
  incident timeline for durable history and the session list only for incoming situational changes.
