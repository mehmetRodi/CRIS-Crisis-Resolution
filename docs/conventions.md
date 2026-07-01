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
- Contact data is KMS-encrypted and excluded from public projections; a separate
  `PublicReport` type guarantees identity/contact/internal notes can't leak.
- Mutations use **optimistic concurrency**: require `expectedVersion` + conditional write;
  a conflict returns a machine-readable `CONFLICT` error.

## Logging & observability (baseline for CRIS-15; wired with Lambdas)

- Emit **structured JSON logs** (one object per line) with a correlation/trace id, the
  `reportId`, and the event type. No free-form string logs for domain events.
- Plan for **AWS X-Ray** tracing across AppSync → Lambda → downstream calls.
- Alarms/metrics (submission latency, classification latency, DLQ depth) are defined when the
  pipeline lands (CRIS-10/14). Until then this section is the contract.

## Testing

- **Vitest** for unit tests, co-located as `*.test.ts(x)` next to the code.
- Every workspace exposes a `test` script; CI runs `npm test` across all workspaces.
- Domain logic (state machine, scoring) must have unit tests — it's the safety-critical core.

## Commits & branches

- Work on feature branches; reference the ticket (e.g. `CRIS-9`) in the branch/PR.
- CI (lint → typecheck → build → test) must be green before merge to `main`.

## Decisions

- Any architectural or tooling decision gets an **ADR** in `docs/adr/` (see `adr/README.md`).
  ADRs are immutable once accepted; supersede rather than edit.
