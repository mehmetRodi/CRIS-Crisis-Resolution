# ADR-0007: Async classification pipeline (Streams → Pipe → SQS → Lambda)

- **Status:** Accepted
- **Date:** 2026-07-08
- **Deciders:** Team (CRIS-10)

## Context

CRIS-10 builds the asynchronous AI-triage backbone (design doc §3, §5.4): a report
written to DynamoDB as `NEW` must be picked up off the write path, classified by Bedrock,
scored, geocoded, deduped, and written back — keeping submission fast (p95 < 800 ms) and
never losing a report if Bedrock/geocoding/SNS is degraded (§5.4.4). It is built on Amplify
Gen 2 + CDK escape hatches (ADR-0003) and consumes the data model from ADR-0006. This ADR
also absorbs the **classification JSON contract** (originally CRIS-11) into CRIS-10 per the
implementation decision to ship a real Bedrock call rather than a stub.

Scoring (the deterministic §5.4.2 formula), the `publishReportUpdate` notify mutation
(CRIS-9), Amazon Location geocoding (CRIS-13), duplicate detection, and SNS alerts remain
out of scope — wired as clearly-marked seams.

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
   input transformer ships **only** `{reportId, version, streamEventId}` — `rawText` and
   `reporter*` never enter the queue (§5.6). The worker re-reads the full item under IAM.
3. **Direct-to-DynamoDB durable write** (§5.3). IAM via `grantReadWriteData`/`grantWriteData`
   on the Amplify tables (`backend.ts`); table names passed as env vars. This **refines
   ADR-0006 item 6**, which anticipated `allow.resource(...)` writes — that mechanism is
   schema-level (not per-model) and is reserved for the CRIS-9 `publishReportUpdate` AppSync
   mutation, so `data/resource.ts` is unchanged by CRIS-10.
4. **Idempotency & optimistic locking.** Claim `NEW → PROCESSING` via a version conditional
   write; result/`NEEDS_VERIFICATION` writes are conditional on the claimed version;
   duplicate stream events short-circuit on `lastProcessedEventId`; `IdempotencyRecord` gets a
   DynamoDB TTL on `expiresAt`.
5. **Failure handling.** A Bedrock/geocode failure lands the report in `NEEDS_VERIFICATION`
   and the message is deleted (a *handled* outcome, §5.4.4) — the DLQ catches only true poison
   (unparseable message / repeated infra crash), which retries and propagates.
6. **Classification JSON contract in `@crisismap/shared`** (`classification.ts`): a
   dependency-free `validateClassification` + `CLASSIFICATION_JSON_SCHEMA`, single source of
   truth shared by the worker and UI. Bedrock is called with structured outputs
   (`output_config.format` = the schema) + `effort: 'low'`, **no `temperature`**; invalid
   output gets one repair attempt, then `NEEDS_VERIFICATION`. App-side enum validation runs
   even with structured outputs (defense in depth — model output is untrusted).
7. **Model id** defaults to `anthropic.claude-opus-4-8`, configurable via the
   `BEDROCK_MODEL_ID` env var. Bedrock IAM is scoped to the `anthropic.claude-*`
   foundation-model family in-region (no cross-provider access) so switching Claude tiers
   needs no IAM change.

## Tradeoffs & consequences

- **Gain:** a resilient, decoupled pipeline that meets the latency/scale/never-lost goals;
  a strict no-PII-in-queue boundary; a reusable, tested classification contract; a durable
  write path that survives AppSync outages.
- **Give up / risks to watch:**
  - **Dual-write drift** (`Report` ↔ `PublicReport`) — the accepted MVP risk from ADR-0006;
    mitigated by the worker's conditional, idempotent write-back.
  - **Provisional scoring:** CRIS-10 ships an urgency-only placeholder (`scoreVersion: 0`);
    the deterministic §5.4.2 formula + `scoreBreakdown` is CRIS-11.
  - **Seams:** geocoding (CRIS-13), duplicate detection, the `publishReportUpdate` notify
    mutation (CRIS-9), and SNS alerts are stubs/TODOs — until CRIS-9 lands, the pipe's
    `status = NEW` filter is fed by hand in the smoke test.
  - **Model cost/latency:** `claude-opus-4-8` is the most capable but not the cheapest tier
    for a 1,000-writes/min classifier; the team may evaluate a Sonnet/Haiku tier via
    `BEDROCK_MODEL_ID` (no IAM change needed) — that would be a follow-up ADR if adopted.
  - **Deploy note:** enabling a stream changes the Amplify table's custom-resource update
    path — deploy on a fresh `ampx sandbox` first to avoid a stream-ARN churn that would
    orphan the pipe source. Bedrock model access is account/region-gated (opt-in).
