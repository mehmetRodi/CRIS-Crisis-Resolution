# ADR-0017: AWS account, identity, and region topology

- **Status:** Accepted
- **Date:** 2026-07-14
- **Deciders:** Team (CRIS-14)
- **Refines:** ADR-0003 (Amplify Gen 2 + CDK), ADR-0013 (async classification pipeline), ADR-0016 (CD via ampx pipeline-deploy + OIDC)

## Context

ADR-0016 defined _how_ CI deploys (OIDC + `ampx pipeline-deploy`) but left the
account/identity/region topology open — the "connect it to a real account" step.
We now need concrete answers so a 5-developer team can work without stepping on
each other or on production, and so the AI classifier can actually reach a model.

Forces:

- **A team, not one operator.** Five developers need individual, revocable AWS
  access. The account was being used via the **root user with static keys** — the
  worst case: unscoped, unauditable per-person, and a standing leak risk.
- **Data residency.** Reports carry citizen PII (design doc §5.4.1/§5.6). Model
  and data traffic should stay within the EU.
- **Bedrock reality in 2026.** Current Claude tiers (Opus 4.8 / Sonnet 5 /
  Haiku 4.5) are **not** invocable as bare in-Region model ids — they require a
  cross-Region **inference profile** (`eu.` / `global.` / `us.`). The scaffold's
  IAM grant (`arn:aws:bedrock:<region>::foundation-model/anthropic.claude-*`,
  in-Region only) and its default id (`anthropic.claude-opus-4-8`) would both
  fail at runtime against a real account.
- **Early-stage cost/complexity.** The project is a scaffold; a full multi-account
  AWS Organization is more operational weight than the team can carry now.

## Options considered

- **Identity: root/static keys vs IAM users vs IAM Identity Center (SSO).** Root is
  disqualified. IAM users mean long-lived keys to rotate per person. **Identity
  Center** issues short-lived, per-person, MFA-backed credentials and centralizes
  group/permission-set management. Chosen.
- **Accounts: single account vs multi-account Organization.** Multi-account gives
  the strongest blast-radius isolation but is heavy to set up and run.
  **Single account**, with stages isolated by **separate Amplify apps** + per-dev
  sandbox stacks, is explicitly sanctioned by the connection runbook and is right
  for a scaffold. Chosen, with a documented graduation path to multi-account.
- **Region: `us-east-1` vs `eu-west-1` vs `eu-central-1`.** `us-east-1` has the
  broadest model catalog but leaves the EU. `eu-west-1` and `eu-central-1` both
  carry the EU Claude inference profiles and support application inference
  profiles. **`eu-central-1` (Frankfurt)** chosen: EU data residency, first-class
  Bedrock EU region, closest EU region to the team.
- **Model + Bedrock IAM: bare in-Region id vs EU inference profile.** The
  in-Region form no longer exists for current Claude tiers. We adopt the **EU geo
  inference profile** `eu.anthropic.claude-haiku-4-5-...` and widen the Lambda's
  Bedrock grant to the inference-profile ARN **plus** the foundation-model ARNs
  across EU destination Regions (`arn:aws:bedrock:eu-*::foundation-model/anthropic.claude-*`).
- **Model tier: Opus vs Sonnet vs Haiku.** Triage is short-text → structured-JSON
  extraction — a Haiku-class task. **Haiku 4.5** is the default: cheapest/fastest,
  best fit for the 1,000 writes/min + p95 < 15 s targets (§3.2). A `claude-*`
  family wildcard on the grant keeps Sonnet/Opus a one-line `BEDROCK_MODEL_ID`
  change with no IAM edit.

## Decision

- **One AWS account.** Stages isolated by separate Amplify apps; each developer
  runs an isolated `ampx sandbox` stack.
- **IAM Identity Center** for humans: a `CrisisMapDevelopers` group mapped to a
  `CrisisMapDeveloper` permission set (`PowerUserAccess` + a scoped IAM inline
  policy limited to `amplify-*`/`cdk-*` names, so sandboxes work but production
  IAM is off-limits). Production changes go only through CI on `main`.
- **Region `eu-central-1`**, model **`eu.anthropic.claude-haiku-4-5-20251001-v1:0`**
  via the EU inference profile.
- **Bedrock IAM** widened to cover the inference profile + EU-Region foundation
  models (fixes the latent in-Region-only grant).
- The wiring is codified as idempotent scripts in
  [`scripts/aws/`](../../scripts/aws/README.md) and a CloudFormation template for
  the OIDC provider + deploy role in
  [`infra/bootstrap/`](../../infra/bootstrap/github-oidc-deploy-role.yaml). Human
  onboarding: [`docs/runbooks/team-onboarding.md`](../runbooks/team-onboarding.md).

## Tradeoffs & consequences

- **Gain:** no root/static keys; per-person MFA + revocation; EU data residency;
  a classifier that actually works against a real account; reproducible, reviewable
  wiring instead of console clicks.
- **Give up:** single-account isolation is weaker than separate accounts —
  developers share the account with production. Mitigated by the scoped permission
  set (no production IAM) and CI-only production deploys, but a determined
  power-user could still affect shared, non-IAM resources.
- **Commits us to:** the EU inference profile — traffic may route to any EU
  destination Region in the profile (that's the data-residency boundary; the grant
  and any SCPs must allow all of them). Switching geographies later means new
  profile ids + an IAM change.
- **Follow-ups / risks to watch:** graduate to a multi-account Organization
  (dedicated `production` account) as the project matures; the one manual step —
  enabling the Identity Center instance — remains console-only; automated rollback
  is still absent (CRIS-29/35).
