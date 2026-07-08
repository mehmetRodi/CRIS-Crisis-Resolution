# ADR-0012: Handling the generated `amplify_outputs.json` in CI

- **Status:** Accepted
- **Date:** 2026-07-08
- **Deciders:** Team (CRIS-9 deploy hardening; CI baseline from ADR-0005)
- **Refines:** ADR-0003 (Amplify Gen 2), ADR-0005 (CI & observability baseline)

## Context

`apps/web/src/lib/amplify.ts` statically imports the backend config:

```ts
import outputs from '../../amplify_outputs.json';
Amplify.configure(outputs);
```

`amplify_outputs.json` is **generated** by `npx ampx sandbox` (dev) or the pipeline
deploy (real environments) and is **git-ignored** — it carries environment-specific
Cognito / AppSync / S3 identifiers and must not be committed. It therefore exists on a
developer's machine after they run a sandbox, but is **absent on a fresh CI checkout**.

The CI workflow (ADR-0005) intentionally has **no AWS credentials and deploys no
backend** for the scaffold, so the file cannot be generated during CI. Its absence broke
the pipeline in two distinct places:

1. **`typecheck`** — `tsc` fails with `TS2307: Cannot find module '../../amplify_outputs.json'`.
2. **`build`** — even with types satisfied, `vite`/`rollup` fails static import resolution:
   `Could not resolve "../../amplify_outputs.json"`.

The failure was invisible locally because the generated file is present on dev machines.

## Options considered

- **Commit a placeholder `amplify_outputs.json` (un-ignore it).** Simplest for CI, but
  pollutes the repo with (or invites accidental commits of) environment identifiers, and
  every `ampx sandbox` run overwrites it → a permanently dirty working tree. Rejected.
- **Generate it in CI via `ampx generate outputs`.** Requires AWS credentials and a
  deployed backend in CI, which the scaffold deliberately does not have. Out of scope
  until a real deploy job exists (CRIS-14). Rejected for now.
- **Ambient module declaration only.** A wildcard `declare module '*amplify_outputs.json'`
  fixes `tsc`, but a type declaration cannot satisfy the **bundler**, which needs a
  physical file to resolve the static import. Insufficient alone.
- **Ambient declaration + CI-materialized placeholder (chosen).** Covers both failure
  modes without committing environment data or requiring AWS in CI.

## Decision

Two complementary mechanisms, both no-ops when the real generated file is present:

1. **Ambient type declaration** — `apps/web/src/types/amplify-outputs.d.ts` declares
   `module '*amplify_outputs.json'` with a loose default export. When the real (or
   placeholder) file exists, TypeScript resolves it directly and the declaration is
   ignored; when it is absent (fresh clone, pre-sandbox local typecheck), the declaration
   supplies the type so `tsc` passes. The value is typed loosely (`Record<string, unknown>`)
   because its shape is owned by Amplify codegen; `Amplify.configure` accepts it.

2. **CI placeholder step** — before `build`, the workflow writes `{}` to
   `apps/web/amplify_outputs.json` **only if it does not already exist**, giving the
   bundler a file to resolve. `Amplify.configure({})` typechecks and the app is never run
   in CI, so an empty config is harmless.

## Tradeoffs & consequences

- **Gain:** CI is green with no AWS credentials, no committed environment identifiers, and
  no dirty-tree churn from `ampx sandbox`. Local `tsc` works on a fresh clone before a
  sandbox exists.
- **Give up:** The CI `build` bundles an app configured with `{}` — it verifies that the
  code compiles and bundles, **not** that it can reach a live backend. That is by design
  for the scaffold; end-to-end verification belongs to a future deploy job.
- **Watch:** When a real deploy job lands (CRIS-14), prefer generating the outputs with
  `ampx generate outputs` in that job over the placeholder, and supersede this ADR. The
  loose typing on the ambient declaration means config-shape typos in `amplify.ts` are not
  caught by `tsc`; the runtime and integration tests remain the guard there.
