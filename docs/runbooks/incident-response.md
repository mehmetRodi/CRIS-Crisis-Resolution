# Runbook: Incident response & system verification

The full incident/system runbook (CRIS-35, [ADR-0051](../adr/0051-system-testing-alarms-runbook.md),
[ADR-0052](../adr/0052-smoke-and-resolver-alarm-corrections.md)).
Covers every alarm's first response, post-deploy smoke-gate triage, DLQ recovery, manual
real-time verification, and the manual rollback procedure. Deploy mechanics (activation,
credentials, KMS retention) stay in [`deploy.md`](deploy.md).

- **Observability baseline:** [ADR-0015](../adr/0015-observability-xray-cloudwatch-alarms.md)
- **Alarm completion + smoke gate:** [ADR-0051](../adr/0051-system-testing-alarms-runbook.md)
- **Smoke/alarm correctness:** [ADR-0052](../adr/0052-smoke-and-resolver-alarm-corrections.md)
- **Deploy pipeline:** [ADR-0016](../adr/0016-continuous-deployment-ampx-pipeline-oidc.md), [ADR-0018](../adr/0018-gate-deploy-on-ci-via-workflow-run.md)

---

## 1. Where signals arrive

- **Alarms → SNS.** All CloudWatch alarms publish ALARM **and** OK transitions to the
  CMK-encrypted `OpsAlarmTopic`. An endpoint must be subscribed post-deploy
  (`scripts/aws/60-subscribe-alarms.sh` or the command in [`deploy.md`](deploy.md#2-observability));
  until then alarms fire into a topic no one hears. All alarms use
  `treatMissingData: NOT_BREACHING`, so an idle environment never pages.
- **Dashboard.** CloudWatch → Dashboards → `CRIS-<stackName>`: the §3.2 targets
  (submission p95 < 800 ms, classification p95 < 15 s, real-time p95 < 2 s, 99.9%) on one
  screen, including the support resolvers and AppSync API health.
- **Deploy smoke gate.** Every deploy run ends with the synthetic smoke transaction (§3).
  A red **Deploy** run after a green `ampx pipeline-deploy` step means the new code is
  **live but unverified** — start at §3, not at rollback. The frontend publishes only after this
  gate; a later Hosting failure leaves the backend verified and normally leaves the previous
  atomic frontend release active (see the Hosting failure section in [`deploy.md`](deploy.md)).
- **Traces.** X-Ray is active on AppSync and six Lambdas (submit, transition, publish,
  classify, media-upload, assign-team). The volunteer-task resolver and the Cognito
  role-assignment trigger are known tracing gaps (they are alarmed, not traced).

## 2. Alarm first response

Severity guide: **SEV-1** = reports may be lost or cannot be filed (never-lost, §5.4.4);
**SEV-2** = triage/coordination degraded; **SEV-3** = a narrower feature is broken.
Resolver alarms backed by `CrisisMap/Resolvers:UnexpectedErrors` exclude stable validation,
authorization, legality, and optimistic-lock rejections; those remain normal API errors.

| Alarm                         | Sev | Means                                                                             | First actions                                                                                                                                                  |
| ----------------------------- | --- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ClassificationDlqNotEmpty`   | 1   | A report exhausted retries (poison message) — "never-lost" at risk                | Inspect the DLQ message (IDs only, no PII). Fix root cause, then redrive DLQ → classification queue.                                                           |
| `AlertDlqNotEmpty`            | 1   | A proximity alert exhausted Cognito/SNS/SES delivery retries                      | Inspect `AlertDelivery` attempts and `alert-dispatch` logs. Fix the dependency/recipient issue, then redrive DLQ → `AlertQueue`; `SENT` channels are skipped.  |
| `AlertStreamPipeDlqNotEmpty`  | 1   | Classified P0/P1 stream records never reached `AlertQueue`                        | Treat these raw stream records as PII-bearing. **Do not redrive them directly into `AlertQueue`**; recover the `reportId` + `priorityBand` message shape.      |
| `ReportStreamPipeDlqNotEmpty` | 1   | Stream records never reached the queue; the pipe parked them to unblock the shard | Treat these raw stream records as PII-bearing. **Do not redrive them into `ClassificationQueue`**; recover them with the canonical-message procedure in §4.    |
| `SubmitReportErrors`          | 1   | Citizens may be unable to file reports (availability, §3.2)                       | Check `submit-report` logs, DynamoDB throttling/conditional-check failures, AppSync health.                                                                    |
| `AppSyncServerErrors`         | 1   | The API itself returned 5XX — failures no Lambda metric can see                   | X-Ray the failing field; check AppSync service health and auth plumbing. Correlate with resolver alarms: if none fired, the fault is in AppSync, not a Lambda. |
| `ClassificationBacklogAge`    | 2   | Oldest queued report > 30 s for 3 min — classification lagging                    | Check Bedrock throttling/quota in-region and `classify-report` logs/duration. Watch worker throttles.                                                          |
| `ClassifyWorkerErrors`        | 2   | Worker raised _unhandled_ errors (not Bedrock/parse — those are handled)          | Read structured logs (`classify.record.error`). Repeated errors feed the DLQ.                                                                                  |
| `AlertDispatchErrors`         | 2   | Alert delivery raised retryable dependency or persistence errors                  | Read `alert.delivery.failed` / `alert.record.error`; verify Cognito, SNS, SES, DynamoDB, and the SES sender identity.                                          |
| `ClassifyWorkerThrottles`     | 2   | Worker hitting the concurrency ceiling under load                                 | Review reserved concurrency vs the 1,000 writes/min target (§3.2); raise account concurrency if needed.                                                        |
| `TransitionReportErrors`      | 2   | Coordinator status transitions failing unexpectedly                               | Check `resolver.unexpected_error`, `transition-report` logs, DynamoDB, and AppSync; normal `CONFLICT`/illegal transitions are excluded.                        |
| `PublishReportUpdateErrors`   | 2   | The internal publish resolver is failing; live clients may be stale               | Check `publish-report-update`, `publish.failed`, and `transition.publish.failed` logs, then AppSync real-time connection health.                               |
| `AssignTeamErrors`            | 2   | Team assignment is failing unexpectedly                                           | Check `resolver.unexpected_error`, `assign-team` logs, DynamoDB, and AppSync; normal conflicts and domain rejections are excluded.                             |
| `CitizenRoleAssignmentErrors` | 2   | Sign-up confirmation may be failing, or new accounts get no `CITIZEN` role        | Check the post-confirmation trigger logs for `cognito-idp` permission errors; affected users can be reconciled by their next sign-in (ADR-0041).               |
| `MediaUploadUrlErrors`        | 3   | Media URL creation is failing unexpectedly                                        | Check `resolver.unexpected_error`, presign-role `AssumeRole`, and the bucket policy; invalid content types are excluded. Report submission is unaffected.      |
| `VolunteerTasksErrors`        | 3   | The volunteer task board read path is failing                                     | Check `list-volunteer-tasks` logs and DynamoDB read health for Report/Assignment/Team.                                                                         |

OK transitions notify the same topic, so recovery is visible without checking the console.

## 3. Smoke-gate failure triage

The **Post-deploy smoke test** step in `deploy.yml` submits one guest report marked
`[CRIS-35 SMOKE]`, requires the async pipeline to produce structured AI fields, logs a
`smoke.measured` JSON line (`submitAckMs`, `classifiedMs`) for §3.2 latency tracking, then
rejects the report and deletes its throwaway coordinator. The failure message names the
report id. **The deploy is already live when this step runs** — a red gate is a verification
failure, not a rollback.

| Failure                                              | Means                                                                                            | First actions                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `Refusing to run…` / missing Auth/Data configuration | The suite ran without `CRISISMAP_SMOKE_TARGET=deployed` or before `amplify_outputs.json` existed | Workflow wiring problem, not an outage. Check the step ordering in `deploy.yml`.                                       |
| `AccessDenied` on `AdminCreateUser`                  | The deploy role lacks `cognito-idp` admin on the pool                                            | Fix the deploy-role policy (`infra/bootstrap/github-oidc-deploy-role.yaml`); the environment itself may be healthy.    |
| Report `never picked up by the pipeline`             | Stream → Pipe → SQS hop is broken                                                                | Check the pipe's state and `ReportStreamPipeDlqNotEmpty`; see the `NotStabilized` note in [`deploy.md`](deploy.md).    |
| Report `stuck in PROCESSING`                         | Worker consumed the message but never wrote back                                                 | Check `classify-report` logs (`classify.failed`, `classify.record.error`) and the classification DLQ.                  |
| `NEEDS_VERIFICATION without structured AI fields`    | Pipeline ran but **AI triage is degraded** — no alarm covers this handled-failure path           | Check Bedrock model access/quota for `BEDROCK_MODEL_ID` in-region, then `classify.failed` logs for the contract error. |
| Test passed but `classifiedMs` far above 15 000      | Working but slow (often cold start)                                                              | Compare with `ClassificationBacklogAge` and the dashboard before treating a single sample as a regression.             |

If cleanup itself failed, the run leaves at most one report (search the coordinator queue
for `[CRIS-35 SMOKE]`, reject or delete it) and one user (`cris35-smoke-…@example.com` in
the user pool).

The suite can also be pointed at a personal sandbox to rehearse this procedure:
`CRISISMAP_SMOKE_TARGET=deployed npm run test:smoke` from `apps/web` with sandbox
credentials and that sandbox's `amplify_outputs.json`.

## 4. Recover records from the pipe DLQ

The pipe DLQ contains failed DynamoDB stream records, while `ClassificationQueue` accepts only
`{ reportId, version, streamEventId }`. For each parked record:

1. Extract the report ID without copying the raw record into tickets or chat; the record may contain
   report text, contact details, and precise location.
2. Read the current report. If it is no longer `NEW`, the idempotent worker has nothing to do; record
   the outcome and remove the parked message after review.
3. If it is still `NEW`, send a newly constructed message to `ClassificationQueue` with the current
   report version and a unique recovery event ID:
   ```bash
   aws sqs send-message \
     --queue-url <ClassificationQueue URL> \
     --message-body '{"reportId":"<report-id>","version":<current-version>,"streamEventId":"recovery-<unique-id>"}'
   ```
4. Confirm the report leaves `NEW` and the classification/audit write succeeds before deleting the
   original pipe-DLQ message.

## 5. Manual rollback

There is deliberately no automated rollback (ADR-0051): an unattended re-deploy can compound
schema/data mismatches. Rolling back is one revert away, but a human decides.

1. **Identify the last good commit** — the newest **Deploy** run on `main` where the backend
   deploy, smoke gate, and Amplify Hosting route probe were all green. Note its commit SHA.
2. **Revert `main` to it.** `git revert` the offending commit(s) (or revert the merge commit
   with `-m 1`) and merge to `main` through the normal PR flow. Do **not** `workflow_dispatch`
   the Deploy workflow from an older branch or tag: `ampx pipeline-deploy` keys the backend
   stack by _branch name_, so deploying any ref other than `main` creates a different backend
   instead of rolling this one back.
3. **Let CI gate it.** The revert commit runs through CI, deploys automatically, and must pass
   the same backend smoke gate plus the frontend Hosting probe. That green run confirms both
   layers of the rollback.
4. **Check for non-reversible resources.** If the bad deploy replaced stateful resources
   (table stream changes — ADR-0013 — or a KMS key: see the retention procedure in
   [`deploy.md`](deploy.md)), read that deploy run's CloudFormation output before assuming the
   revert restores the previous state.
5. **Freeze if needed.** To stop all deploys while investigating, set the repo variable
   `AWS_DEPLOY_ENABLED` to anything but `true` — the workflow becomes a green no-op
   (ADR-0016). Re-enable after the incident.

## 6. Manual real-time verification (CRIS-28)

The smoke gate does not cover browser subscription delivery. After changes to the real-time
path, verify manually:

1. Sign in to two browser sessions with operational roles and open `/coordinator` in both. Confirm
   each header reaches **Live updates connected**; an unauthenticated browser must not be able to
   register the subscription.
2. Submit a report and wait for classification. Confirm both coordinator queues update without
   pressing Refresh and that neither client receives raw report text, reporter identity/contact,
   media keys, or internal notes in the subscription payload.
3. Change the report status in one coordinator session. Confirm the second session updates its
   queue and selected timeline, proving `transition-report` publishes after its durable write.
4. Open `/volunteer` with an allowed role and confirm the redacted task moves lanes after a report
   status update while its existing assignment/team label remains intact.
5. Interrupt one browser's network connection, perform another update elsewhere, and restore the
   connection. Confirm the indicator reconnects and the durable snapshot reload catches the missed
   state. If any step fails, manual Refresh must still recover the current DynamoDB-backed state.

The public `/map` is intentionally not part of this checklist: anonymous subscription auth, the
baseline public query, and incident markers are deferred together by ADR-0048.

End-to-end subscription delivery latency (real-time p95 < 2 s, §3.2) still has no automated
measurement — the smoke gate measures submit→classified only. Deployed client telemetry
remains an open follow-up.

## Report ownership and progress failures (ADR-0063)

For `ReportWorkErrors`, inspect the `report-work` Lambda/X-Ray trace and
`CrisisMap/Resolvers` unexpected-error metric with Operation `reportWork`. Check
Report/ReportWork/ReportEvent table permissions and the function's user-pool-scoped
AdminGetUser/AdminListGroupsForUser grants. Never log or copy work note text or
user identifiers into an incident log. Expected CONFLICT, FORBIDDEN, ILLEGAL,
VALIDATION, and NOT_FOUND errors do not page. On a conflict, refresh ownership and
review the current owner before retrying; do not automatically resubmit a claim.
If the UI reports the service unavailable after deployment, verify that the schema,
function, new table, and generated Amplify outputs came from the same checkout.
My tasks has a bounded scan and explicitly fails if it cannot complete; investigate
working-set size and migrate to an assignee index rather than showing partial IDs.
