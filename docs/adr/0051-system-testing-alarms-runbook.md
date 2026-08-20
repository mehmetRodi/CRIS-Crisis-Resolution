# ADR-0051: Post-deploy synthetic smoke gate, alarm-coverage completion, and incident runbook

- **Status:** Accepted
- **Date:** 2026-08-20
- **Deciders:** Team (CRIS-35)
- **Relates to:** ADR-0015 (observability baseline), ADR-0016/0018 (CD pipeline),
  ADR-0035 (media upload — deferred alarms), ADR-0046 (API integration test strategy),
  ADR-0049 (guarded team assignment)

## Context

CRIS-35 owns the seams the earlier tickets explicitly deferred here:

- **System testing.** ADR-0046 shipped handler-adapter tests in CI and an opt-in live suite
  for personal sandboxes, and deferred "the post-deploy smoke gate in `deploy.yml`" to
  CRIS-35. Nothing today verifies that a _deployed_ environment actually works: CI has no
  AWS credentials (ADR-0012), and `docs/architecture.md` §3 notes the latency targets have
  never been measured in a deployed environment. In particular, a Bedrock misconfiguration
  is invisible everywhere: the worker deliberately routes handled AI failures to
  `NEEDS_VERIFICATION` and reports success (ADR-0015), so no alarm fires and every unit
  test passes while triage silently degrades.
- **Alarms.** ADR-0015's seven alarms cover the submit/transition/publish resolvers and the
  classification pipeline, but four wired Lambdas have none — `createMediaUploadUrl`
  (deferral recorded in ADR-0035), `listVolunteerTasks`, `assignTeam`, and the Cognito
  `citizen-role-assignment` trigger — and nothing watches the AppSync API itself, so a
  resolver-independent API failure (throttling, request mapping, auth plumbing) pages no one.
- **Runbook.** `docs/runbooks/deploy.md` states "the full incident/system runbook is
  CRIS-35" and its rollback section says "no automated rollback yet (CRIS-35)".

## Options considered

**Post-deploy verification**

- **Synthetic end-to-end transaction.** Submit one clearly-marked report through the real
  guest API, wait for the async pipeline to classify it, measure submit→classified latency,
  then move it to the terminal `REJECTED` state through the real guarded mutation. Proves
  Streams → Pipe → SQS → Lambda → Bedrock → scoring → write-back in the deployed
  environment; writes one report and one throwaway coordinator user per deploy.
- **Read-only health checks.** No production writes, but cannot prove the async pipeline
  works — the one path nothing else verifies.
- **Full live suite post-deploy.** Reuses ADR-0046's six-test suite; creates four Cognito
  users and several reports in the production pool/tables per deploy, and its
  fixture-heavy setup is calibrated for disposable sandboxes, not shared environments.

**Alarm scope**

- Close the Lambda gap only; close it plus an AppSync 5XX server-error alarm; or extend
  further to DynamoDB throttle alarms and log-retention policies.

**Rollback**

- **Documented manual rollback** — the runbook gives the exact `workflow_dispatch` re-deploy
  of the last good SHA; a human stays in the loop.
- **Automated rollback on smoke failure** — faster, but an unattended re-deploy can compound
  schema/data mismatches and doubles pipeline complexity.

## Decision

1. **Synthetic e2e smoke gate.** `deploy.yml` gains a post-deploy step running a dedicated
   Vitest suite (`tests/smoke/`, `vitest.smoke.config.ts`, opt-in via
   `CRISISMAP_SMOKE_TARGET=deployed`, mirroring ADR-0046's guard convention). It submits one
   marked synthetic report as a guest, polls until classification lands, fails if the result
   is `NEEDS_VERIFICATION` (that outcome means AI triage is degraded — the exact condition
   no alarm can see), reports the measured submit→classified latency against the §3.2
   15 s target, and rejects the report through `updateReportStatus` so it never lingers in
   the coordinator queue. The gate **verifies** the deploy; it does not undo it.
2. **Alarm coverage: the four uncovered Lambdas plus AppSync 5XX.** Error alarms and
   dashboard coverage for `createMediaUploadUrl`, `listVolunteerTasks`, `assignTeam`, and
   `citizen-role-assignment`, plus a `5XXError` alarm on the GraphQL API. DynamoDB throttle
   alarms and log retention are consciously out of scope (on-demand tables, and retention is
   a cost concern, not an incident signal).
3. **Manual, documented rollback.** A new `docs/runbooks/incident-response.md` becomes the
   full incident runbook: per-alarm first response, smoke-gate failure triage, and the exact
   manual rollback procedure. `deploy.md` keeps deploy mechanics and links to it.
4. `observability.ts` gets a CDK synth-assertion test (the `Template.fromStack` pattern
   already used by `security/encryption.test.ts`), so alarm coverage is itself regression-
   tested.

## Tradeoffs & consequences

- Each production deploy writes one synthetic report (marked `[CRIS-35 SMOKE]`, always
  driven to `REJECTED` or deleted) and one throwaway coordinator user (deleted in cleanup).
  We accept this footprint to gain the only end-to-end verification of the async pipeline.
- Failing the gate on `NEEDS_VERIFICATION` means a transient Bedrock outage can mark a
  deploy red even though the code is fine. That is intentional: the deploy is still live
  (the gate is verification, not rollback), and a red run is the only signal we have for
  degraded triage.
- The smoke suite needs the deploy role's credentials (Cognito admin for the throwaway
  coordinator). It runs inside the existing OIDC session in `deploy.yml`; no new secrets.
- A cross-stack metric reference (data-stack alarm → auth-stack trigger) adds a
  data→auth dependency, the direction that already exists.
- Rollback stays a human decision; recovery time depends on someone acting on the runbook.
