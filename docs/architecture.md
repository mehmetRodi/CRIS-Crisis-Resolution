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
                     │ conditional write, then worker IAM call to publishReportUpdate
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
3. The worker writes results back conditionally, then calls `publishReportUpdate` over IAM so
   subscribed clients update in near real time (p95 < 2 s). The operation also retains the narrow
   `ADMIN` rule Amplify requires (ADR-0030).
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

| Component                            | Current state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React Native citizen app             | `apps/mobile` has optional sign-in, an Expo report form, image selection, and guest/authenticated `submitReport` wiring. Location capture is in place (CRIS-16, ADR-0034): GPS via `expo-location`, plus a MapLibre aim-and-confirm map pin and a free-text location hint. Because MapLibre needs native code, the app now requires a custom Expo dev-client build and no longer runs in Expo Go. Picked photos now upload to S3 via a presigned URL before submission (CRIS-17, ADR-0035). A failed or offline submission saves locally and retries automatically once connectivity returns, surfaced via a persistent status banner (CRIS-26, ADR-0044); mobile-specific code for this ships without automated tests, per the existing ADR-0037 gap.                                                                                                                                                      |
| React SPA client                     | `apps/web` has landing, sign-in/sign-up/confirmation, `/report`, `/coordinator`, `/volunteer`, and `/map` routes. The coordinator dashboard renders the priority-ordered incident queue with client-side filters, global metrics, incident classification/summary/entities/score detail, an audit timeline, and guarded CRIS-18 transition controls (CRIS-22/23, ADR-0032/0033). `/coordinator` is gated to `COORDINATOR`/`ADMIN`; `/volunteer` is gated to operational staff roles. The volunteer surface renders a refresh-driven, read-only five-lane task board with region/category/urgency filters from the server-redacted `listVolunteerTasks` query (CRIS-33, ADR-0040/0042). Interactive team/region-scoped volunteer mutations remain deferred. The `/report` form shares the mobile offline save/retry/recovery behavior (CRIS-26, ADR-0044).                                                   |
| Cognito auth                         | `apps/web/amplify/auth` defines email sign-in, five groups, guest Identity Pool access, and Cognito triggers that assign `CITIZEN` after self-sign-up and reconcile a transient assignment failure on the next authentication (CRIS-24, ADR-0041). Staff groups remain admin-assigned; no invite flow exists. `AuthContext` exposes the caller's ID-token groups as `roles`/`highestRole`, and `RequireRole` gates the coordinator and volunteer routes.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| AppSync + DynamoDB                   | `apps/web/amplify/data` defines 11 persistent models, six `Report` GSIs, guarded custom mutations, `PublicReport`, and the custom `VolunteerTask` query/type. CRIS-24 removed blanket authenticated `Report` reads; ADR-0042 additionally removes generated model reads from volunteers and gives them the Lambda-backed redacted task projection instead. The projection's DynamoDB and GraphQL allow-lists exclude reporter data, raw text, media, notes, and precise coordinates. Other generated model operations remain coarse and coexist with guarded custom operations.                                                                                                                                                                                                                                                                                                                             |
| API contract + tests                 | `docs/api.md` documents custom operations, auth modes, stable errors, generated-model authorization, and known wire quirks. Handler-level adapter tests for all five custom operations run in normal CI; an explicitly acknowledged `npm run test:integration` suite provisions throwaway Cognito role users and exercises AppSync/Lambda/DynamoDB/S3 against a personal sandbox only (CRIS-29, ADR-0046). Automated post-deploy invocation remains CRIS-35.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Write path (`submitReport`)          | `amplify/functions/submit-report` performs a durable `NEW` create, audit append, and client-request-id idempotency.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| State transition mutation            | `amplify/functions/transition-report` implements role-checked, version-checked status transitions with audit events. The coordinator dashboard now invokes `updateReportStatus` from the incident-detail panel (client wrapper `lib/transition-report.ts` + `useReportTransition`), offering moves legal for the caller's real Cognito role (`callerRole`, CRIS-24), passing the read `version` as the optimistic lock, and surfacing `CONFLICT` (CRIS-18, ADR-0028, ADR-0041).                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Public projection + real-time        | `PublicReport` is the redacted projection. The `classify-report` worker calls `publishReportUpdate` over its schema-level IAM resource grant after the durable write (best-effort). Amplify also requires a per-operation authorization rule, so `ADMIN` remains the narrow client-facing rule; ordinary client roles cannot invoke it (CRIS-19, ADR-0009/0029/0030). The AI `summary` is persisted on `Report` and flows through both paths. Custom subscriptions that consume the mutation are still disabled (CRIS-28), so nothing subscribes yet; dashboard data remains a one-shot staff-gated `Report.list` read with local redaction.                                                                                                                                                                                                                                                                |
| AI classification contract + scoring | `packages/shared/src/classification.ts` contains the versioned v2 triage contract, entity extraction shape, deterministic scoring, and `ScoreBreakdown`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Async Bedrock pipeline               | DynamoDB Stream → EventBridge Pipe → SQS (+ DLQ) → Lambda → Bedrock Triage Agent is wired; both hops now have a dead-letter queue, and the pipe's is deliberately separate because its payloads are stream records, not worker messages (ADR-0038). The worker selects the Amazon Location Places geocoder by default, has the `geo-places:Geocode` grant, and derives geohashes through shared code; the feature flag provides a null-geocoder fallback. Conservative duplicate detection (§5.4.3, ADR-0038) runs after the durable write as a best-effort step: candidates come from the geohash GSI, are scored `Ds = 0.40·L + 0.25·T + 0.20·G + 0.15·E`, and strong matches (≥ 0.80) join a shared `duplicateGroupId` through one atomic `TransactWriteItems` (max 50 members). Group merging, and surfacing the 0.65–0.79 review band beyond CloudWatch, are deferred; so is citizen-alert enqueueing. |
| S3 media                             | `apps/web/amplify/storage` defines a coarse report-media bucket access rule. Presigned upload is in place (CRIS-17, ADR-0035): the `createMediaUploadUrl` mutation mints a short-lived upload POST — with size and content-type enforced by the signed policy — keyed by `clientRequestId`, and both clients upload before `submitReport` and pass the resulting `mediaKeys`. No client holds direct bucket write. Read is group-scoped to `RESPONDER`/`COORDINATOR`/`ADMIN`; volunteers are excluded pending per-assignment delivery (ADR-0039). Quarantine/AV scanning, per-object ownership, signed delivery, and a lifecycle rule for unclaimed objects are still deferred.                                                                                                                                                                                                                             |
| Map                                  | `apps/web/src/surfaces/map` provides a lazy-loaded MapLibre base map using `VITE_MAP_STYLE_URL` or public demo tiles. Amazon Location map tiles and incident markers/clustering are not wired; backend Places geocoding is tracked separately above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Shared domain vocabulary             | `packages/shared` provides statuses, roles, bands, categories, classification/scoring, authentication rules, and report-form validation used across clients and backend.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| CI/CD                                | `ci.yml` runs formatting, lint, typecheck, build, and available workspace tests. After successful `main` CI, `deploy.yml` can run `ampx pipeline-deploy` through OIDC when `AWS_DEPLOY_ENABLED=true`; source control does not reveal whether it is enabled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Observability                        | AppSync and five Lambdas (`submitReport`, `updateReportStatus`, `publishReportUpdate`, `classify-report`, and `createMediaUploadUrl`) have X-Ray tracing; CloudWatch alarms, an SLA dashboard, structured logs, and an ops SNS topic are defined. The `listVolunteerTasks` resolver and Cognito role-assignment trigger are not yet traced. Publish invocation/error metrics are active, but end-to-end subscription propagation cannot be measured until subscriptions are connected.                                                                                                                                                                                                                                                                                                                                                                                                                      |

CRIS-25's customer-managed key currently covers the triage queues and operations topic only.
DynamoDB reports and S3 media retain their existing service-managed encryption, and
application-layer reporter-contact encryption remains deferred. KMS data-key events are auditable,
but they are not a per-record access log because AWS services reuse data keys (ADR-0043).

## 5. Deferred to later phases (design doc §1.2, §4)

Phase 2: Verification Agent + Dispatch Agent, ChatOps (Slack/Teams), OpenSearch, SageMaker
Geospatial satellite verification. Future: CV damage assessment, evacuation routing,
cross-agency identity federation, active-active multi-region writes.
