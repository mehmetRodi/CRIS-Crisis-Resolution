# Runbook: Deploy

Deploy mechanics for the CRIS backend and web frontend (CRIS-14/15): activating the CD pipeline,
credentials, Amplify Hosting, deploy-time failure modes, and KMS retention. Alarm first response,
smoke-gate triage, DLQ recovery, and rollback live in the incident runbook,
[`incident-response.md`](incident-response.md) (CRIS-35, ADR-0051).

- **Deploy pipeline:** [ADR-0016](../adr/0016-continuous-deployment-ampx-pipeline-oidc.md)
- **CI success gate:** [ADR-0018](../adr/0018-gate-deploy-on-ci-via-workflow-run.md)
- **Observability:** [ADR-0015](../adr/0015-observability-xray-cloudwatch-alarms.md)
- **Triage encryption:** [ADR-0043](../adr/0043-customer-managed-key-for-triage-data-plane.md)
- **Smoke gate + incident runbook:** [ADR-0051](../adr/0051-system-testing-alarms-runbook.md)
- **Amplify Hosting:** [ADR-0059](../adr/0059-amplify-hosting-from-gated-deploy-workflow.md)

---

## 1. Continuous deployment

The backend and Vite SPA deploy through `.github/workflows/deploy.yml` after the CI workflow
succeeds for `main`, or on a `main` manual dispatch. **It is dormant until an operator opts in** —
the job is skipped (green) unless `AWS_DEPLOY_ENABLED` is `true`.

The workflow is intentionally ordered: deploy the backend with `ampx pipeline-deploy`, verify it
with the post-deploy smoke transaction, build the exact same checked-out commit with the generated
production `amplify_outputs.json`, then atomically upload `apps/web/dist` to Amplify Hosting. The
Amplify app remains disconnected from a source repository; do not enable Amplify auto-builds or
add a second `pipeline-deploy` path (ADR-0059).

### One-time AWS setup

1. **Create an Amplify Gen 2 app** in the target account and note its **App ID**. Keep it in
   manual-deploy mode: do not connect a Git repository. The same app/`main` branch owns the Gen 2
   backend stack and the static Hosting release.
2. **Create a GitHub OIDC identity provider** in IAM (`token.actions.githubusercontent.com`) if
   the account doesn't already have one.
3. **Create the deploy IAM role** from
   [`infra/bootstrap/github-oidc-deploy-role.yaml`](../../infra/bootstrap/github-oidc-deploy-role.yaml).
   It trusts one exact OIDC subject:
   ```
   repo:mehmetRodi/CRIS-Crisis-Resolution:ref:refs/heads/main
   ```
   The role assumes the CDK bootstrap roles that hold infrastructure-provisioning power. Direct
   access is limited to the reads `ampx` needs, the four Cognito actions used to create and delete
   the throwaway smoke coordinator (ADR-0052), and Hosting configuration/deployment actions scoped
   to the named Amplify app's `main` branch (ADR-0059).
4. **CDK bootstrap** the account/region once (`npx ampx pipeline-deploy` relies on the CDK
   bootstrap stack).

> **Existing-account upgrade:** accounts whose deploy-role stack predates ADR-0059 must rerun
> `scripts/aws/30-deploy-role.sh` before the first frontend release. The role template is bootstrap
> infrastructure and is not updated by `ampx pipeline-deploy` itself. The script discovers the
> Amplify app by `AMPLIFY_APP_NAME`; set `AMPLIFY_APP_ID` explicitly if names are ambiguous.

### Configure GitHub (repo → Settings)

| Kind     | Name                  | Value                                                |
| -------- | --------------------- | ---------------------------------------------------- |
| Variable | `AWS_DEPLOY_ENABLED`  | `true` to activate the workflow                      |
| Variable | `AWS_REGION`          | `eu-central-1` (must have Bedrock model access)      |
| Secret   | `AWS_DEPLOY_ROLE_ARN` | ARN of the deploy role from step 3                   |
| Secret   | `AMPLIFY_APP_ID`      | App ID from step 1                                   |
| Secret   | `ALERT_FROM_EMAIL`    | SES-verified sender address for citizen alert emails |

The deploy job deliberately has no GitHub `environment:` key, so its OIDC subject remains the
exact `main` ref enforced by IAM. Do not add an Environment without revisiting the trust policy:
environment subjects do not encode the branch, and branch restrictions are unavailable on some
private-repository billing plans.

