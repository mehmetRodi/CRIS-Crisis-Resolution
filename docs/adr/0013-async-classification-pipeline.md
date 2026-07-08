# ADR-0013: Async classification pipeline (Streams → Pipe → SQS → Lambda)

- **Status:** Accepted
- **Date:** 2026-07-08
- **Deciders:** Team (CRIS-10)

## Context

CRIS-10 builds the asynchronous AI-triage backbone (design doc §3, §5.4): a report
written to DynamoDB as `NEW` must be picked up off the write path, classified by Bedrock,
scored, geocoded, deduped, and written back — keeping submission fast (p95 < 800 ms) and
never losing a report if Bedrock/geocoding/SNS is degraded (§5.4.4). It is built on Amplify
Gen 2 + CDK escape hatches (ADR-0003), writes to the CRIS-8 data model (ADR-0006), and
**consumes** the versioned classification JSON contract and deterministic scoring formula
from ADR-0010 (CRIS-11) rather than redefining them — this ADR wires those into a running
Bedrock pipeline. Reports reach the pipeline via the `submitReport` write path (ADR-0007).

The `publishReportUpdate` notify mutation (CRIS-19), Amazon Location geocoding (CRIS-13),
duplicate detection, and SNS alerts remain out of scope — wired as clearly-marked seams. The
deterministic §5.4.2 score is authoritative and applied here via ADR-0010's `scoreReport`.

## Options considered

