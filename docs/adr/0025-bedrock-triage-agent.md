# ADR-0025: Bedrock Triage Agent (tool-using classifier)

- **Status:** Accepted
- **Date:** 2026-07-22
- **Deciders:** Team (CRIS-20)

## Context

CRIS-20 delivers the **Triage Agent [MVP]** of design doc §5.5. The async pipeline (CRIS-10,
ADR-0013) already claims a `NEW` report and calls Bedrock under the versioned JSON contract
(CRIS-11, ADR-0010), scoring deterministically and landing failures in `NEEDS_VERIFICATION`
(never lost, §5.4.4). §5.5 asks for the next step on that same backbone: replace the single
Bedrock call with a **tool-using agent** that runs _inside_ the classify worker, extracts the
structured category, urgency, **entities**, and summary (§2.2), and **calls an Amazon Location
geocoding tool when coordinates are missing** — "while keeping the exact same validation,
idempotency, and failure contract."

The design fixes two guardrails that make an agent safe to adopt (§5.5): the **deterministic
priority score remains the ranking authority** (agents propose; scoring and the
human-in-the-loop dispose), and the agent **degrades to the MVP single-call classifier if agent
orchestration is unavailable**. Open Question #4 explicitly asks whether a fallback classifier
is needed on day one — the answer here is yes, wired as a graceful degradation.

Amazon Location geocoding itself is **CRIS-21**. So CRIS-20 owns the agent's tool-use machinery
and the geocoding _seam_; CRIS-21 fills that seam with the real place-index lookup.

## Options considered

- **Structured output for the final answer: `output_config.format` vs a "final-answer" tool.**
  The single call (CRIS-10) uses `output_config.format` (structured outputs). That doesn't
  compose cleanly with a tool-use loop — an intermediate `geocode_location` call and a
  schema-constrained final message pull in different directions. We use the **`submit_triage`
  tool pattern**: the agent emits its final triage by calling a tool whose `input_schema` is the
  contract (`TRIAGE_TOOL_INPUT_SCHEMA`), which composes naturally with the geocode tool.
- **`tool_choice`: `auto` vs `any`.** `any` forces a tool call every turn, eliminating prose
  rambling and keeping the loop deterministic; the agent must pick `geocode_location` or
  `submit_triage`. Bounded by `MAX_TURNS`.
- **Where geocoding lives.** Folding geocoding into the agent (a tool the model decides to call)
  is what §5.5 specifies and what makes it "an agent" rather than a second single call. The
  worker's old standalone `geocode()` stub is removed; location now flows out of the agent.
- **Trusting model-echoed coordinates vs the tool's return value.** The model decides _when_ to
  geocode and _with what query_; the **coordinates come from the tool's actual return value**,
  captured by the orchestrator out-of-band — never re-transcribed by the model. A hallucinated
  lat/long cannot reach the map.
- **Determinism knob.** `temperature`/`top_p`/`top_k` are rejected by the current Claude models
  (ADR-0013), and `effort` is unsupported on the Haiku triage tier. Determinism therefore comes
  from the strict tool schema + app-side re-validation (`parseClassification`), not a sampling
  parameter.
- **New Bedrock SDK (Mantle) vs reuse InvokeModel.** We stay on `@aws-sdk/client-bedrock-runtime`
  `InvokeModel` with the Anthropic Messages API body — the exact transport CRIS-10 established —
  so IAM (the `claude-*` inference-profile grant, ADR-0017), region topology, and wiring are
  unchanged. Tool use is the same `bedrock:InvokeModel` action.

## Decision

1. **Tool-using Triage Agent** (`amplify/functions/classify-report/agent.ts`). A bounded tool-use
   loop over Bedrock `InvokeModel` with two tools:
   - `geocode_location(query)` — the agent calls it when the report names a place but gives no
     coordinates; it delegates to an injected `Geocoder` (`geocode.ts`).
   - `submit_triage(...)` — the agent calls it once to emit the final triage; its `input_schema`
     is `TRIAGE_TOOL_INPUT_SCHEMA` (the CRIS-11 contract + `entities`).
     `tool_choice: {type: 'any'}`, `MAX_TURNS = 4`, no `temperature`/`effort`.
