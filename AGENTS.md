# CLAUDE.md

Guidance for AI agents **and** humans working in this repository. Read this first.

## What this project is

**CrisisMap AI** — a real-time, serverless AWS platform that turns free-text emergency
reports from citizens and field personnel into structured, geolocated, priority-ranked
incidents on a live map, and routes targeted alerts to response teams. It stays available
even when individual AI/geocoding/notification dependencies are degraded.

The current, versioned architecture is summarized in
[`docs/architecture.md`](docs/architecture.md), with decisions recorded as ADRs in
[`docs/adr/`](docs/adr/). A local `crisismap.pdf`, when supplied, is product-design context;
it is not currently a versioned repository artifact. **When you make a design decision, add
an ADR.**

## Current state: active MVP implementation

Implemented foundations include mobile and web report submission, optional Cognito sign-in
and anonymous guest access, the DynamoDB data model, guarded submit/status mutations, the
Streams → SQS → Lambda → Bedrock triage pipeline, deterministic scoring, dashboard reads,
MapLibre base maps, CI/CD, and observability.

Important deferred seams are listed in [`docs/architecture.md`](docs/architecture.md): media
quarantine/signed delivery (presigned upload itself landed in CRIS-17), Amazon Location map
tiles, custom subscriptions (the worker-to-AppSync publish call is wired in CRIS-19, but
nothing subscribes yet), citizen alerts, interactive coordinator workflows, and security
hardening. Do not infer the state of a deployed
environment from the source tree.

## Repository map

```
.
├── apps/
│   ├── mobile/              # @crisismap/mobile — Expo + React Native (citizen reporting, CRIS-6)
│   │   └── src/             # report form screen/components
│   └── web/                 # @crisismap/web — Vite + React SPA (coordinator/responder/volunteer UI)
│       ├── src/             # React routes, auth, reporting, dashboard, and map
│       └── amplify/         # Amplify Gen 2 backend definition (shared by both clients)
├── packages/
│   └── shared/              # @crisismap/shared — domain enums/types (source-only pkg)
├── docs/
│   ├── architecture.md      # living system overview
│   ├── conventions.md       # coding/logging/testing conventions
│   └── adr/                 # Architecture Decision Records (one file per decision)
├── .github/workflows/ci.yml # CI (CRIS-15)
├── .github/workflows/deploy.yml # gated backend CD after successful CI
├── scripts/aws/             # AWS account/team wiring helpers
├── infra/bootstrap/         # GitHub OIDC deploy-role template
├── tsconfig.base.json       # shared TS compiler options
├── eslint.config.js         # flat ESLint config (repo-wide)
└── crisismap.pdf            # optional local product-design context (not tracked)
```

## Tech stack (see design doc §4, ADR 0003, ADR 0020)

**Cross-platform clients:** React Native (Expo) mobile app for citizen reporting ·
Vite + React SPA for the coordinator/responder/volunteer web UI · TypeScript everywhere ·
AWS Amplify Gen 2 (Cognito, AppSync GraphQL, DynamoDB, S3) with CDK escape hatches for the
async pipeline · Bedrock (Claude) for classification · SQS + DynamoDB Streams · Lambda · SNS
· MapLibre · Amazon Location integration in progress. Custom AppSync subscriptions are not
currently enabled.

## Commands

Run from the repo root (npm workspaces):

| Command                                   | What it does                                      |
| ----------------------------------------- | ------------------------------------------------- |
| `npm install`                             | Install all workspace dependencies                |
| `npm run dev`                             | Start the web app (Vite) at http://localhost:5173 |
| `npm run dev:mobile`                      | Start the Expo dev server (dev-client, see below) |
| `npm run build`                           | Build workspaces with a build script              |
| `npm run typecheck`                       | Type-check all workspaces                         |
| `npm run lint` / `npm run lint:fix`       | ESLint                                            |
| `npm run format` / `npm run format:check` | Prettier                                          |
| `npm test`                                | Test workspaces with a test script                |

**The mobile app no longer runs in Expo Go.** MapLibre's location picker (CRIS-16,
ADR-0034) needs native code, so `npm run dev:mobile` starts Metro in `--dev-client` mode
and expects a custom development build already installed on the device or simulator:

