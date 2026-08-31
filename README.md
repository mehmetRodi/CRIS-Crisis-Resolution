# CRIS

Real-time serverless disaster intelligence and emergency coordination platform. CRIS
turns free-text emergency reports from citizens and field personnel into structured,
geolocated, priority-ranked incidents on a live map, and routes targeted alerts to response
teams — while staying available even when individual AI, geocoding, or notification
dependencies are degraded.

> **Status: active MVP implementation.** The repository contains working mobile and web
> clients, an Amplify Gen 2 backend, the asynchronous Bedrock triage pipeline, CI/CD, and an
> observability baseline. Some target capabilities remain intentionally deferred; see the
> [current implementation matrix](docs/architecture.md#4-current-implementation-status).

## Architecture at a glance

Serverless AWS. The Expo mobile app and React SPA use an AppSync GraphQL API backed by
DynamoDB. Expensive AI work runs asynchronously through DynamoDB Streams → EventBridge Pipes
→ SQS → Lambda → Bedrock, keeping it off the report-submission path. Amazon Location Places
geocoding, conservative duplicate grouping, and presigned media uploads are wired. Custom
subscriptions, Amazon Location map tiles, richer incident-map overlays, media quarantine/signed
delivery, and citizen proximity alerts remain deferred. See
**[docs/architecture.md](docs/architecture.md)** for the distinction between the current
implementation and target architecture.

## Tech stack

| Layer          | Choice                                                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clients        | Expo + React Native mobile app; Vite + React SPA (TypeScript, Tailwind) — [ADR-0020](docs/adr/0020-react-native-mobile-app-for-citizen-reporting.md) |
| Backend / IaC  | AWS Amplify Gen 2 + CDK escape hatches — [ADR-0003](docs/adr/0003-backend-amplify-gen2-with-cdk-escape-hatch.md)                                     |
| API            | [AppSync GraphQL](docs/api.md); custom subscriptions are a deferred integration                                                                      |
| Data / storage | DynamoDB (on-demand), S3                                                                                                                             |
| Auth           | Amazon Cognito (groups + anonymous)                                                                                                                  |
| AI             | Amazon Bedrock (Claude)                                                                                                                              |
| Async          | SQS + DynamoDB Streams; Lambda workers                                                                                                               |
| Alerts         | Amazon SNS for operations alarms; citizen proximity alerts are deferred                                                                              |
| Map            | MapLibre with a configurable style URL; Amazon Location Places geocoding is wired, while Location map tiles are deferred                             |
| Monorepo       | npm workspaces — [ADR-0001](docs/adr/0001-monorepo-npm-workspaces.md)                                                                                |

## Repository layout

```
apps/web/            Vite + React SPA (frontend) — includes amplify/ (Gen 2 backend)
apps/mobile/         Expo + React Native citizen-reporting app
packages/shared/     @crisismap/shared — domain enums/types shared across layers
docs/                architecture, conventions, runbooks, and ADRs
scripts/aws/         one-time AWS account/team wiring helpers
infra/bootstrap/     GitHub OIDC deploy-role template
.github/workflows/   CI and gated backend deployment
```

## Prerequisites

- **Node 22** (see `.nvmrc`; `nvm use`). Node ≥ 20 works.
- npm 10+ (bundled with Node).
- For a personal backend sandbox: an AWS account and short-lived SSO credentials.

## Getting started

```bash
npm install          # install all workspaces
npm run dev          # start the web app at http://localhost:5173
npm run dev:mobile   # start the Expo development server
```

Common commands (run from the repo root):

| Command                           | Description                                     |
| --------------------------------- | ----------------------------------------------- |
| `npm run build`                   | Build workspaces that expose a build script     |
| `npm run typecheck`               | Type-check all workspaces                       |
| `npm run lint` / `lint:fix`       | ESLint                                          |
| `npm run format` / `format:check` | Prettier                                        |
| `npm test`                        | Test workspaces that expose a test script       |
| `npm run test:integration`        | Live API suite (personal sandbox flag required) |

## Personal backend sandbox

The Amplify Gen 2 backend is defined in `apps/web/amplify/`. With short-lived AWS credentials
configured, provision an isolated personal environment with:

```bash
cd apps/web
npx ampx sandbox     # provisions a personal dev backend + writes amplify_outputs.json
```

`amplify_outputs.json` and `.amplify/` are generated and git-ignored.
Production deployment is separately gated through `.github/workflows/deploy.yml`; see the
[deploy runbook](docs/runbooks/deploy.md). Source control alone does not establish whether a
shared environment is currently active.

## Contributing

Read **[CLAUDE.md](CLAUDE.md)** (repo guide + conventions) and
**[docs/conventions.md](docs/conventions.md)**. Record significant decisions as ADRs in
[docs/adr/](docs/adr/). CI must be green before merging to `main`.
