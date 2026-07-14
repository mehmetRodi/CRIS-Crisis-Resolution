# ADR-0016: Continuous deployment via `ampx pipeline-deploy` + GitHub OIDC

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** Team (CRIS-14)
- **Refines:** ADR-0003 (Amplify Gen 2 + CDK), ADR-0005 (CI baseline), ADR-0012 (amplify outputs in CI)

## Context

ADR-0005 shipped CI (format → lint → typecheck → build → test) with **no AWS credentials and
no deploy**, correct for a scaffold with nothing to deploy. It and ADR-0012 both name the same
follow-up: "add a deploy job (`ampx pipeline-deploy`) when the backend becomes real (CRIS-14)."

The backend is now real (auth/data/storage + four Lambdas + the async pipeline). CRIS-14 is the
IaC/CD baseline: the infrastructure is already IaC (Amplify Gen 2 + CDK, ADR-0003), so what's
missing is a **reproducible, credential-safe deploy path** — a way to turn the committed backend
definition into a running CloudFormation stack from CI.

Constraint: this repository is not yet wired to an AWS account. Whatever we add must be inert
(green, not failing) on forks, PRs, and un-configured clones until an operator opts in.

## Options considered

- **`ampx pipeline-deploy` vs `ampx sandbox` in CI.** `sandbox` is an interactive, hot-reloading
  personal dev environment — wrong for CI. `pipeline-deploy` is the purpose-built non-interactive
  CI/CD command: it synthesizes and deploys a branch's stack keyed by `--app-id` + `--branch`.
  Chosen.
- **OIDC vs long-lived IAM keys.** Static `AWS_ACCESS_KEY_ID`/`SECRET` in GitHub secrets are a
  standing credential-leak risk. **GitHub OIDC** (`aws-actions/configure-aws-credentials` +
  `permissions: id-token: write`) mints a short-lived token to assume a deploy role — no
  long-lived secret stored. Chosen.
- **How to stay dormant until configured.** A deploy job that references missing secrets fails
  the workflow red on every push, which is noise for a repo without AWS. We gate the job on a
  repo **variable** `AWS_DEPLOY_ENABLED == 'true'` (empty ⇒ job skipped, green). An operator
  flips one variable + adds the secrets to activate — no code change.
- **Backend-only vs backend + frontend hosting.** This job deploys the **backend** only
  (`pipeline-deploy` generates the real `amplify_outputs.json`). Frontend hosting (Amplify
  Hosting / CDN) is a separate concern, deferred.
- **Trigger.** `push` to `main` (continuous) + `workflow_dispatch` (manual re-deploy /
  first-time bootstrap), with `concurrency: cancel-in-progress: false` so an in-flight
  CloudFormation deploy is never interrupted.

## Decision

Add `.github/workflows/deploy.yml`:

- Triggers on `push: [main]` and `workflow_dispatch`; `concurrency` queues rather than cancels.
- `permissions: id-token: write` for OIDC; assumes `secrets.AWS_DEPLOY_ROLE_ARN` in
  `vars.AWS_REGION` via `aws-actions/configure-aws-credentials@v4`.
- Runs `npx ampx pipeline-deploy --branch <ref> --app-id <secrets.AMPLIFY_APP_ID>` in `apps/web`.
- **Gated** on `vars.AWS_DEPLOY_ENABLED == 'true'` → skipped (green) until an operator opts in.

Required GitHub config (an operator sets these — documented in `docs/runbooks/deploy.md`):
`AWS_DEPLOY_ENABLED` + `AWS_REGION` (variables); `AWS_DEPLOY_ROLE_ARN` + `AMPLIFY_APP_ID`
(secrets); a `production` environment; and an IAM role trusting this repo via GitHub's OIDC
provider.

CI (`ci.yml`) is unchanged: it keeps the quality gates with no credentials, and the placeholder
`amplify_outputs.json` from ADR-0012 still covers the credential-less `build`. This ADR **refines,
but does not supersede, ADR-0012** — the deploy job generates _real_ outputs for a live
environment, while the CI `build` job (no credentials) still needs the placeholder. The two paths
are independent.

## Tradeoffs & consequences

- **Gain:** a reproducible, one-variable-to-activate CD path; no long-lived AWS keys; the deploy
  definition is versioned and reviewed like any other code; safe to merge now (inert until wired).
- **Give up / watch:**
  - **Dormant until an operator acts.** Merging this does not deploy anything — activation is a
    manual, deliberate step (by design). Until then the job is a skipped no-op.
  - **`configure-aws-credentials@v4` is a moving major tag** (matching the repo's `@v4`
    convention); pin to a SHA if supply-chain review later requires it.
  - **Deploy-role scope is defined out-of-band.** The role's IAM policy (least privilege for the
    CloudFormation/CDK deploy) is created during account setup, not in this repo; the runbook
    records the trust policy and expected permissions.
  - **No automated rollback / smoke test yet.** A bad deploy is reverted by re-running an earlier
    commit through the pipeline; post-deploy smoke tests and rollback automation are follow-ups
    (CRIS-29/35).