- **Stream → EventBridge Pipe → SQS → Lambda** vs **Lambda event-source-mapping directly on
  the stream.** A direct stream ESM is simpler but caps concurrency (2 readers/shard),
  couples classification throughput to shard count, and gives only weak retry/on-failure
  semantics. The Pipe+SQS path (named in the design doc's stack as "SQS + DynamoDB Streams /
  EventBridge Pipes") decouples fast writes from Bedrock quota, scales Lambda independently
  to hit 1,000 writes/min at p95 < 15 s, and gives a real DLQ with `maxReceiveCount`.
- **Standard vs FIFO SQS.** Reports are independent and idempotency is enforced in-app, so
  FIFO's ordering/throughput cost buys nothing. Standard.
- **Worker write path: direct DynamoDB vs AppSync mutations.** Design doc §5.3 is explicit —
  the worker writes to DynamoDB **directly** (durable write independent of AppSync
  availability), then calls an IAM-only `publishReportUpdate` mutation purely to fan out to
  subscribers. This also sidesteps a scaffold reality: calling AppSync from the Lambda needs
  the generated data client + `$amplify/env`, which don't exist until `ampx` runs.
- **Determinism knob for the JSON contract.** The design doc says "low-temperature", but the
  current Claude models **reject `temperature`/`top_p`/`top_k` (400)**. Structured outputs +
  `effort: 'low'` deliver deterministic, schema-valid JSON without them.
- **Model choice.** A high-throughput classifier argues for a cheaper/faster tier, but the
  house default is the most capable model.

## Decision

1. **Streams → `CfnPipe` (L1) → SQS (+ redrive DLQ) → `classify-report` Lambda.** Standard
   queue; DLQ `maxReceiveCount: 3`; visibility 360 s (6× the 60 s Lambda). ESM `batchSize: 5`
   with `reportBatchItemFailures` for partial-batch failure. All authored as CDK on the
   Amplify backend in `backend.ts`.
2. **Pipe filter + input transformer.** Filter to `eventName = INSERT` and `status = NEW`; the
   input transformer ships **only** `{reportId, version, streamEventId}` — the report `text`
   and `reporter*` fields never enter the queue (§5.6). The worker re-reads the full item
   under IAM.
3. **Direct-to-DynamoDB durable write** (§5.3). IAM via `grantReadWriteData`/`grantWriteData`
   on the Amplify tables (`backend.ts`); table names passed as env vars. This **refines
   ADR-0006 item 6**, which anticipated `allow.resource(...)` writes — that mechanism is
   schema-level (not per-model) and is reserved for the CRIS-19 `publishReportUpdate` AppSync
   mutation, so `data/resource.ts` is unchanged by CRIS-10. The worker writes the `Report` and
   its audit `ReportEvent`; there is no separate `PublicReport` table (it is a customType
   returned by `publishReportUpdate`), so the redacted fan-out is the CRIS-19 seam, not a table
   mirror.
4. **Idempotency & optimistic locking.** Claim `NEW → PROCESSING` via a version conditional
   write; result/`NEEDS_VERIFICATION` writes are conditional on the claimed version;
   duplicate stream events short-circuit on `lastProcessedEventId`; `IdempotencyRecord` gets a
   DynamoDB TTL on `expiresAt`.
5. **Failure handling.** A Bedrock/parse failure lands the report in `NEEDS_VERIFICATION`
   and the message is deleted (a _handled_ outcome, §5.4.4) — the DLQ catches only true poison
   (unparseable message / repeated infra crash), which retries and propagates.
6. **Consume ADR-0010's contract + scoring** from `@crisismap/shared` (`classification.ts`):
   Bedrock is called with structured outputs (`output_config.format` = `CLASSIFICATION_JSON_SCHEMA`)
   and `effort: 'low'`, **no `temperature`**; the response is re-validated app-side with
   `parseClassification` (defense in depth — model output is untrusted), and invalid output
   gets one repair attempt, then `NEEDS_VERIFICATION`. The worker computes priority with the
   deterministic `scoreReport` (persisting `priorityScore`/`priorityBand`/`scoreVersion` +
   `scoreBreakdown`). A valid but low-confidence or model-flagged (`needsHumanReview`)
   classification is still recorded, but the report is routed to `NEEDS_VERIFICATION` (§2.6)
   via `shouldEscalateToVerification` rather than surfacing as `AI_CLASSIFIED`.
7. **Model id** defaults to `anthropic.claude-opus-4-8`, configurable via the
   `BEDROCK_MODEL_ID` env var. Bedrock IAM is scoped to the `anthropic.claude-*`
   foundation-model family in-region (no cross-provider access) so switching Claude tiers
   needs no IAM change.

## Tradeoffs & consequences

- **Gain:** a resilient, decoupled pipeline that meets the latency/scale/never-lost goals;
  a strict no-PII-in-queue boundary; a durable write path that survives AppSync outages; and
  a single, tested classification+scoring contract shared with the resolvers and UI (ADR-0010).
- **Give up / risks to watch:**
  - **Scoring inputs:** the worker feeds `scoreReport` only `urgency` + `category` today;
    recency, corroboration, and manual-adjustment inputs (already modelled by the formula) are
    wired as the report accrues signals — a follow-up, not a contract change (`scoreVersion`
    tracks the formula).
  - **Real-time fan-out is a seam:** the worker's durable write is complete, but subscribers
    are not updated until the CRIS-19 `publishReportUpdate` call is wired (calling AppSync from
    the Lambda needs the generated data client + `$amplify/env`, which exist only after `ampx`).
    Geocoding (CRIS-13), duplicate detection, and SNS alerts are likewise stubs/TODOs. Reports
    now reach the `status = NEW` filter via the deployed `submitReport` write path (ADR-0007).
  - **Model cost/latency:** `claude-opus-4-8` is the most capable but not the cheapest tier
    for a 1,000-writes/min classifier; the team may evaluate a Sonnet/Haiku tier via
    `BEDROCK_MODEL_ID` (no IAM change needed) — that would be a follow-up ADR if adopted.
  - **Deploy note:** enabling a stream changes the Amplify table's custom-resource update
    path — deploy on a fresh `ampx sandbox` first to avoid a stream-ARN churn that would
    orphan the pipe source. Bedrock model access is account/region-gated (opt-in).
