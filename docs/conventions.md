# Conventions

Shared conventions for CrisisMap AI. Keep this current; it is the reference for reviews.

## Language & style

- **TypeScript everywhere**, `strict` mode (see `tsconfig.base.json`). Also enabled:
  `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`, `verbatimModuleSyntax`.
- Use `import type { ... }` for type-only imports (required by `verbatimModuleSyntax`).
- Formatting is **Prettier** (single quotes, semicolons, trailing commas, width 100). Don't
  hand-format; run `npm run format`. Linting is **ESLint** (`npm run lint`).
- Prefer named exports. Default export only where a framework expects it (e.g. React page
  components, Vite/Amplify entry files).

## Domain vocabulary

- The report lifecycle, roles, priority bands, and classification enums live **once** in
  `packages/shared/src/domain.ts`. Import them from `@crisismap/shared` — never redefine
  string literals inline in app code.
- Amplify's `data` schema needs literal enum arrays, so those members are duplicated in
  `apps/web/amplify/data/resource.ts`. When you change an enum, update **both** and note it.
- Never introduce a status transition that isn't in `STATUS_TRANSITIONS` (design doc §5.1).

## Security & privacy (design doc §5.4.1, §5.6)

- **No PII in logs or prompts.** Reporter identity and contact data are protected. Async
  classification jobs carry only IDs and trace metadata, never raw contact info.
- Treat user-submitted report text as **untrusted** in prompts (prompt-injection defense).
- Contact data must be encrypted at rest and excluded from prompts and public projections.
  Public-facing APIs must return the separate `PublicReport` shape rather than relying on UI
  redaction. The coordinator dashboard's `Report.list` read is staff-group-gated, but it still
  receives full `Report` records before projecting them locally; treat that projection as data
  minimization for an internal MVP surface, not as a public security boundary.
- Mutations use **optimistic concurrency**: require `expectedVersion` + conditional write;
  a conflict returns a machine-readable `CONFLICT` error.

## Logging & observability (wired — CRIS-15, ADR-0015)

- Emit **structured JSON logs** (one object per line) with a correlation/trace id, the
  `reportId`, and the event type. No free-form string logs for domain events. (See the
  `classify-report` handler for the pattern.)
- **AWS X-Ray** active tracing is enabled on AppSync and five Lambdas in `backend.ts`: submit,
  transition, publish, classification, and media-upload URL creation. The volunteer-task resolver
  and Cognito role-assignment trigger are known tracing gaps. New request/worker Lambdas get
  tracing + the `xray:Put*` grant the same way, and existing gaps should be closed when those
  paths receive observability work.
- **Alarms/metrics/dashboard** live in `apps/web/amplify/observability.ts` (`addObservability`).
  Thresholds trace back to the §3.2 SLAs; alarms notify the ops SNS topic. When you add a
  worker/queue/failure mode, add the matching alarm + a dashboard widget there, and record the
  first-response in `docs/runbooks/deploy.md`. Keep `treatMissingData: NOT_BREACHING` so idle
  environments don't page.

## Backend custom resolvers (Amplify Gen 2)

Hand-written AppSync resolver Lambdas bypass everything Amplify's generated resolvers do for
you. Every custom resolver that writes to DynamoDB **must** follow this checklist (full
rationale in ADR-0011):

- **Strip `null`/`undefined` before writing.** DynamoDB rejects a `NULL` value on any index
  key. Use `forDynamoItem(...)`; do not rely on `removeUndefinedValues` (it keeps `null`).
  An unset indexed attribute must be _absent_, not `null`.
- **Set the Amplify-managed timestamps yourself.** Every model has a non-nullable `updatedAt`
  (and an implicit `createdAt` unless declared). Populate them on every written item or the
  GraphQL response fails to serialize. On create, `updatedAt == createdAt`; an update bumps
  `updatedAt`.
