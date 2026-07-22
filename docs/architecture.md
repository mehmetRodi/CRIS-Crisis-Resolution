# CrisisMap AI — Architecture Overview

A living, code-adjacent reference for the versioned repository. A local `crisismap.pdf`, when
supplied, provides product-design context but is not currently tracked. Accepted decisions are
recorded in [`adr/`](adr/). This document distinguishes the target design from what is wired
today.

## 1. Target system shape (design doc §3)

CrisisMap AI is designed as a **serverless AWS application**. Clients talk to a single AppSync
GraphQL API backed by DynamoDB. Expensive AI work is pushed onto an asynchronous queue so the
write path stays fast and resilient. The diagram is the end-state design; consult the current
implementation matrix below before assuming a component is operational.

```
        ┌──────────────────────────────────────────────┐
        │ React Native app (Citizen) · React SPA (Web) │  Volunteer · Responder · Coordinator
        └────────────────────┬─────────────────────────┘
                     │ HTTPS / GraphQL (+ subscriptions)
                     ▼
        ┌──────────────────────────┐        ┌───────────────┐
        │   AWS AppSync GraphQL     │◄───────│ Amazon Cognito│ (user pools + groups)
        └────────────┬─────────────┘        └───────────────┘
                     │ resolvers
                     ▼
        ┌──────────────────────────┐        ┌───────────────┐
        │        DynamoDB           │───────▶│  S3 (media)   │
        │   (system of record)      │ stream └───────────────┘
        └────────────┬─────────────┘
                     │ DynamoDB Streams → SQS (classification queue)
                     ▼
        ┌──────────────────────────┐
        │      Lambda workers       │ classify (Bedrock Triage Agent) · geocode
        │                           │ (Amazon Location) · score · dedupe
        └────────────┬─────────────┘
                     │ conditional write, then IAM-only publishReportUpdate mutation
                     ▼
        ┌──────────────────────────┐        ┌───────────────┐
        │  AppSync subscriptions    │        │ SQS alert q → │ Alert Lambda → SNS
        │  (near real-time updates) │        │  SMS/email/push│
        └──────────────────────────┘        └───────────────┘
```

### Target flow (design doc §3, Fig 9)

1. Client submits a report through AppSync → written durably to DynamoDB → returned
   immediately as `NEW` (p95 < 800 ms).
2. A DynamoDB stream feeds an SQS queue; Lambda workers classify, geocode, score priority,
   and detect duplicates.
3. The worker writes results back conditionally, then calls an IAM-protected internal
   `publishReportUpdate` mutation so subscribed clients update in near real time (p95 < 2 s).
4. Threshold-crossing incidents enqueue alerts delivered via SNS.

## 2. Report lifecycle (design doc §5.1)

State machine — every transition is role-checked, version-checked (optimistic lock), and
appends an immutable audit event. Encoded in code as `STATUS_TRANSITIONS` in
`packages/shared/src/domain.ts`.

```
NEW → PROCESSING → AI_CLASSIFIED → VERIFIED → IN_PROGRESS → RESOLVED
                        │              ▲                        │
                        │ low conf.    │ confirmed              │ reopen
                        ▼              │                        ▼
                 NEEDS_VERIFICATION ───┘                   IN_PROGRESS
                        │
                        ▼
                    REJECTED (terminal)
```

## 3. Design guarantees and service targets (design doc §1.1, §3.2)

These are requirements for the completed system, not claims that every path is implemented or
that the latency objectives have been measured in a deployed environment.

- A report is **never lost** once acknowledged, even if AI/geocoding/notifications are down
  (bounded retries, DLQs, defined terminal states; a Bedrock failure ⇒ `NEEDS_VERIFICATION`).
- Submission stays fast (p95 < 800 ms) — AI runs asynchronously.
- Coordinators get a single, de-duplicated, priority-ordered view (p95 < 2 s propagation).
- Public users see only **redacted** data; reporter identity/contact is protected.
- Priority is a **deterministic, explainable** score in [0, 10] mapped to bands P0–P3 — never
  raw model output.

