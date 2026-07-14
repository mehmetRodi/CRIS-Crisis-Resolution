# ADR-0015: Observability — X-Ray tracing + CloudWatch alarms & dashboard

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** Team (CRIS-15)
- **Refines:** ADR-0005 (CI & observability baseline), ADR-0013 (async classification pipeline)

## Context

ADR-0005 shipped CI quality gates and captured observability as a **contract** (structured
JSON logs, planned X-Ray, planned latency/DLQ alarms) because at scaffold time nothing emitted
signals. It explicitly committed us to wiring "the CloudWatch/X-Ray instrumentation when the
backend becomes real (CRIS-14)."

That moment has arrived. The backend now runs four Lambdas — `submit-report`,
`transition-report`, `publish-report-update`, `classify-report` — and the async pipeline from
ADR-0013 (Report stream → EventBridge Pipe → SQS + DLQ → worker). The design doc names
"CloudWatch / X-Ray — Logs, metrics, alarms" as a first-class component (§3.1) and lists
observability as an [MVP] requirement (§4). We need runtime signals tied to the §3.2 SLAs so
regressions page a human instead of surfacing as silent latency or lost reports.

Structured JSON logs already exist in the handlers (one object per line, `reportId` + event
type, no PII — see `classify-report/handler.ts`), satisfying the logging half of the contract.
This ADR covers **tracing** and **metrics/alarms**.

## Options considered

- **X-Ray via the L2 `tracing: ACTIVE` prop vs the CfnFunction escape hatch.** Amplify Gen 2's
  `defineFunction` and `data` constructs don't expose a tracing prop, so there is no L2 path.
  We set `tracingConfig.mode = 'Active'` on each `CfnFunction` and `xrayEnabled` on the AppSync
  `CfnGraphqlApi` via escape hatches (consistent with ADR-0003), and grant the X-Ray write
  actions explicitly — the one thing the L2 prop would have done for us.
- **Where to attach alarms/dashboard.** A dedicated `observability` stack reads cleanly but
  makes the highest-value alarms (DLQ depth, queue age) cross-stack references to the pipeline
  stack's queues. Attaching them to the **existing pipeline stack** keeps the SQS alarms
  in-stack (no `Fn::ImportValue` churn); only the resolver Lambda metrics, which live in the
  data/function stacks, cross-reference — unavoidable and low-risk.
- **Alarm routing.** Alarms → a **dedicated ops SNS topic**, separate from the app's future
  proximity-alert SNS (CRIS-34), so operational noise never mixes with citizen alerts. The
  human/Slack/PagerDuty endpoint is subscribed **post-deploy** (it is environment-specific and
  must not be committed) — documented in the deploy runbook.
- **Thresholds: absolute vs anomaly detection.** Anomaly-detection bands need a traffic
  baseline we don't have yet. We use **absolute thresholds derived from the §3.2 targets**, with
  `treatMissingData: NOT_BREACHING` so an idle queue doesn't page. Revisit once real traffic
  exists.
- **Dashboard naming.** Auto-generated names are opaque hashes; a fixed name collides across
  sandbox branches in one account. We name it `CrisisMap-<stackName>` — greppable and unique
  per environment. Alarms keep CDK auto-names to avoid collisions.

## Decision

1. **X-Ray active tracing** on all four Lambdas (`CfnFunction.tracingConfig = { mode: 'Active' }`)
   and the AppSync API (`cfnGraphqlApi.xrayEnabled = true`), with an inline IAM statement
   granting `xray:PutTraceSegments` / `xray:PutTelemetryRecords` (resource `*` — these actions
   don't support resource scoping). Authored in `backend.ts`.
2. **`apps/web/amplify/observability.ts`** owns the signals: an ops **SNS alarm topic**, the
   alarms, and a **CloudWatch dashboard**, all attached to the pipeline stack via
   `addObservability(...)`.
3. **Alarms, thresholds ↔ §3.2 SLAs** (all `NOT_BREACHING` on missing data; both alarm and OK
   actions notify the topic):
   - **`ClassificationDlqNotEmpty`** — DLQ visible ≥ 1 (poison message exhausted retries;
     "never-lost", §5.4.4). Pages on a single message.
   - **`ClassificationBacklogAge`** — classification queue oldest-message age > 30 s for 3 min
     (2× headroom over the classification **p95 < 15 s** target).
   - **`ClassifyWorkerErrors` / `ClassifyWorkerThrottles`** — worker _unhandled_ errors (handled
     Bedrock/parse failures route to `NEEDS_VERIFICATION` and don't count) / concurrency
     throttling against the 1,000 writes/min target.
   - **`SubmitReportErrors` / `TransitionReportErrors` / `PublishReportUpdateErrors`** — resolver
     errors, guarding the **99.9% availability** and the submission (p95 < 800 ms) / real-time
     (p95 < 2 s) paths.
4. **Dashboard** `CrisisMap-<stackName>` — one screen: submission (invocations/errors + p95 vs
   the 800 ms line), classification pipeline (backlog + DLQ + oldest-age vs the 15 s line), the
   AI worker, and resolver health (with an error-% math expression).

## Tradeoffs & consequences

- **Gain:** runtime signals tied to every §3.2 SLA; poison messages and pipeline backlog page a
  human; end-to-end traces across AppSync → Lambda for latency debugging; a single SLA dashboard.
- **Give up / watch:**
  - **No alert endpoint in code.** The SNS topic has no subscription until an operator adds one
    post-deploy (runbook) — alarms fire into a topic no one hears until then. Deliberate: the
    endpoint is environment-specific and must not be committed.
  - **Absolute thresholds are first-guesses.** With no production traffic baseline, the age /
    error thresholds may be noisy or too lax; tune once real load exists (a follow-up, not a
    contract change).
  - **X-Ray adds per-invocation cost/latency** (sampled) — acceptable at MVP volume.
  - **Commits us to** subscribing the ops topic in every real environment, and to extending the
    dashboard/alarms as the deferred seams land (geocoding CRIS-13/21, real-time fan-out CRIS-19,
    SNS proximity alerts CRIS-34). The full incident runbook is CRIS-35; `docs/runbooks/deploy.md`
    carries the alarm-response baseline.
