# ADR-0018: Gate deploy on CI success via `workflow_run`

- **Status:** Accepted
- **Date:** 2026-07-15
- **Deciders:** Team (CRIS-14 / CRIS-15)
- **Refines:** ADR-0016 (continuous deployment via `ampx pipeline-deploy` + OIDC), ADR-0005 (CI baseline)

## Context

ADR-0016 set the deploy workflow to trigger on `push: [main]` + `workflow_dispatch`. CI
(`ci.yml`, ADR-0005) triggers independently on the same `push: [main]` (and on `pull_request`).
Because both listen to the same push, they run **in parallel** — nothing makes the deploy wait
for, or depend on, the CI result. A push to `main` that fails lint/typecheck/build/test can still
deploy the backend. We want a red build to block the deploy.

Constraint: CI must keep running on **pull requests**, where a deploy must _not_ happen. So the
two cannot simply be merged into one workflow gated end-to-end — CI has a lifecycle (PRs) that
deploy does not share.

## Options considered

- **Merge into one workflow, `deploy` job `needs: build`.** Explicit and readable, but the
  natural single-workflow shape also runs on `pull_request` (to keep CI on PRs), which would drag
  the deploy job into PR runs. Keeping deploy out then requires per-job `if` guards anyway, and
  couples two things with different trigger lifecycles. Rejected.
- **`workflow_run` trigger on CI completion.** `deploy.yml` listens for CI's `workflow_run`
  `completed` event, filtered to `branches: [main]`, and the job proceeds only when
  `github.event.workflow_run.conclusion == 'success'`. CI stays a standalone workflow (still runs
  on PRs, untouched); deploy runs strictly after a green CI on `main`. Chosen.

## Decision

Change `deploy.yml`'s trigger from `push: [main]` to:

```yaml
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]   # matches the CI run's head branch → excludes PR runs
  workflow_dispatch:
```

The deploy job now carries **two** gates (both must hold):

1. `vars.AWS_DEPLOY_ENABLED == 'true'` — the dormant-until-wired gate from ADR-0016, unchanged.
2. `github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success'`
   — deploy only after a green CI run; manual dispatch bypasses this (no upstream run exists).

Two `workflow_run`-specific footguns are handled explicitly:

- **Checkout the validated commit.** A `workflow_run` event executes in the default-branch
  context, so `github.sha` is `main`'s tip and may have advanced past what CI validated. We
  check out `github.event.workflow_run.head_sha` (falling back to `github.sha` for dispatch).
- **Branch key.** `--branch` uses `github.event.workflow_run.head_branch` (falling back to
  `github.ref_name`), keeping the deploy keyed to the branch CI actually built.

CI (`ci.yml`) is **unchanged**: same quality gates, still runs on `pull_request` and `push: [main]`.

## Tradeoffs & consequences

- **Gain:** a red build no longer deploys; CI remains independent and keeps running on PRs; the
  gate is declarative and reviewed like code. No change to the ADR-0016 OIDC / dormancy design.
- **Give up / watch:**
  - **`workflow_run` reads the workflow file from the default branch**, not from the triggering
    commit. Edits to `deploy.yml` only take effect once merged to `main` — they cannot be fully
    exercised from a PR. (Acceptable: deploy is a `main`-only concern.)
  - **Renaming the CI workflow** (its `name: CI`) silently breaks the `workflows: [CI]` link.
    Keep the name in sync if CI is ever renamed.
  - **Extra latency:** deploy waits for the full CI run to finish before starting, rather than
    racing it. This is the intended behavior, not a regression.
  - **Still no automated rollback / smoke test** — unchanged from ADR-0016 (CRIS-29/35 follow-ups).
