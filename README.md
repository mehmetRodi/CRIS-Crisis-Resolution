# CrisisMap AI

Real-time serverless disaster intelligence and emergency coordination platform. CrisisMap AI
turns free-text emergency reports from citizens and field personnel into structured,
geolocated, priority-ranked incidents on a live map, and routes targeted alerts to response
teams — while staying available even when individual AI, geocoding, or notification
dependencies are degraded.

> **Status: scaffold.** This repo currently contains project structure, tooling, docs, and CI.
> No cloud resources are deployed yet. Feature work is tracked per ticket (CRIS-6…15).

## Architecture at a glance

Serverless AWS. A React SPA talks to a single AppSync GraphQL API (with subscriptions) backed
by DynamoDB; expensive AI work runs asynchronously (DynamoDB Streams → SQS → Lambda → Bedrock)
so the write path stays fast (report `NEW` ack < 800 ms) and resilient (a report is never lost
if AI/geocoding/alerts are down). See **[docs/architecture.md](docs/architecture.md)** and the
design document `crisismap.pdf`.

## Tech stack

| Layer           | Choice                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| Frontend        | Vite + React SPA (TypeScript, Tailwind) — [ADR-0002](docs/adr/0002-frontend-vite-react-spa.md)                   |
| Backend / IaC   | AWS Amplify Gen 2 + CDK escape hatches — [ADR-0003](docs/adr/0003-backend-amplify-gen2-with-cdk-escape-hatch.md) |
| API + real-time | AppSync GraphQL + subscriptions                                                                                  |
| Data / storage  | DynamoDB (on-demand), S3                                                                                         |
| Auth            | Amazon Cognito (groups + anonymous)                                                                              |
| AI              | Amazon Bedrock (Claude)                                                                                          |
| Async           | SQS + DynamoDB Streams; Lambda workers                                                                           |
| Alerts          | Amazon SNS                                                                                                       |
| Map             | MapLibre + Amazon Location Service                                                                               |
| Monorepo        | npm workspaces — [ADR-0001](docs/adr/0001-monorepo-npm-workspaces.md)                                            |

## Repository layout

```
apps/web/            Vite + React SPA (frontend) — includes amplify/ (Gen 2 backend)
packages/shared/     @crisismap/shared — domain enums/types shared across layers
docs/                architecture.md, conventions.md, adr/ (decision records)
.github/workflows/   CI
```

## Prerequisites

- **Node 22** (see `.nvmrc`; `nvm use`). Node ≥ 20 works.
- npm 10+ (bundled with Node).
- For backend deploy later: an AWS account and credentials (`aws configure` / SSO).

## Getting started

```bash
npm install          # install all workspaces
npm run dev          # start the web app at http://localhost:5173
```

Common commands (run from the repo root):

| Command                           | Description               |
| --------------------------------- | ------------------------- |
| `npm run build`                   | Build all workspaces      |
| `npm run typecheck`               | Type-check all workspaces |
| `npm run lint` / `lint:fix`       | ESLint                    |
| `npm run format` / `format:check` | Prettier                  |
| `npm test`                        | Unit tests (Vitest)       |

## Backend (not yet deployed)

The Amplify Gen 2 backend is _defined_ in `apps/web/amplify/` as minimal stubs, but nothing is
provisioned by the scaffold. Once you have AWS credentials configured:

```bash
cd apps/web
npx ampx sandbox     # provisions a personal dev backend + writes amplify_outputs.json
```

`amplify_outputs.json` and `.amplify/` are generated and git-ignored.

## Contributing

Read **[CLAUDE.md](CLAUDE.md)** (repo guide + conventions) and
**[docs/conventions.md](docs/conventions.md)**. Record significant decisions as ADRs in
[docs/adr/](docs/adr/). CI must be green before merging to `main`.
