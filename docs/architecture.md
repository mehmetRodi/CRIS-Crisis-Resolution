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

| Component                            | Current state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React Native citizen app             | `apps/mobile` has optional sign-in, an Expo report form, image selection, and guest/authenticated `submitReport` wiring. Location capture is in place (CRIS-16, ADR-0034): GPS via `expo-location`, plus a MapLibre aim-and-confirm map pin and a free-text location hint. Because MapLibre needs native code, the app now requires a custom Expo dev-client build and no longer runs in Expo Go. Picked photos now upload to S3 via a presigned URL before submission (CRIS-17, ADR-0035).                                                                                                                                                                                                                                                                                                                                                                                                                 |
| React SPA client                     | `apps/web` has landing, sign-in/sign-up/confirmation, `/report`, `/coordinator`, and `/map` routes. The coordinator dashboard renders the priority-ordered incident queue with interactive category/status/region filtering applied client-side over the loaded feed (CRIS-22, ADR-0032); the metrics strip and category distribution stay global. Selecting a row opens the incident-detail interface (CRIS-23, ADR-0033): the classification snapshot, AI summary, extracted entities, the explainable score breakdown, and the incident's audit timeline (a separate `eventsByReport` read via `useIncidentTimeline`), alongside the CRIS-18 transition controls. The `/coordinator` route is gated to the `COORDINATOR`/`ADMIN` groups via `RequireRole` (CRIS-24, ADR-0040).                                                                                                                           |
| Cognito auth                         | `apps/web/amplify/auth` defines email sign-in, five groups, guest Identity Pool access, and a `postConfirmation` trigger that auto-assigns `CITIZEN` to self-signed-up users (CRIS-24, ADR-0040). Staff groups remain admin-assigned; no invite flow exists. `AuthContext` (web) exposes the caller's Cognito groups (`roles`/`highestRole`), read from the ID token.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| AppSync + DynamoDB                   | `apps/web/amplify/data` defines 11 persistent models, six `Report` GSIs, custom mutations, and a `PublicReport` type. `Report`'s model authorization was tightened (CRIS-24, ADR-0040) to drop the blanket `allow.authenticated()` read that exposed reporter PII to any signed-in user; other models remain coarse and generated model operations still coexist with guarded custom mutations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Write path (`submitReport`)          | `amplify/functions/submit-report` performs a durable `NEW` create, audit append, and client-request-id idempotency.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| State transition mutation            | `amplify/functions/transition-report` implements role-checked, version-checked status transitions with audit events. The coordinator dashboard now invokes `updateReportStatus` from the incident-detail panel (client wrapper `lib/transition-report.ts` + `useReportTransition`), offering moves legal for the caller's real Cognito role (`callerRole`, CRIS-24), passing the read `version` as the optimistic lock, and surfacing `CONFLICT` (CRIS-18, ADR-0028, ADR-0040).                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Public projection + real-time        | `PublicReport` is the redacted projection. `publishReportUpdate` is now internal-only — authorized solely to the `classify-report` worker's IAM role via schema-level `allow.resource` (the ADMIN rule is dropped), and the worker calls it (best-effort) after its durable write to fan the redacted update out (CRIS-19, ADR-0009/0029). The AI `summary` is persisted on `Report` and flows through both paths. Custom subscriptions that consume the mutation are still disabled (CRIS-28), so nothing subscribes yet; dashboard data remains a one-shot authenticated `Report.list` read with local redaction.                                                                                                                                                                                                                                                                                         |
| AI classification contract + scoring | `packages/shared/src/classification.ts` contains the versioned v2 triage contract, entity extraction shape, deterministic scoring, and `ScoreBreakdown`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Async Bedrock pipeline               | DynamoDB Stream → EventBridge Pipe → SQS (+ DLQ) → Lambda → Bedrock Triage Agent is wired; both hops now have a dead-letter queue, and the pipe's is deliberately separate because its payloads are stream records, not worker messages (ADR-0038). The worker selects the Amazon Location Places geocoder by default, has the `geo-places:Geocode` grant, and derives geohashes through shared code; the feature flag provides a null-geocoder fallback. Conservative duplicate detection (§5.4.3, ADR-0038) runs after the durable write as a best-effort step: candidates come from the geohash GSI, are scored `Ds = 0.40·L + 0.25·T + 0.20·G + 0.15·E`, and strong matches (≥ 0.80) join a shared `duplicateGroupId` through one atomic `TransactWriteItems` (max 50 members). Group merging, and surfacing the 0.65–0.79 review band beyond CloudWatch, are deferred; so is citizen-alert enqueueing. |
| S3 media                             | `apps/web/amplify/storage` defines a coarse report-media bucket access rule. Presigned upload is in place (CRIS-17, ADR-0035): the `createMediaUploadUrl` mutation mints a short-lived upload POST — with size and content-type enforced by the signed policy — keyed by `clientRequestId`, and both clients upload before `submitReport` and pass the resulting `mediaKeys`. No client holds direct bucket write. Read is group-scoped to `RESPONDER`/`COORDINATOR`/`ADMIN`; volunteers are excluded pending per-assignment delivery (ADR-0039). Quarantine/AV scanning, per-object ownership, signed delivery, and a lifecycle rule for unclaimed objects are still deferred.                                                                                                                                                                                                                             |
| Map                                  | `apps/web/src/surfaces/map` provides a lazy-loaded MapLibre base map using `VITE_MAP_STYLE_URL` or public demo tiles. Amazon Location map tiles and incident markers/clustering are not wired; backend Places geocoding is tracked separately above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Shared domain vocabulary             | `packages/shared` provides statuses, roles, bands, categories, classification/scoring, authentication rules, and report-form validation used across clients and backend.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| CI/CD                                | `ci.yml` runs formatting, lint, typecheck, build, and available workspace tests. After successful `main` CI, `deploy.yml` can run `ampx pipeline-deploy` through OIDC when `AWS_DEPLOY_ENABLED=true`; source control does not reveal whether it is enabled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Observability                        | AppSync and four Lambdas have X-Ray tracing; CloudWatch alarms, an SLA dashboard, structured logs, and an ops SNS topic are defined. Real-time fan-out metrics remain dormant until that path is connected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## 5. Deferred to later phases (design doc §1.2, §4)

Phase 2: Verification Agent + Dispatch Agent, ChatOps (Slack/Teams), OpenSearch, SageMaker
Geospatial satellite verification. Future: CV damage assessment, evacuation routing,
cross-agency identity federation, active-active multi-region writes.