```bash
cd apps/mobile
eas init                                             # once: links app.json to your EAS project
eas build --profile development --platform android   # or: npx expo run:android
```

`app.json` deliberately carries no `owner` or `extra.eas.projectId` — those bind the repo to
one person's Expo account. `eas init` writes them locally; keep them out of commits until the
team has a shared Expo organization.

For an iOS simulator, build with a simulator-flagged profile (EAS defaults iOS builds to
device), then `xcrun simctl install booted <path>` or drag the `.app` onto the simulator.
Install the resulting build once, then use `npm run dev:mobile` for day-to-day work.

Personal backend sandbox (requires short-lived AWS credentials):

```bash
cd apps/web
npx ampx sandbox        # stand up a personal dev backend
```

## Conventions (full list in docs/conventions.md)

- **TypeScript everywhere.** `strict` on. Prefer `import type` for type-only imports
  (`verbatimModuleSyntax` is enabled).
- **Shared vocabulary lives in `@crisismap/shared`.** Report statuses, roles, priority
  bands, and classification enums are defined there once. If you add a status/role/category,
  update `packages/shared/src/domain.ts` and the Amplify `data` schema together.
- **Never log or send PII to prompts.** Reporter identity/contact is protected (design doc
  §5.4.1, §5.6). Classification jobs carry IDs + trace metadata only.
- **Custom domain mutations are version-checked and audited where applicable** (design doc
  §5.1). Don't add status transitions outside `STATUS_TRANSITIONS`. Generated model mutations
  still exist under coarse model authorization and are not a substitute for guarded resolvers.
- **Document decisions as ADRs.** New decision → new numbered file in `docs/adr/`. Never edit
  a decided ADR; supersede it with a new one.

## Ticket ownership (Sprint 1 epics)

Keep new work in its owning ticket. This table records ownership, not completion status; use
`docs/architecture.md` for the current implementation state.

| Epic                            | Tickets                                                              |
| ------------------------------- | -------------------------------------------------------------------- |
| E1 Citizen Reporting & Media    | CRIS-6 (report form), CRIS-7 (auth + anonymous)                      |
| E2 API, Data & Real-Time        | CRIS-8 (DynamoDB model), CRIS-9 (`submitReport` mutation)            |
| E3 AI Triage & Prioritization   | CRIS-10 (Streams→SQS→Lambda), CRIS-11 (classification JSON contract) |
| E4 Coordinator & Volunteer UI   | CRIS-12 (dashboard shell), CRIS-13 (MapLibre base map)               |
| E5 Infra, Security, Alerts & QA | CRIS-14 (IaC baseline), CRIS-15 (CI + observability)                 |

## Ticket ownership (Sprint 2 epics)

| Epic                            | Tickets                                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| E1 Citizen Reporting & Media    | CRIS-16 (GPS, map-pin and location-hint input), CRIS-17 (presigned S3 media upload)                 |
| E2 API, Data & Real-Time        | CRIS-18 (report state-machine mutations), CRIS-19 (public projection and internal publish mutation) |
| E3 AI Triage & Prioritization   | CRIS-20 (Bedrock triage agent), CRIS-21 (Amazon Location geocoding)                                 |
| E4 Coordinator & Volunteer UI   | CRIS-22 (priority incident queue and filters), CRIS-23 (incident-detail interface)                  |
| E5 Infra, Security, Alerts & QA | CRIS-24 (Cognito roles and authorization), CRIS-25 (WAF, KMS and security controls)                 |

## Ticket ownership (Sprint 3 epics)

| Epic                            | Tickets                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| E1 Citizen Reporting & Media    | CRIS-26 (offline save, retry and recovery), CRIS-27 (frontend accessibility and tests)         |
| E2 API, Data & Real-Time        | CRIS-28 (AppSync subscriptions), CRIS-29 (API integration tests and documentation)             |
| E3 AI Triage & Prioritization   | CRIS-30 (deterministic priority scoring), CRIS-31 (duplicate detection, DLQ and idempotency)   |
| E4 Coordinator & Volunteer UI   | CRIS-32 (guarded coordinator actions), CRIS-33 (volunteer task board and UI integration tests) |
| E5 Infra, Security, Alerts & QA | CRIS-34 (proximity-alert pipeline), CRIS-35 (system testing, alarms and runbook)               |
