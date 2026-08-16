# Runbook: Deploy & alarm response

Operational baseline for the CrisisMap AI backend (CRIS-14/15). Covers activating the CD
pipeline and the first-response for each observability alarm. The full incident/system runbook
is CRIS-35; this is the deploy + alarm-triage subset.

- **Deploy pipeline:** [ADR-0016](../adr/0016-continuous-deployment-ampx-pipeline-oidc.md)
- **CI success gate:** [ADR-0018](../adr/0018-gate-deploy-on-ci-via-workflow-run.md)
- **Observability:** [ADR-0015](../adr/0015-observability-xray-cloudwatch-alarms.md)
- **Triage encryption:** [ADR-0043](../adr/0043-customer-managed-key-for-triage-data-plane.md)

---

## 1. Continuous deployment

The backend deploys via `.github/workflows/deploy.yml` (`ampx pipeline-deploy`) after the CI
workflow succeeds for `main`, or on manual dispatch. **It is dormant until an operator opts
in** — the job is skipped (green) unless `AWS_DEPLOY_ENABLED` is `true`.

### One-time AWS setup

1. **Create an Amplify Gen 2 app** in the target account and note its **App ID**.
2. **Create a GitHub OIDC identity provider** in IAM (`token.actions.githubusercontent.com`) if
   the account doesn't already have one.
3. **Create the deploy IAM role** from
   [`infra/bootstrap/github-oidc-deploy-role.yaml`](../../infra/bootstrap/github-oidc-deploy-role.yaml).
   It trusts two exact OIDC subjects:
   ```
   repo:mehmetRodi/CRIS-Crisis-Resolution:ref:refs/heads/main
   repo:mehmetRodi/CRIS-Crisis-Resolution:environment:production
   ```
   The role assumes the CDK bootstrap roles that hold provisioning power; its only direct access is
   the narrow read-only CloudFormation, SSM, and Amplify-codegen S3 access `ampx` needs.
4. **CDK bootstrap** the account/region once (`npx ampx pipeline-deploy` relies on the CDK
   bootstrap stack).

### Configure GitHub (repo → Settings)

| Kind        | Name                  | Value                                                             |
| ----------- | --------------------- | ----------------------------------------------------------------- |
| Variable    | `AWS_DEPLOY_ENABLED`  | `true` to activate the workflow                                   |
| Variable    | `AWS_REGION`          | `eu-central-1` (must have Bedrock model access)                   |
| Secret      | `AWS_DEPLOY_ROLE_ARN` | ARN of the deploy role from step 3                                |
| Secret      | `AMPLIFY_APP_ID`      | App ID from step 1                                                |
| Environment | `production`          | Required by `deploy.yml`; restrict to `main` (reviewers optional) |

The workflow's environment-gated OIDC token contains the `production` Environment subject, not a
branch-ref subject. Configure the Environment's **deployment branches and tags** rule for `main`
only; the IAM trust alone cannot recover the branch name from that subject.

Also confirm Bedrock model access is enabled for `BEDROCK_MODEL_ID`
(`eu.anthropic.claude-haiku-4-5-20251001-v1:0` by default, via the EU inference profile) in
`AWS_REGION`. See [ADR-0017](../adr/0017-aws-account-identity-and-region-topology.md).

### Deploy

- **Automatic:** merge to `main`; deployment begins only after that commit's CI run succeeds.
- **Manual:** Actions → **Deploy** → _Run workflow_.

> First deploy note (ADR-0013): enabling the Report DynamoDB stream changes the table's
> custom-resource update path. If migrating an existing sandbox, deploy on a fresh environment
> first to avoid stream-ARN churn orphaning the EventBridge Pipe source.

### Deploy failure: `AWS::Pipes::Pipe` … `NotStabilized`

```
Resource of type 'AWS::Pipes::Pipe' … did not stabilize. Status Reason is Input parameter
is invalid from the request due to : Error occurred while sending message to SQS queue: …
```

The pipe references `StreamToSqsPipeRole` by ARN, but its permissions live in that role's
**DefaultPolicy** — a sibling resource. EventBridge Pipes validates source/target/DLQ delivery
while stabilizing, so if CloudFormation updates the pipe before the policy lands, validation
gets `AccessDenied` and the whole `data` nested stack rolls back (taking unrelated resources
in the same changeset with it). `backend.ts` pins the ordering with
`reportStreamPipe.node.addDependency(pipeRole)`; keep that dependency whenever you add a grant
to `pipeRole`. Recovery is just re-running the deploy — the stack rolls back cleanly to
`UPDATE_ROLLBACK_COMPLETE`, no manual cleanup needed.

### Rollback

No automated rollback yet. Re-run an earlier good commit through the pipeline
(`workflow_dispatch` from that ref, or revert-commit to `main`). Post-deploy smoke tests are a
follow-up owned by CRIS-35; CRIS-29 provides the reusable personal-sandbox integration suite.

