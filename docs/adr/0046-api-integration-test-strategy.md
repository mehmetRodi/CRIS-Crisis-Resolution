# ADR-0046: API integration tests — mocked adapter layer in CI, opt-in live sandbox suite

- **Status:** Accepted
- **Date:** 2026-08-13
- **Deciders:** Team (CRIS-29)
- **Relates to:** ADR-0011 (custom resolver conventions), ADR-0012 (amplify_outputs in CI),
  ADR-0016/0018 (CD pipeline), ADR-0030 (publish auth), ADR-0042 (volunteer projection),
  ADR-0044/0045 (offline retry/error contract and offline PII boundary)

## Context

Every custom AppSync operation follows ADR-0011's split: pure logic in `core.ts` (unit-tested)
and a thin AWS adapter in `handler.ts`. The adapter layer had **no tests at all**: identity
extraction (`AppSyncIdentityCognito` → `reporterId`/role), the exact DynamoDB transaction
shapes, the idempotent-replay branches, and the stable error-code contract
(`VALIDATION:` for deterministic submission rejections plus `CONFLICT:` / `FORBIDDEN:` /
`ILLEGAL_TRANSITION:` / `NOT_FOUND:` for transitions) were not asserted at this boundary, and
`publish-report-update` had no test file. ADR-0011 exists precisely because unit tests missed
live failures in this layer.

The only end-to-end guidance was a manual instruction in `docs/conventions.md`: smoke-test
write paths by hand against a personal sandbox. CI has no AWS credentials (ADR-0012 builds
against a placeholder `amplify_outputs.json`), so tests that hit real AWS cannot gate PRs.

ADR-0016/0017/0018 and the deploy runbook also book an automated **post-deploy smoke test**
against "CRIS-29/35".

## Options considered

- **Live sandbox tests only.** Highest fidelity, but needs credentials and a deployed
  backend, so it can never run on PRs in the current CI. Rejected as the sole approach.
- **Mocked handler tests only.** Runs everywhere, but never exercises real AppSync auth,
  synthesized resolvers, or DynamoDB semantics — exactly the contract breaks ADR-0011 warns
  unit-shaped tests miss. Rejected as the sole approach.
- **Both (chosen).** Mocked adapter tests gate every PR; a live suite is run on demand
  against a sandbox and automates what conventions.md previously asked developers to do by
  hand.
- **Tooling:** `aws-sdk-client-mock` vs the repo's existing hand-rolled fake clients.
  Hand-rolled chosen: the pattern already exists (`classify-report/store.test.ts`,
  `list-volunteer-tasks/store.test.ts`), keeps one mocking style, and avoids a dependency.

## Decision

1. **Handler-level integration tests run in CI.** Each custom resolver gets a co-located
   `handler.test.ts` that imports the real handler module and fakes only the AWS SDK client
   seam (the `DynamoDBDocumentClient.from` / STS / presigner boundary). They assert the
   adapter contracts: server-side identity resolution, transaction/command shapes and
   condition expressions, idempotent-replay handling on both DynamoDB signals, written-item
   invariants (null-stripping, `updatedAt` population), and the stable error-code prefixes.
2. **Shared hand-rolled fakes** live in `apps/web/amplify/functions/testing/` (a fake
   document client that records commands and replays queued responses/errors, plus AppSync
   event/identity builders). No new mocking dependency.
3. **An opt-in live integration suite** lives in `apps/web/tests/integration/` as
   `*.int.test.ts`, excluded from `npm test` and run explicitly with
   `npm run test:integration` against a deployed personal sandbox (`npx ampx sandbox`) with
   real AWS credentials. It provisions throwaway role users via Cognito admin APIs, exercises
   submission through User Pool plus guest/authenticated Identity Pool authorization, and covers
   guarded mutations end-to-end (idempotent replay, transition legality/role/lock errors, the
   volunteer projection's PII boundary, presigned media upload). It replaces the manual
   smoke-test instruction in `docs/conventions.md`.
4. **The API reference is `docs/api.md`** — hand-written, covering every operation, its auth
   modes, arguments/returns, error contract, and known contract quirks (e.g. `ReportEvent`
   rows written by custom resolvers carry no `updatedAt`, so reads must use an explicit
   selection set).
5. **The post-deploy smoke gate in `deploy.yml` is deferred to CRIS-35**, which owns system
   testing and alarms. The live suite is the building block it can reuse.

## Tradeoffs & consequences

- PR CI still never touches real AWS: synthesized AppSync auth rules, IAM grants, and table
  wiring remain validated only when someone (or, later, CRIS-35's deploy gate) runs the live
  suite. This is accepted; the alternative is credentials in PR CI.
- The mocked tests pin exact DynamoDB expressions. That is intentional — the expressions
  _are_ the contract — but it means refactors of a handler's persistence shape update tests
  alongside.
- The live suite writes to whatever backend `amplify_outputs.json` points at and cannot fully
  clean up (`ReportEvent` and `IdempotencyRecord` are append-only by design). It is
  documented as sandbox-only and must never target a shared environment.
- Two suites means two invocations (`npm test`, `npm run test:integration`); the split is
  enforced by Vitest config so the default run stays credential-free.
