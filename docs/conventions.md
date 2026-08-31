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
- **AWS X-Ray** active tracing is enabled on AppSync and six Lambdas in `backend.ts`: submit,
  transition, publish, classification, media-upload URL creation, and team assignment. The
  volunteer-task resolver and Cognito role-assignment trigger are known tracing gaps (they are
  alarmed, not traced). New request/worker Lambdas get tracing + the `xray:Put*` grant the same
  way, and existing gaps should be closed when those paths receive observability work.
- **Alarms/metrics/dashboard** live in `apps/web/amplify/observability.ts` (`addObservability`).
  Thresholds trace back to the §3.2 SLAs; alarms notify the ops SNS topic, and the module has a
  synth-assertion test (`observability.test.ts`) that pins the alarm set. When you add a
  worker/queue/failure mode, add the matching alarm + a dashboard widget there, extend the synth
  test, and record the first-response in `docs/runbooks/incident-response.md`. Keep
  `treatMissingData: NOT_BREACHING` so idle environments don't page.

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
- The post-deploy smoke suite (`npm run test:smoke`, guarded by
  `CRISISMAP_SMOKE_TARGET=deployed`) is the one deliberate exception to "never target a shared
  environment": `deploy.yml` runs it against the environment it just deployed (CRIS-35,
  ADR-0051/0052). It submits one marked synthetic guest report, requires the async pipeline to
  produce structured AI fields (`AI_CLASSIFIED` or a valid `NEEDS_VERIFICATION`), then rejects it
  and deletes its throwaway coordinator. Failure triage lives in
  `docs/runbooks/incident-response.md`.

## UI & design system (ADR-0054, ADR-0055)

The web client has one design system. Nothing below is stylistic preference — each rule exists
because its absence produced a specific defect in the pre-CRIS-54 UI.

- **The palette lives in `@crisismap/design`, and nowhere else.** Both clients derive from it:
  web through `styles/tokens.css` (which restates the values because a browser needs literal CSS
  custom properties — a drift test fails if the two disagree), mobile through
  `apps/mobile/src/theme`. Add a colour to the package first, then to `tokens.css`. Never inline.
- **Never name a raw Tailwind palette step.** `bg-slate-50`, `text-blue-600`, and friends are
  gone: `tailwind.config.js` REPLACES the default colour scale with semantic tokens, so a raw
  step is a build error rather than a review catch.
- **Colour means severity, and only severity.** P0–P3 own the warm spectrum (red → orange →
  amber → neutral). The accent is teal specifically so an ordinary button can never be mistaken
  for a critical incident. `--info` is close to the accent in hue and is therefore reserved for
  passive informational surfaces — never for an interactive element.
- **"Unscored" is not P3.** A not-yet-classified report has its own neutral treatment
  (`UNSCORED_META`). Rendering it as P3 tells a coordinator the AI assessed it and found it
  routine, which is the opposite of the truth.
- **Domain enums are displayed through `lib/domain-display.ts`, never formatted inline** — and
  the WORDING inside it comes from `@crisismap/design`, so both clients call the same status by
  the same name. Every map is a total `Record<Enum, …>`, so adding a status or category without a
  label fails the type-check. `@crisismap/shared` owns the vocabulary and the authority; the
  display modules own only how it is shown and may never change behaviour.
- **A shared `Tone` is an intent, not a colour.** The design package emits intents; each client
  resolves them against its own styling layer (Tailwind badge variants on web, `StyleSheet`
  objects on mobile). Never put a class name or a hex value in the shared package.
- **Role capability is derived in `lib/capabilities.ts`, not tested inline.** Every flag mirrors
  a gate the server already enforces. If the two disagree, the server wins and the user sees an
  error — the correct failure direction. Never let this module be the only thing standing
  between a caller and an action.
- **Omit an action a role can never take; do not disable it.** A disabled control is a promise
  of access. (Distinct from ADR-0037's `aria-disabled`, which is for a control that is
  temporarily gated and has a reason to announce.)
- **Compose classes with `cn()`.** String concatenation leaves both conflicting classes in the
  attribute and lets stylesheet order decide, so a caller's `className` override silently loses.
- **Reach for the primitives in `components/ui/` before hand-rolling.** They carry the focus
  trapping, dismissal, and ARIA roles that overlays reliably get wrong.
- **Keep `maplibre-gl` behind a `React.lazy` boundary.** It is ~285 kB gzipped. Both the incident
  map and the report form's location picker are split; a single eager import anywhere in the
  graph pulls it back into the entry chunk and silently undoes both.
- **Distinguish "empty" from "filtered to empty" from "failed to load".** A coordinator reading
  "no incidents" when a filter is on, or when the read failed, will believe a region is quiet.

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

**These rules apply to the Expo app too, and it now follows them** (CRIS-57, ADR-0057). React
Native spells them differently: `accessibilityState={{ disabled }}` on a still-pressable control
rather than `aria-disabled`; `accessibilityLiveRegion` rather than `role="status"`;
`AccessibilityInfo.setAccessibilityFocus` rather than `.focus()` for anything that is not a text
input. The trap to know: a React Native `Pressable` with `disabled` is removed from the
accessibility tree entirely, so a screen reader cannot reach it to hear why it is unavailable —
which is why `Button` distinguishes `blocked` from `disabled`.

Not covered by these tests, and still owed: colour contrast, zoom/reflow, and real screen-reader
passes against WCAG 2.1 AA. **The mobile workspace still has no test harness**, so its surfaces —
including the accessibility behaviour just described — are verified only by a successful Metro
bundle and by review. Adding `jest-expo` + `@testing-library/react-native` is an open follow-up.

## Commits & branches

- Work on feature branches; reference the ticket (e.g. `CRIS-9`) in the branch/PR.
- CI (lint → typecheck → build → test) must be green before merge to `main`.

## Decisions

- Any architectural or tooling decision gets an **ADR** in `docs/adr/` (see `adr/README.md`).
  ADRs are immutable once accepted; supersede rather than edit.