2. **Same validation/idempotency/failure contract.** The `submit_triage` input is re-validated
   with `parseClassification` (defense in depth). Invalid output gets **exactly one repair
   attempt**, then a `ClassificationError` propagates and the worker routes the report to
   `NEEDS_VERIFICATION` (§5.4.1/§5.4.4). Claim/idempotency/version control flow is unchanged
   from CRIS-10 — the worker just consumes a `TriageAgent` instead of a `Classifier`.
3. **Authoritative location.** The orchestrator captures the `geocode_location` tool's real
   return value and returns it as `TriageResult.location`; the worker persists it. A geocode
   failure is non-fatal — the agent proceeds unlocated.
4. **Entities (contract v2).** `ClassificationResult` gains `entities` (`peopleAffected`,
   `infrastructure`, `hazards`) per §2.2. Parsed **leniently** (`parseEntities` never throws —
   entities are enrichment, not a safety-critical field) and persisted on `Report.entities`.
   They are **coordinator-internal** (design doc Fig 2) and intentionally **not** projected to
   `PublicReport`, and they do **not** feed the deterministic score — scoring changes are
   CRIS-30's decision, so `SCORE_VERSION` is unchanged.
5. **Graceful degradation (§5.5).** `createTriageAgent` wraps the tool-using agent: a
   `TriageOrchestrationError` (Bedrock error, malformed tool-use response, or the loop not
   converging) falls back to the MVP single-call classifier (CRIS-10, `bedrock.ts`); a
   `ClassificationError` (contract-invalid output after repair) is _not_ an orchestration failure
   and routes to `NEEDS_VERIFICATION`. Either way the report is never lost.
6. **Geocoding boundary.** CRIS-20 ships the `Geocoder` seam + `createNullGeocoder` (honours
   `GEOCODING_ENABLED=false`: the tool is offered but every lookup returns "unavailable").
   **CRIS-21** adds `createAmazonLocationGeocoder` + geohash derivation and flips the flag — a
   drop-in with no change to the agent or IAM.

## Tradeoffs & consequences

- **Gain:** the §5.5 agent on the same resilient backbone; entity extraction for the
  coordinator incident-detail view (Fig 2); a clean CRIS-21 insertion point; and the design's
  safety guarantees intact — deterministic score stays authoritative, failures stay bounded and
  never lost, coordinates come from the tool not the model.
- **Give up / risks to watch:**
  - **Cost/latency:** the agent can make up to `MAX_TURNS` Bedrock calls (geocode + submit +
    repair) vs one. Bounded, and the 60 s Lambda timeout has headroom over the §3.2 p95 < 15 s
    target — but per-report token/cost rises (Open Question #4). Revisit if the Haiku tier's
    cost/latency budget tightens; `BEDROCK_MODEL_ID` stays swappable with no IAM change.
  - **Fallback effort caveat:** the single-call fallback (`bedrock.ts`, CRIS-10) still passes
    `output_config.effort: 'low'`, which the Haiku tier rejects. That is a pre-existing CRIS-10
    concern left untouched here; if the fallback path errors, the report still lands
    `NEEDS_VERIFICATION` (never lost), so the safety guarantee holds. Worth a follow-up to align
    the fallback's determinism knob with this ADR.
  - **Entities are model-derived and untrusted** — display/triage metadata only, never a routing
    authority; length/count-capped (bloat defense) and PII-free by prompt instruction, but treat
    as untrusted before display like `summary`/`rationale`.
  - **Contract-version bump (1 → 2):** reports classified before/after carry different
    `contractVersion`; reprocessing logic (if added later) must tolerate both.
  - **Real-time fan-out, dedupe, SNS alerts** remain the same downstream seams as CRIS-10
    (`publishReportUpdate` CRIS-19, dedupe, alerts) — unchanged by this ADR.
