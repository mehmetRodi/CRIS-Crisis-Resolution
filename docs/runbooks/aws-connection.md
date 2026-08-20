# Runbook: Connecting AWS (safely)

How to connect this repo to an AWS account so it can deploy — without long-lived keys, without
committing environment data, and without over-privileged roles. This is the **one-time account
wiring**; the day-to-day deploy + alarm response lives in [`deploy.md`](deploy.md), and
per-developer setup lives in [`team-onboarding.md`](team-onboarding.md).

> **Automated path:** the steps below are implemented as idempotent scripts in
> [`scripts/aws/`](../../scripts/aws/README.md) — run those rather than clicking through the
> console. This document is the reference/rationale behind them. The account, identity, and
> region choices they encode are decided in
> [ADR-0017](../adr/0017-aws-account-identity-and-region-topology.md): **one AWS account**,
> **IAM Identity Center** for the team, region **`eu-central-1`**.

- Account/identity/region: [ADR-0017](../adr/0017-aws-account-identity-and-region-topology.md)
- Deploy pipeline: [ADR-0016](../adr/0016-continuous-deployment-ampx-pipeline-oidc.md)
- Observability: [ADR-0015](../adr/0015-observability-xray-cloudwatch-alarms.md)
- Backend/IaC model: [ADR-0003](../adr/0003-backend-amplify-gen2-with-cdk-escape-hatch.md)

## Safety principles (read first)

1. **No long-lived credentials in CI.** CI authenticates via **GitHub OIDC** and assumes a
   role for a short-lived token. Never add `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` to
   GitHub secrets.
2. **Least privilege, repo/environment-scoped.** The deploy role trusts only this repository's
   exact `main` ref and `production` Environment subjects. Because GitHub replaces the ref subject
   with an environment subject for environment-gated jobs, the `production` Environment must also
   restrict deployment branches to `main`. The role holds only the permissions the backend needs.
3. **Never commit environment data.** `amplify_outputs.json` (Cognito/AppSync/S3 identifiers)
   is git-ignored and generated per environment — see [ADR-0012](../adr/0012-amplify-outputs-in-ci.md).
   Don't un-ignore or paste it anywhere.
4. **No PII off the table.** Reporter identity/contact never enters logs, prompts, or the queue
   (design doc §5.4.1, §5.6). This is a code invariant, but confirm it holds before pointing a
   real environment at real reports.
5. **Isolate stages.** We run a **single account** (ADR-0017) with stages isolated by separate
   **Amplify apps** and per-developer sandbox stacks. Never share a table between stages.
   Graduate to separate AWS accounts as the project matures.
6. **Region must have Bedrock model access.** The classifier needs `BEDROCK_MODEL_ID`
   (`eu.anthropic.claude-haiku-4-5-20251001-v1:0` by default) enabled in `eu-central-1`. Current
   Claude tiers are invoked via a cross-Region **inference profile** (`eu.` prefix), not a bare
   in-Region model id — the Lambda's Bedrock grant is scoped accordingly (ADR-0017).

---

## A. Local developer connection (personal sandbox)

For iterating on the backend before any CD is involved.

1. **Authenticate with SSO / a named profile** — do not use root, do not create static access
   keys:
   ```bash
   aws configure sso            # or: aws configure --profile crisismap-dev
   export AWS_PROFILE=crisismap-dev
   aws sts get-caller-identity  # confirm the right account/identity
   ```
2. **Stand up your own sandbox** (isolated, disposable):
   ```bash
   cd apps/web
   npx ampx sandbox             # deploys a personal stack; generates amplify_outputs.json (git-ignored)
   ```
3. **Tear it down when done** (avoids cost + stray resources):
   ```bash
   npx ampx sandbox delete
   ```

> The sandbox is per-developer and never shared. It is not the CD path.

---

## B. CI/CD connection (OIDC, one-time)

Do these in the AWS account that will host the environment, then in GitHub.

### 1. Bootstrap CDK (once per account/region)

`ampx pipeline-deploy` deploys through CDK, which needs its bootstrap stack:

```bash
cd apps/web
npx ampx configure telemetry disable   # optional
npx cdk bootstrap aws://<ACCOUNT_ID>/<REGION>
```

### 2. Create the Amplify Gen 2 app

Create an Amplify app in the console (or CLI) for this repo and note its **App ID** — CD keys
the CloudFormation stack by App ID + branch.

### 3. Create the GitHub OIDC identity provider (once per account)

In IAM → Identity providers, add (if not already present):

- Provider URL: `https://token.actions.githubusercontent.com`
- Audience: `sts.amazonaws.com`

### 4. Create the deploy role (repo/environment-scoped trust)