Also confirm Bedrock model access is enabled for `BEDROCK_MODEL_ID`
(`eu.anthropic.claude-haiku-4-5-20251001-v1:0` by default, via the EU inference profile) in
`AWS_REGION`. See [ADR-0017](../adr/0017-aws-account-identity-and-region-topology.md).
Verify the `ALERT_FROM_EMAIL` address or domain in SES in the same region before deploying.

### Deploy

- **Automatic:** merge to `main`; deployment begins only after that commit's CI run succeeds.
- **Manual:** Actions → **Deploy** → _Run workflow_ from `main`. Dispatches from other refs are
  skipped so they cannot create or publish a production branch environment.

The backend phase includes the **post-deploy smoke gate** (CRIS-35, ADR-0051/0052): one synthetic
guest report must travel the whole classification pipeline in the environment that was just
deployed. A red gate means the backend is live but unverified and the previous frontend remains
served — triage with
[`incident-response.md`](incident-response.md#3-smoke-gate-failure-triage).

Only after that gate passes does the workflow build and publish the SPA. The Hosting helper:

1. refuses a source-connected app or any branch other than `main`;
2. configures the branch as `PRODUCTION` with auto-build disabled;
3. installs the extension-aware 200 rewrite required by React Router deep links;
4. uploads a zip containing the _contents_ of `dist/`, waits for the atomic release, and fails on
   any non-success Hosting job; and
5. requests both `https://main.<app-id>.amplifyapp.com/` and `/report`, requiring the SPA shell.

The successful run writes the exact Hosting URL and job ID to the GitHub step summary.

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

### Frontend Hosting failure

- **`AccessDeniedException` on an Amplify action:** rerun `scripts/aws/30-deploy-role.sh` from the
  repository version containing ADR-0059, then rerun the Deploy workflow from `main`.
- **"app is source-connected":** disconnect the repository/disable the competing Amplify build
  path before retrying. Do not work around the guard; it prevents two deployment authorities.
- **`CreateDeployment`/upload/start/job failure:** the backend is already verified, but Amplify's
  previous atomic frontend release remains active. Inspect the Hosting job in the Amplify console
  and rerun the workflow after correcting the cause.
- **Hosting job succeeded but the route probe failed:** the new frontend may be live. Check the
  app's rewrite list, fetch `/` and `/report` directly, and treat a broken public route as a
  rollback candidate.

### Rollback

Rollback is deliberately manual (ADR-0051/0059) and is a **revert to `main`**, never a
`workflow_dispatch` of an older ref — `ampx pipeline-deploy` keys the stack by branch name, so
deploying another ref creates a different backend. The revert workflow republishes both the
backend and matching frontend. The step-by-step procedure, including the deploy freeze switch, is in
[`incident-response.md`](incident-response.md#5-manual-rollback).

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

- **Traces:** X-Ray is active on AppSync and six Lambdas: submit, transition, publish,
  classification, media-upload URL creation, and team assignment. The volunteer-task resolver
  and Cognito role-assignment trigger are known tracing gaps (they are alarmed, not traced).
- **Dashboard:** CloudWatch → Dashboards → `CRIS-<stackName>`. One screen for the §3.2
  service targets (submission p95 < 800 ms, classification p95 < 15 s, real-time p95 < 2 s,
  99.9%), including the support resolvers and AppSync API health. The smoke gate's
  `smoke.measured` log line in each deploy run adds a per-deploy submit→classified sample.
- **Alarms → SNS:** all alarms publish to the CMK-encrypted ops topic `OpsAlarmTopic`; its key and
  topic policies authorize same-account CloudWatch alarms and SNS delivery (ADR-0043). **Subscribe an
  endpoint post-deploy** (it is environment-specific, so it is not in code):
  ```bash
  aws sns subscribe --topic-arn <OpsAlarmTopic ARN> --protocol email --notification-endpoint oncall@example.org
  ```
  (or an HTTPS/Slack/PagerDuty subscription; `scripts/aws/60-subscribe-alarms.sh` automates the
  email form). Until then alarms fire into a topic no one hears.

Everything downstream of a firing alarm — per-alarm first response, smoke-gate triage, pipe-DLQ
recovery, the CRIS-28 manual real-time checklist, and rollback — lives in
[`incident-response.md`](incident-response.md).
