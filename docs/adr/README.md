# Architecture Decision Records (ADRs)

An ADR captures a single significant decision: its context, the options considered, the
decision made, and the tradeoffs/consequences. ADRs give future contributors the **"why"**
behind the code — essential when refactoring or extending the system.

## Rules

1. One decision per file, numbered sequentially: `NNNN-short-title.md`.
2. ADRs are **immutable once accepted.** If a decision changes, write a _new_ ADR and mark the
   old one `Superseded by ADR-XXXX`. Never rewrite history.
3. Use [`0000-template.md`](0000-template.md) as the starting point.
4. Add new decisions as they are made — including during feature work, not just at setup.

## Index

| ADR                                                           | Title                                                  | Status                           |
| ------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------- |
| [0001](0001-monorepo-npm-workspaces.md)                       | Monorepo with npm workspaces                           | Accepted                         |
| [0002](0002-frontend-vite-react-spa.md)                       | Frontend: Vite + React SPA                             | Partially superseded by ADR-0020 |
| [0003](0003-backend-amplify-gen2-with-cdk-escape-hatch.md)    | Backend/IaC: Amplify Gen 2 + CDK                       | Accepted                         |
| [0004](0004-shared-domain-package.md)                         | Source-only shared domain package                      | Accepted                         |
| [0005](0005-ci-and-observability-baseline.md)                 | CI + observability baseline                            | Accepted                         |
| [0006](0006-dynamodb-mvp-data-model.md)                       | DynamoDB MVP data model                                | Accepted                         |
| [0007](0007-submit-report-write-path.md)                      | submitReport write path                                | Accepted                         |
| [0008](0008-report-transition-engine.md)                      | Report transition engine                               | Accepted                         |
| [0009](0009-public-projection-and-realtime-publish.md)        | Public projection + real-time                          | Accepted                         |
| [0010](0010-classification-contract-and-scoring.md)           | AI classification contract + scoring                   | Accepted                         |
| [0011](0011-custom-resolver-conventions-amplify-gen2.md)      | Custom AppSync resolver conventions                    | Accepted                         |
| [0012](0012-amplify-outputs-in-ci.md)                         | Amplify outputs handling in CI                         | Accepted                         |
| [0013](0013-async-classification-pipeline.md)                 | Async classification pipeline                          | Accepted                         |
| [0014](0014-rollup-native-binary-in-ci.md)                    | Rollup native binary for CI                            | Accepted                         |
| [0015](0015-observability-xray-cloudwatch-alarms.md)          | Observability: X-Ray + CW alarms                       | Accepted                         |
| [0016](0016-continuous-deployment-ampx-pipeline-oidc.md)      | CD: ampx pipeline-deploy + OIDC                        | Accepted                         |
| [0017](0017-aws-account-identity-and-region-topology.md)      | AWS account/identity/region topology                   | Accepted                         |
| [0018](0018-gate-deploy-on-ci-via-workflow-run.md)            | Gate deploy on CI via workflow_run                     | Accepted                         |
| [0019](0019-parcel-watcher-native-binary-in-deploy.md)        | Parcel watcher binary for deploy                       | Accepted                         |
| [0020](0020-react-native-mobile-app-for-citizen-reporting.md) | React Native (Expo) mobile app for citizen reporting   | Accepted                         |
| [0021](0021-web-emergency-fallback-report-form.md)            | Web emergency-fallback citizen report form             | Accepted                         |
| [0022](0022-coordinator-dashboard-shell.md)                   | Coordinator dashboard shell                            | Accepted                         |
| [0023](0023-coordinator-dashboard-live-read-path.md)          | Coordinator dashboard live incident read path          | Accepted                         |
| [0024](0024-optional-auth-and-anonymous-guest-access.md)      | Optional Cognito sign-in + anonymous guest access      | Accepted                         |
| [0025](0025-maplibre-base-map.md)                             | MapLibre base map (env tile source, lazy-loaded)       | Accepted                         |
| [0026](0026-bedrock-triage-agent.md)                          | Bedrock Triage Agent (tool-using classifier)           | Accepted                         |
| [0027](0027-amazon-location-places-geocoding.md)              | Amazon Location Places geocoding + shared geohash      | Accepted                         |
| [0028](0028-coordinator-status-transition-wiring.md)          | Coordinator status-transition wiring (frontend)        | Accepted                         |
| [0029](0029-worker-iam-publish-wiring.md)                     | Triage worker as IAM-only publisher (CRIS-19)          | Superseded by 0030 (Decision 1)  |
| [0030](0030-publish-mutation-requires-operation-auth-rule.md) | publishReportUpdate needs an operation-level auth rule | Accepted                         |
| [0031](0031-classify-worker-in-data-stack.md)                 | classify-report worker pinned to the data stack        | Accepted                         |
| [0032](0032-coordinator-queue-client-side-filters.md)         | Coordinator queue interactive filters (client-side)    | Accepted                         |