## 4. Current implementation status

| Component                            | Current state                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React Native citizen app             | `apps/mobile` has optional sign-in, an Expo report form, image selection, and guest/authenticated `submitReport` wiring. GPS/location input and S3 media upload remain deferred.                                                                                                                                                                                                                     |
| React SPA client                     | `apps/web` has landing, sign-in/sign-up/confirmation, `/report`, `/coordinator`, and `/map` routes. The coordinator route requires a session to read data but does not yet enforce a Cognito group at the route boundary.                                                                                                                                                                            |
| Cognito auth                         | `apps/web/amplify/auth` defines email sign-in, five groups, and guest Identity Pool access. Web and mobile authentication UI exists; automatic group assignment and route-level role gates remain deferred.                                                                                                                                                                                          |
| AppSync + DynamoDB                   | `apps/web/amplify/data` defines 11 persistent models, six `Report` GSIs, custom mutations, and a `PublicReport` type. Model authorization remains coarse; generated model operations still coexist with guarded custom mutations.                                                                                                                                                                    |
| Write path (`submitReport`)          | `amplify/functions/submit-report` performs a durable `NEW` create, audit append, and client-request-id idempotency.                                                                                                                                                                                                                                                                                  |
| State transition mutation            | `amplify/functions/transition-report` implements role-checked, version-checked status transitions with audit events.                                                                                                                                                                                                                                                                                 |
| Public projection + real-time        | `PublicReport` and `publishReportUpdate` are defined, but the mutation is currently ADMIN-authorized, the classifier does not call it, and custom subscriptions are disabled. Dashboard data is a one-shot authenticated `Report.list` read with local redaction.                                                                                                                                    |
| AI classification contract + scoring | `packages/shared/src/classification.ts` contains the versioned v2 triage contract, entity extraction shape, deterministic scoring, and `ScoreBreakdown`.                                                                                                                                                                                                                                             |
| Async Bedrock pipeline               | DynamoDB Stream → EventBridge Pipe → SQS (+ DLQ) → Lambda → Bedrock Triage Agent is wired. The worker selects the Amazon Location Places geocoder by default and derives geohashes through shared code, but its role does not yet grant the Places `Geocode` action, so deployed calls degrade to unlocated results until IAM is completed. Deduplication and citizen-alert enqueueing are deferred. |
| S3 media                             | `apps/web/amplify/storage` defines a coarse report-media bucket access rule. Presigned upload, quarantine, stricter ownership, and signed delivery are deferred.                                                                                                                                                                                                                                     |
| Map                                  | `apps/web/src/surfaces/map` provides a lazy-loaded MapLibre base map using `VITE_MAP_STYLE_URL` or public demo tiles. Amazon Location map tiles and incident markers/clustering are not wired; backend Places geocoding is tracked separately above.                                                                                                                                                 |
| Shared domain vocabulary             | `packages/shared` provides statuses, roles, bands, categories, classification/scoring, authentication rules, and report-form validation used across clients and backend.                                                                                                                                                                                                                             |
| CI/CD                                | `ci.yml` runs formatting, lint, typecheck, build, and available workspace tests. After successful `main` CI, `deploy.yml` can run `ampx pipeline-deploy` through OIDC when `AWS_DEPLOY_ENABLED=true`; source control does not reveal whether it is enabled.                                                                                                                                          |
| Observability                        | AppSync and four Lambdas have X-Ray tracing; CloudWatch alarms, an SLA dashboard, structured logs, and an ops SNS topic are defined. Real-time fan-out metrics remain dormant until that path is connected.                                                                                                                                                                                          |

## 5. Deferred to later phases (design doc §1.2, §4)

Phase 2: Verification Agent + Dispatch Agent, ChatOps (Slack/Teams), OpenSearch, SageMaker
Geospatial satellite verification. Future: CV damage assessment, evacuation routing,
cross-agency identity federation, active-active multi-region writes.