- **Handle idempotent replays on both signals.** A retried write surfaces as
  `TransactionCanceledException` _or_ `IdempotentParameterMismatchException` — treat both as
  "already processed" and return the original record.
- **Put resolver+table functions in the data stack.** If a `defineFunction` is both a schema
  resolver and granted table access in `backend.ts`, set `resourceGroupName: 'data'` to avoid
  a nested-stack circular dependency.
- **Custom subscriptions need a `.handler()`**, not just an auth rule (an AppSync JS resolver
  that sets the filter). With the currently pinned Amplify schema processor,
  `a.handler.custom` does not support Identity Pool guest/authenticated rules; decide and document
  another public auth mode before exposing an anonymous subscription (ADR-0048).

## Testing

- **Vitest** for unit tests, co-located as `*.test.ts(x)` next to the code.
- CI runs `npm test` across workspaces that expose a `test` script. The mobile workspace does
  not currently expose one; add a mobile test script when its test harness lands.
- Domain logic (state machine, scoring) must have unit tests — it's the safety-critical core.
- Every custom resolver has a co-located handler integration test that imports the real handler
  and fakes only its AWS SDK boundary. These tests run in `npm test` and pin identity extraction,
  command/transaction shapes, error prefixes, and redaction contracts (ADR-0046).
- Live AWS coverage is opt-in and sandbox-only. Start `npx ampx sandbox`, then run
  `CRISISMAP_INTEGRATION_TARGET=personal-sandbox npm run test:integration` from the repository
  root. The exact flag is a destructive-write acknowledgement: the suite creates temporary users,
  reports, audit/idempotency rows, and an S3 object. It refuses to run without the flag and must
  never target a shared environment.

## Accessibility (ADR-0036)

Users reach these surfaces under duress — one-handed, on a phone, sometimes with a screen
reader. Every web interactive surface ships with five guarantees, asserted in a co-located
`*.a11y.test.tsx`:

- **Label every control programmatically** — `htmlFor`/`id`, or `aria-label` when there is no
  visible label. A placeholder is a hint, never an accessible name. Query controls in tests
  with `getByLabelText`, not `getByPlaceholderText`; the query is the assertion.
- **Convey required state non-visually** — `aria-required`, plus visually-hidden "(required)"
  next to the `aria-hidden` asterisk. A bare `*` announces as "star", or not at all.
- **A gated control says why, and stays reachable to say it** (ADR-0037) — use `aria-disabled`,
  not `disabled`, and point at the reason with `aria-describedby`. A `disabled` control leaves
  the tab order, so a description on it is never announced to the keyboard user it was written
  for. Enforce the gate in the handler, and answer activation with something — moving focus to
  the field at fault — rather than a silent no-op. Reserve `disabled` for a control that is
  genuinely inert and has nothing to explain.
- **Announce state changes** — `role="alert"` for errors, `role="status"` for success and for
  degraded dependencies (a blank map reads as a working one otherwise). **Mount the region
  before its content** and toggle only the text (ADR-0037): assistive tech reports changes to
  regions it is already watching, so a region inserted together with its message is commonly
  missed. Hold an empty region out of the layout with `sr-only`, never `display: none`.
- **Move focus when a region is replaced** — otherwise focus is stranded on an unmounted node.
  This is also the announcement mechanism for a wholesale replacement, where a persistent
  region would have nothing to persist.

Not covered by these tests, and still owed: colour contrast, zoom/reflow, and real
screen-reader passes against WCAG 2.1 AA. The mobile workspace has no test harness, so its
surfaces are unasserted.

## Commits & branches

- Work on feature branches; reference the ticket (e.g. `CRIS-9`) in the branch/PR.
- CI (lint → typecheck → build → test) must be green before merge to `main`.

## Decisions

- Any architectural or tooling decision gets an **ADR** in `docs/adr/` (see `adr/README.md`).
  ADRs are immutable once accepted; supersede rather than edit.
