# ADR-0029: Wiring the triage worker as the IAM-only publisher

- **Status:** Accepted
- **Date:** 2026-07-22
- **Deciders:** Team (CRIS-19)
- **Refines:** ADR-0009 (public projection + write-then-publish real-time)
- **Anticipates:** CRIS-28 (AppSync subscriptions), CRIS-24 (Cognito roles/authorization)

## Context

ADR-0009 decided the shape of the real-time path: a redacted `PublicReport`, and a
write-then-publish flow where the async worker writes durably to DynamoDB and _then_ calls an
internal `publishReportUpdate` mutation so AppSync subscriptions fire (they fire on mutations,
not on raw table writes). It explicitly **deferred** two things to owning tickets: "the
classification worker becoming the IAM-only caller of `publishReportUpdate`" and the
guest/public-map auth mode.

Until now the mutation carried an `allow.groups(['ADMIN'])` rule, the worker never called it
(a `TODO` after the durable write), and the AI `summary` — the one classification field safe
to show publicly — was computed by the Triage Agent and then discarded (never persisted, not
even in the audit event). This ADR records how CRIS-19 closes those gaps. It is deliberately
scoped to the publish path; the subscriptions that _consume_ `publishReportUpdate` stay off
until CRIS-28.

## Decisions

1. **`publishReportUpdate` is internal-only, granted via schema-level `allow.resource`.**
   The mutation now declares **no** per-operation `allow` rule, so no user, group, or guest
   can invoke it. Its sole caller is the `classify-report` worker, granted at the **schema**
   level:

   ```ts
   const schema = a
     .schema({/* … */})
     .authorization((allow) => [allow.resource(classifyReportFn).to(['mutate'])]);
   ```

   `allow.resource` is only expressible at schema scope — Amplify grants a function access to
   the API surface and scopes it by operation _type_, not per field (the per-operation `allow`
   builder omits `.resource` by construction). The previous ADMIN rule is dropped, closing the
   last client-facing door on the real-time channel.

2. **Call it through the Amplify data client, not hand-rolled SigV4.** The worker configures
   Amplify from `getAmplifyDataClientConfig(process.env)` and calls
   `client.mutations.publishReportUpdate(args, { authMode: 'iam' })`. Rationale: letting a
   backend function call an operation over IAM is _exactly_ what `allow.resource` is for, and
   it is the only supported way to authorize the worker's role on the field. A manual SigV4
   POST would still need `allow.resource` for the field auth and then reinvent the
   endpoint/credential/model-introspection wiring the data client already derives from the env
   vars Amplify injects with that grant — so it buys nothing.

3. **Read `process.env` directly, not the `$amplify/env/<fn>` generated module.** The env
   shape is cast from `process.env`, so a plain `tsc`/CI typecheck needs no Amplify codegen —
   matching how `submit-report`/`transition-report` already read `process.env`. The client
   config (including the one-time S3 model-introspection fetch) is memoized per warm container.

4. **Publishing is best-effort; it never rolls back the durable write.** The publish call is
   an injected `Publisher` dependency, invoked _after_ `persistClassification`. A failure is
   logged and swallowed — it must not propagate, because throwing would re-drive the SQS
   message and reprocess an already-classified report. This preserves ADR-0009's invariant
   that the durable write is independent of AppSync availability, and keeps `processRecord`
   unit-testable with a fake publisher (no Amplify in the test import graph — the real
   publisher is `await import()`-ed only in `buildDeps`). Both terminal paths fan out: the
   enriched classified projection, and a minimal `NEEDS_VERIFICATION` update when triage fails
   (a report awaiting human review is exactly what coordinators must see promptly).

5. **Persist the AI `summary` on `Report`.** Added `summary: a.string()` to the model, written
   in `persistClassification` and recorded in the `CLASSIFIED` audit detail. This makes the
   projection carry a real summary on **both** the query path (the coordinator dashboard now
   maps it through `toPublicReport`) and the real-time publish path — not only in the transient
   worker invocation. It also fixes a latent gap where the model's summary was silently thrown
   away.

## Tradeoffs & consequences

- **Gain:** the real-time channel is genuinely internal-only (no client can publish); the
  write→publish loop is wired end-to-end so CRIS-28 only has to switch subscriptions on; the AI
  summary is durably stored and visible; PII still cannot travel the channel (the argument list
  is exactly the public fields, built via the `PUBLIC_REPORT_FIELDS` allow-list).
- **Accept — API-wide `mutate` grant.** `allow.resource(...).to(['mutate'])` is API-wide;
  Amplify has no field-scoped function grant, so the worker's role could _technically_ call
  `submitReport`/`updateReportStatus` over IAM too. Blast radius is bounded: the worker is
  trusted internal code that only ever calls `publishReportUpdate`, and every model mutation
  still enforces its own optimistic-lock/role guards. Revisit if a per-field grant appears.
- **Accept — heavier worker.** The worker now pulls in the Amplify data client and does a
  one-time S3 model-introspection fetch on cold start. Negligible against the Bedrock-dominated
  p95 < 15 s classification budget, and amortized across warm invocations.
- **No new `backend.ts` wiring.** `allow.resource` attaches the `appsync:GraphQL` policy and
  injects the endpoint/introspection env vars onto the worker's role automatically. All edges
  are `classify-report → data`, the same direction as the worker's existing table grants, so
  no cross-stack cycle is introduced (the class of failure documented in `backend.ts`).
- **Validation owed on deploy.** This could not be exercised against live AWS in-repo; the
  synth/`allow.resource` graph and the IAM call should be confirmed on a `npx ampx sandbox`
  deploy. Typecheck, lint, and the worker unit tests (including redaction and
  publish-failure-is-swallowed cases) pass.

## Deferred

- The subscriptions that consume `publishReportUpdate` (`onReportUpdate`,
  `onReportUpdateByRegion`, `onReportUpdateByStatus`) and the guest/public-map auth mode remain
  off — CRIS-28. Until then, `publishReportUpdate` simply echoes the projection back to the
  worker with no subscribers attached.
- Redacted public _queries_ (`getPublicReport`/`listPublicReports`) over `toPublicReport`
  remain the thin follow-up noted in ADR-0009.
