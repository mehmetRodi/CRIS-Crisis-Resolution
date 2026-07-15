# CrisisMap AI — Architecture Overview

A living companion to the design document (`crisismap.pdf`). The PDF is the authoritative
narrative; this file is the quick, code-adjacent reference and is updated as the system
evolves. Decisions are recorded in [`adr/`](adr/).

## 1. System shape (design doc §3)

CrisisMap AI is a **serverless AWS application**. Clients talk to a single AppSync GraphQL
API backed by DynamoDB. Expensive AI work is pushed onto an asynchronous queue so the write
path stays fast and resilient.

```
        ┌──────────────────────────┐
        │  React / Amplify client  │  Citizen · Volunteer · Responder · Coordinator
        └────────────┬─────────────┘
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

### Flow (design doc §3, Fig 9)

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

## 3. Key design guarantees (design doc §1.1, §3.2)

- A report is **never lost** once acknowledged, even if AI/geocoding/notifications are down
  (bounded retries, DLQs, defined terminal states; a Bedrock failure ⇒ `NEEDS_VERIFICATION`).
- Submission stays fast (p95 < 800 ms) — AI runs asynchronously.
- Coordinators get a single, de-duplicated, priority-ordered view (p95 < 2 s propagation).
- Public users see only **redacted** data; reporter identity/contact is protected.
- Priority is a **deterministic, explainable** score in [0, 10] mapped to bands P0–P3 — never
  raw model output.

## 4. How the current scaffold maps to the target

| Target component                     | Scaffold status                                                                                                                                                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React SPA client                     | `apps/web` — placeholder landing + coordinator dashboard shell (CRIS-12 ✓, ADR-0020); citizen/map surfaces per CRIS-6/13. Router-free surface switch until CRIS-7 routing/auth                                             |
| Cognito auth                         | `apps/web/amplify/auth` — stub, 5 groups (CRIS-7 for anonymous/roles)                                                                                                                                                      |
| AppSync + DynamoDB                   | `apps/web/amplify/data` — MVP model: 11 entities, 6 GSIs (CRIS-8)                                                                                                                                                          |
| Write path (`submitReport`)          | `amplify/functions/submit-report` — durable NEW + idempotency (CRIS-9)                                                                                                                                                     |
| State machine mutations              | `amplify/functions/transition-report` — guarded transitions (CRIS-18)                                                                                                                                                      |
| Public projection + real-time        | `PublicReport` + `publishReportUpdate` + subscriptions (CRIS-19)                                                                                                                                                           |
| AI classification contract + scoring | `packages/shared/src/classification.ts` — versioned JSON contract + deterministic [0,10] scoring & `ScoreBreakdown` (CRIS-11 ✓, ADR-0010)                                                                                  |
| Streams→SQS→Lambda→Bedrock           | `amplify/functions/classify-report` — Streams→Pipe→SQS(+DLQ)→Lambda + real Bedrock classification & scoring (CRIS-10 ✓, ADR-0013). Seams: `publishReportUpdate` fan-out (CRIS-19), geocoding (CRIS-13), dedupe, SNS alerts |
| S3 media                             | `apps/web/amplify/storage` — stub bucket                                                                                                                                                                                   |
| MapLibre + Amazon Location           | not built — CRIS-13                                                                                                                                                                                                        |
| Shared domain vocabulary             | `packages/shared` — statuses, roles, bands, categories + verification/assignment/alert/audit enums (CRIS-8)                                                                                                                |
| CI                                   | `.github/workflows/ci.yml` — format/lint/typecheck/build/test; `deploy.yml` = `ampx pipeline-deploy` via OIDC, dormant until AWS wired (CRIS-14 ✓/CRIS-15, ADR-0016; setup in `docs/runbooks/deploy.md`)                   |
| Observability (CloudWatch/X-Ray)     | wired (CRIS-15 ✓, ADR-0015): X-Ray active on AppSync + all Lambdas; `amplify/observability.ts` — CloudWatch alarms (DLQ/queue-age/errors/throttles) + SLA dashboard + ops SNS topic; structured JSON logs in handlers      |

## 5. Deferred to later phases (design doc §1.2, §4)

Phase 2: Verification Agent + Dispatch Agent, ChatOps (Slack/Teams), OpenSearch, SageMaker
Geospatial satellite verification. Future: CV damage assessment, evacuation routing,
cross-agency identity federation, active-active multi-region writes.
