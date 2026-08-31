# ADR-0059: Amplify Hosting from the gated deploy workflow

- **Status:** Accepted
- **Date:** 2026-08-31
- **Deciders:** Team
- **Refines:** ADR-0002 (Vite SPA on Amplify Hosting), ADR-0016 (custom deployment pipeline),
  ADR-0018 (exact-CI-commit deploy gate), ADR-0051 (post-deploy verification and rollback)

## Context

The production Amplify Gen 2 backend is deployed from GitHub Actions with
`ampx pipeline-deploy`. The workflow checks out the exact commit that passed CI, generates that
environment's `amplify_outputs.json`, and verifies the live backend with a smoke transaction. The
Vite SPA imports this generated file at build time, so its static bundle is permanently wired to
the Cognito, AppSync, and S3 resources named by the file.

The Amplify app and `main` branch already own the backend stack, but the app is not connected to a
Git repository and has no frontend Hosting deployment. We need to host the SPA without creating a
second deployment authority or allowing frontend and backend versions to drift.

## Options considered

- **Connect the repository and let Amplify deploy both backend and frontend.** This is the normal
  Gen 2 full-stack build, but it would duplicate the existing GitHub/OIDC backend deployment and
  its smoke gate. Two systems could attempt to manage the same branch stack. Rejected.
- **Use an Amplify frontend-only build with `ampx generate outputs`.** Disabling
  `pipeline-deploy` in Amplify prevents duplicate backend writes, but an automatic source build
  can run before the gated GitHub backend deployment finishes. Triggering it later through a
  webhook restores ordering, but the webhook builds the branch tip and can select a newer commit
  than the exact SHA that passed CI. Rejected for production.
- **Build in the existing workflow and manually deploy the static artifact to Amplify Hosting.**
  After the backend smoke gate, build the same checked-out SHA with the just-generated outputs,
  then use Amplify's manual deployment API to publish `dist/`. Chosen.

## Decision

Extend `.github/workflows/deploy.yml` so one ordered production transaction performs:

1. backend deployment with `ampx pipeline-deploy`;
2. backend smoke verification;
3. Vite production build using that deployment's generated `amplify_outputs.json`;
4. atomic Amplify Hosting artifact deployment to the existing app's `main` branch; and
5. HTTP probes of `/` and the deep SPA route `/report`.

`scripts/aws/deploy-frontend.sh` owns the Hosting mechanics: it verifies that the Amplify app is
still not source-connected, configures `main` as a non-auto-build production branch, reconciles
the extension-aware SPA 200 rewrite, zips the _contents_ of `apps/web/dist`, uploads them through
the short-lived URL returned by `CreateDeployment`, starts the release, and waits for the job.
The upload URL is never logged.

The OIDC deploy role receives only the Amplify permissions required to configure and deploy the
named app's configured production branch. App, branch, and job ARNs are constructed from
CloudFormation parameters; there is no account-wide Amplify write permission. `workflow_dispatch`
is accepted only from `main`. The job deliberately does not declare a GitHub Environment, keeping
its OIDC `sub` claim equal to the exact `refs/heads/main` subject enforced by IAM. This branch
boundary therefore does not depend on Environment protection rules that some private-repository
billing plans do not provide.

Do not connect this Amplify app to a source repository while this decision is active. GitHub
Actions is the single build/deploy authority; Amplify Hosting is the atomic static artifact host.

## Tradeoffs and consequences

- **Gain:** the backend, generated client configuration, and frontend come from one CI-approved
  commit and one ordered workflow. No Git provider token or Amplify build service role is needed.
- **Gain:** a failed frontend upload leaves the previous atomic Hosting release serving while the
  backend failure/rollback process remains explicit.
- **Gain:** deep links work through a version-controlled SPA rewrite, while missing asset paths
  keep their real 404 behaviour.
- **Cost:** the backend smoke gate runs before every frontend release, including frontend-only
  changes. This deliberately prioritizes environment compatibility over a faster independent
  frontend path.
- **Cost:** manual Amplify deployments support this static Vite SPA, not an SSR runtime. Moving
  the web client to SSR would require a new hosting decision.
- **Cost:** the deploy helper currently owns the app's complete custom-rule list. Additional
  redirects or rewrites must be added to the versioned rule set rather than edited only in the
  console.
- **Rollback:** revert through `main` and let the same workflow redeploy both layers. Running an
  older ref directly remains forbidden because backend environments are keyed by branch name.
