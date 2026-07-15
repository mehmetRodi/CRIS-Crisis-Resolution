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

| ADR                                                        | Title                                | Status   |
| ---------------------------------------------------------- | ------------------------------------ | -------- |
| [0001](0001-monorepo-npm-workspaces.md)                    | Monorepo with npm workspaces         | Accepted |
| [0002](0002-frontend-vite-react-spa.md)                    | Frontend: Vite + React SPA           | Accepted |
| [0003](0003-backend-amplify-gen2-with-cdk-escape-hatch.md) | Backend/IaC: Amplify Gen 2 + CDK     | Accepted |
| [0004](0004-shared-domain-package.md)                      | Source-only shared domain package    | Accepted |
| [0005](0005-ci-and-observability-baseline.md)              | CI + observability baseline          | Accepted |
| [0006](0006-dynamodb-mvp-data-model.md)                    | DynamoDB MVP data model              | Accepted |
| [0007](0007-submit-report-write-path.md)                   | submitReport write path              | Accepted |
| [0008](0008-report-transition-engine.md)                   | Report transition engine             | Accepted |
| [0009](0009-public-projection-and-realtime-publish.md)     | Public projection + real-time        | Accepted |
| [0010](0010-classification-contract-and-scoring.md)        | AI classification contract + scoring | Accepted |
| [0011](0011-custom-resolver-conventions-amplify-gen2.md)   | Custom AppSync resolver conventions  | Accepted |
| [0012](0012-amplify-outputs-in-ci.md)                      | Amplify outputs handling in CI       | Accepted |
| [0013](0013-async-classification-pipeline.md)              | Async classification pipeline        | Accepted |
| [0014](0014-rollup-native-binary-in-ci.md)                 | Rollup native binary for CI          | Accepted |
| [0015](0015-observability-xray-cloudwatch-alarms.md)       | Observability: X-Ray + CW alarms     | Accepted |
| [0016](0016-continuous-deployment-ampx-pipeline-oidc.md)   | CD: ampx pipeline-deploy + OIDC      | Accepted |
| [0017](0017-aws-account-identity-and-region-topology.md)   | AWS account/identity/region topology | Accepted |
| [0018](0018-gate-deploy-on-ci-via-workflow-run.md)         | Gate deploy on CI via workflow_run   | Accepted |
| [0019](0019-parcel-watcher-native-binary-in-deploy.md)     | Parcel watcher binary for deploy     | Accepted |
| [0020](0020-coordinator-dashboard-shell.md)                | Coordinator dashboard shell          | Accepted |