Use [`infra/bootstrap/github-oidc-deploy-role.yaml`](../../infra/bootstrap/github-oidc-deploy-role.yaml),
which trusts the two exact subjects the repository uses: the `main` ref and the `production`
Environment. Its trust-policy shape is:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": [
            "repo:mehmetRodi/CRIS-Crisis-Resolution:ref:refs/heads/main",
            "repo:mehmetRodi/CRIS-Crisis-Resolution:environment:production"
          ]
        }
      }
    }
  ]
}
```

The Deploy workflow always declares `environment: production`, so its OIDC token uses the
environment subject rather than the ref subject. In GitHub, configure that Environment's
**deployment branches and tags** rule for `main` only; otherwise an exact environment subject is
repo-scoped but not branch-scoped. Required reviewers are an additional optional gate. Never use a
wildcard repo or environment in the `:sub` condition.

**Permissions policy:** infrastructure provisioning remains behind assumed CDK bootstrap roles
(`cdk-<qualifier>-{deploy,file-publishing,image-publishing,lookup}-role-*`). This is the
least-privilege CDK pattern and is exactly what
[`infra/bootstrap/github-oidc-deploy-role.yaml`](../../infra/bootstrap/github-oidc-deploy-role.yaml)
provisions (plus reading the bootstrap-version SSM parameter and a small set of read-only
actions `ampx` itself calls directly — with the deploy role, not the assumed CDK role — to emit
`amplify_outputs.json` after provisioning: `cloudformation:Describe*` / `GetTemplateSummary` to
read the deployed stack, and `s3:GetObject`/`ListBucket` on `amplify-*` buckets to read the
generated `model-schema.graphql` codegen artifact). ADR-0052 also grants only
`AdminCreateUser`, `AdminSetUserPassword`, `AdminAddUserToGroup`, and `AdminDeleteUser` on
deployment-region Cognito pools for the throwaway post-deploy coordinator. The
_runtime_ Bedrock grant (inference profile + EU foundation-model ARNs) lives on the classifier
Lambda's role, created during deploy (see `apps/web/amplify/backend.ts`), not on the deploy role.

If this stack was created before ADR-0052, rerun `scripts/aws/30-deploy-role.sh` before the first
CRIS-35 deploy. `ampx pipeline-deploy` does not update this bootstrap role.

### 5. Configure GitHub (repo → Settings)

| Kind        | Name                  | Value                                                             |
| ----------- | --------------------- | ----------------------------------------------------------------- |
| Variable    | `AWS_DEPLOY_ENABLED`  | `true` to activate the Deploy workflow                            |
| Variable    | `AWS_REGION`          | `eu-central-1` (must have Bedrock model access)                   |
| Secret      | `AWS_DEPLOY_ROLE_ARN` | ARN of the role from step 4                                       |
| Secret      | `AMPLIFY_APP_ID`      | App ID from step 2                                                |
| Environment | `production`          | Required by `deploy.yml`; restrict to `main` (reviewers optional) |

Until `AWS_DEPLOY_ENABLED == 'true'`, the Deploy workflow is a skipped no-op (green).

### 6. First deploy

Trigger manually to validate wiring before enabling on-push:

- GitHub → Actions → **Deploy** → _Run workflow_ (`workflow_dispatch`).
- Watch the run assume the role and run `ampx pipeline-deploy`.
- Thereafter, merges to `main` deploy automatically.

### 7. Post-deploy: subscribe the ops alarm topic

Alarms publish to the `OpsAlarmTopic` SNS topic, which has **no subscriber** until you add one
(the endpoint is environment-specific, so it's not in code):

```bash
aws sns subscribe \
  --topic-arn <OpsAlarmTopic ARN> \
  --protocol email \
  --notification-endpoint oncall@example.org
```

(or an HTTPS/Slack/PagerDuty subscription). See [`deploy.md`](deploy.md) for per-alarm response.

---

## Verification checklist

- [ ] `aws sts get-caller-identity` shows the intended account (locally).
- [ ] CDK bootstrap stack exists in `<ACCOUNT_ID>/<REGION>`.
- [ ] Deploy role trust lists only the exact `main` ref and `production` Environment subjects.
- [ ] The `production` Environment allows deployments from `main` only.
- [ ] No static AWS keys in GitHub secrets — only `AWS_DEPLOY_ROLE_ARN` + `AMPLIFY_APP_ID`.
- [ ] `AWS_REGION` has Bedrock access for `BEDROCK_MODEL_ID`.
- [ ] `amplify_outputs.json` is still git-ignored and not committed.
- [ ] Manual `workflow_dispatch` deploy succeeds before enabling auto-deploy on `main`.
- [ ] `OpsAlarmTopic` has a subscription and a test alarm reaches it.

## Teardown / rollback

- **Rollback:** re-run an earlier good commit through the pipeline (revert to `main`, or
  `workflow_dispatch` from that ref). No automated rollback yet (CRIS-35).
- **Teardown a sandbox:** `npx ampx sandbox delete`.
- **Decommission an environment:** delete its CloudFormation stack(s) via the Amplify console /
  CloudFormation; confirm DynamoDB tables and the S3 media bucket are handled per your data-
  retention policy first.