### Retained KMS keys after sandbox deletion

The triage data-plane key uses `RemovalPolicy.RETAIN` (ADR-0043). This protects queued messages if
an update replaces the key before they expire, but `ampx sandbox delete` removes the stack alias and
can leave the underlying customer-managed key billable.

Before deleting a sandbox, record the key ID while its alias still exists:

```bash
aws kms describe-key --key-id alias/<stack-name>-data
```

After deletion or key replacement:

1. Confirm the old key ID is not referenced by any live SQS queue or SNS topic and that any messages
   encrypted under it have expired, been consumed, or been deliberately migrated.
2. In KMS, verify the key description contains `triage queues and operational alarms (CRIS-25)` and
   confirm its stack/environment from its tags and CloudTrail history. Do not identify a key by a
   partial description alone.
3. Schedule deletion with a 30-day recovery window:
   ```bash
   aws kms schedule-key-deletion --key-id <verified-key-id> --pending-window-in-days 30
   ```
4. Monitor the key during the waiting period. If any legitimate use appears, cancel deletion with
   `aws kms cancel-key-deletion --key-id <verified-key-id>` and restore the required alias/grants.

Never schedule deletion for the active shared environment's key. Deleting a KMS key is permanent;
CloudFormation cannot recover ciphertext after the waiting window closes.

---

## 2. Observability

- **Traces:** X-Ray is active on AppSync and five Lambdas: submit, transition, publish,
  classification, and media-upload URL creation. The volunteer-task resolver and Cognito
  role-assignment trigger are known tracing gaps.
- **Dashboard:** CloudWatch → Dashboards → `CrisisMap-<stackName>`. One screen for the §3.2
  service targets (submission p95 < 800 ms, classification p95 < 15 s, real-time p95 < 2 s,
  99.9%). Publish invocation/error metrics cover classification and transition fan-out. CRIS-28
  connects subscribers, but end-to-end browser delivery latency still requires the deployed
  integration/system measurement owned by CRIS-29/35.
- **Alarms → SNS:** all alarms publish to the CMK-encrypted ops topic `OpsAlarmTopic`; its key and
  topic policies authorize same-account CloudWatch alarms and SNS delivery (ADR-0043). **Subscribe an
  endpoint post-deploy** (it is environment-specific, so it is not in code):
  ```bash
  aws sns subscribe --topic-arn <OpsAlarmTopic ARN> --protocol email --notification-endpoint oncall@example.org
  ```
  (or an HTTPS/Slack/PagerDuty subscription). Until then alarms fire into a topic no one hears.

### Alarm first-response

| Alarm                         | Means                                                                             | First actions                                                                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ClassificationDlqNotEmpty`   | A report exhausted retries (poison message) — "never-lost" at risk                | Inspect the DLQ message (IDs only, no PII). Fix root cause, then redrive DLQ → classification queue.                                                        |
| `ReportStreamPipeDlqNotEmpty` | Stream records never reached the queue; the pipe parked them to unblock the shard | Treat these raw stream records as PII-bearing. **Do not redrive them into `ClassificationQueue`**; recover them with the canonical-message procedure below. |
| `ClassificationBacklogAge`    | Oldest queued report > 30 s for 3 min — classification lagging                    | Check Bedrock throttling/quota in-region and `classify-report` logs/duration. Watch worker throttles.                                                       |
| `ClassifyWorkerErrors`        | Worker raised _unhandled_ errors (not Bedrock/parse — those are handled)          | Read structured logs (`classify.record.error`). Repeated errors feed the DLQ.                                                                               |
| `ClassifyWorkerThrottles`     | Worker hitting the concurrency ceiling under load                                 | Review reserved concurrency vs the 1,000 writes/min target (§3.2); raise account concurrency if needed.                                                     |
| `SubmitReportErrors`          | Citizens may be unable to file reports (availability, §3.2)                       | Check `submit-report` logs, DynamoDB throttling/conditional-check failures, AppSync health.                                                                 |
| `TransitionReportErrors`      | Coordinator status transitions failing                                            | Check `transition-report` logs — often a version conflict (`CONFLICT`) or an invalid transition.                                                            |
| `PublishReportUpdateErrors`   | The internal publish resolver is failing; live clients may be stale               | Check `publish-report-update`, `publish.failed`, and `transition.publish.failed` logs, then AppSync real-time connection health.                            |

### CRIS-28 post-deploy smoke test

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

The public `/map` is intentionally not part of this smoke test: anonymous subscription auth, the
baseline public query, and incident markers are deferred together by ADR-0048.

### Recover records from the pipe DLQ

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

All alarms use `treatMissingData: NOT_BREACHING`, so an idle environment does not page. Both
ALARM and OK transitions notify the topic, so recovery is visible too.
