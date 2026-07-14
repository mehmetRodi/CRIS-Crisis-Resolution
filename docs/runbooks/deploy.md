# Runbook: Deploy & alarm response

Operational baseline for the CrisisMap AI backend (CRIS-14/15). Covers activating the CD
pipeline and the first-response for each observability alarm. The full incident/system runbook
is CRIS-35; this is the deploy + alarm-triage subset.

- **Deploy pipeline:** [ADR-0016](../adr/0016-continuous-deployment-ampx-pipeline-oidc.md)
- **Observability:** [ADR-0015](../adr/0015-observability-xray-cloudwatch-alarms.md)

---

## 1. Continuous deployment

The backend deploys via `.github/workflows/deploy.yml` (`ampx pipeline-deploy`) on push to
`main` and on manual dispatch. **It is dormant until an operator opts in** — the job is skipped
(green) unless `AWS_DEPLOY_ENABLED` is `true`.

### One-time AWS setup

1. **Create an Amplify Gen 2 app** in the target account and note its **App ID**.
2. **Create a GitHub OIDC identity provider** in IAM (`token.actions.githubusercontent.com`) if
   the account doesn't already have one.
3. **Create a deploy IAM role** trusting this repo via OIDC. Trust policy condition:
   ```
   "token.actions.githubusercontent.com:sub": "repo:mehmetRodi/CRIS-Crisis-Resolution:ref:refs/heads/main"
   ```
   Attach a policy allowing the CloudFormation/CDK deploy (CDK bootstrap + the services the
   backend provisions: CloudFormation, S3, IAM, Lambda, AppSync, DynamoDB, Cognito, SQS, Pipes,
   SNS, CloudWatch, X-Ray). Scope to least privilege for your account.
4. **CDK bootstrap** the account/region once (`npx ampx pipeline-deploy` relies on the CDK
   bootstrap stack).

### Configure GitHub (repo → Settings)

| Kind        | Name                  | Value                                           |
| ----------- | --------------------- | ----------------------------------------------- |
| Variable    | `AWS_DEPLOY_ENABLED`  | `true` to activate the workflow                 |
| Variable    | `AWS_REGION`          | `eu-central-1` (must have Bedrock model access) |
| Secret      | `AWS_DEPLOY_ROLE_ARN` | ARN of the deploy role from step 3              |
| Secret      | `AMPLIFY_APP_ID`      | App ID from step 1                              |
| Environment | `production`          | (optional) add required reviewers for a gate    |

Also confirm Bedrock model access is enabled for `BEDROCK_MODEL_ID`
(`eu.anthropic.claude-haiku-4-5-20251001-v1:0` by default, via the EU inference profile) in
`AWS_REGION`. See [ADR-0017](../adr/0017-aws-account-identity-and-region-topology.md).

### Deploy

- **Automatic:** merge to `main`.
- **Manual:** Actions → **Deploy** → _Run workflow_.

> First deploy note (ADR-0013): enabling the Report DynamoDB stream changes the table's
> custom-resource update path. If migrating an existing sandbox, deploy on a fresh environment
> first to avoid stream-ARN churn orphaning the EventBridge Pipe source.

### Rollback

No automated rollback yet. Re-run an earlier good commit through the pipeline
(`workflow_dispatch` from that ref, or revert-commit to `main`). Post-deploy smoke tests are a
follow-up (CRIS-29/35).

---

## 2. Observability

- **Traces:** X-Ray is active on AppSync + all four Lambdas. Use the X-Ray service map to
  locate latency across AppSync → Lambda → DynamoDB/Bedrock.
- **Dashboard:** CloudWatch → Dashboards → `CrisisMap-<stackName>`. One screen for the §3.2
  SLAs (submission p95 < 800 ms, classification p95 < 15 s, real-time p95 < 2 s, 99.9%).
- **Alarms → SNS:** all alarms publish to the ops topic `OpsAlarmTopic`. **Subscribe an
  endpoint post-deploy** (it is environment-specific, so it is not in code):
  ```bash
  aws sns subscribe --topic-arn <OpsAlarmTopic ARN> --protocol email --notification-endpoint oncall@example.org
  ```
  (or an HTTPS/Slack/PagerDuty subscription). Until then alarms fire into a topic no one hears.

### Alarm first-response

| Alarm                       | Means                                                                    | First actions                                                                                           |
| --------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `ClassificationDlqNotEmpty` | A report exhausted retries (poison message) — "never-lost" at risk       | Inspect the DLQ message (IDs only, no PII). Fix root cause, then redrive DLQ → classification queue.    |
| `ClassificationBacklogAge`  | Oldest queued report > 30 s for 3 min — classification lagging           | Check Bedrock throttling/quota in-region and `classify-report` logs/duration. Watch worker throttles.   |
| `ClassifyWorkerErrors`      | Worker raised _unhandled_ errors (not Bedrock/parse — those are handled) | Read structured logs (`classify.record.error`). Repeated errors feed the DLQ.                           |
| `ClassifyWorkerThrottles`   | Worker hitting the concurrency ceiling under load                        | Review reserved concurrency vs the 1,000 writes/min target (§3.2); raise account concurrency if needed. |
| `SubmitReportErrors`        | Citizens may be unable to file reports (availability, §3.2)              | Check `submit-report` logs, DynamoDB throttling/conditional-check failures, AppSync health.             |
| `TransitionReportErrors`    | Coordinator status transitions failing                                   | Check `transition-report` logs — often a version conflict (`CONFLICT`) or an invalid transition.        |
| `PublishReportUpdateErrors` | Real-time fan-out degraded (§3.2 p95 < 2 s)                              | Check `publish-report-update` logs and AppSync subscription health.                                     |

All alarms use `treatMissingData: NOT_BREACHING`, so an idle environment does not page. Both
ALARM and OK transitions notify the topic, so recovery is visible too.
