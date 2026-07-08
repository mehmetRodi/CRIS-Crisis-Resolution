# ADR-0007: AI classification contract & deterministic priority scoring

- **Status:** Accepted
- **Date:** 2026-07-08
- **Deciders:** Team (CRIS-11)

## Context

CRIS-11 defines the boundary between the AI triage worker and the rest of the system, and
the rule that turns a classification into a rank on the coordinator's map. Two things had to
be pinned down before the async pipeline (CRIS-10) can be built:

1. **What the model returns** — the Bedrock triage worker runs Claude over untrusted,
   free-text citizen reports (§2.2, §5.6). The rest of the system needs a fixed, versioned
   shape it can validate and persist. An unconstrained or hallucinated response must never
   silently corrupt a report.
2. **How priority is computed** — the design mandates that priority is a **deterministic,
   explainable** score in [0, 10] mapped to bands P0–P3, and is **never the raw model output**
   (§5.4.2, architecture.md §3). Coordinators must be able to see *why* a report ranks where
   it does, and the same inputs must always produce the same score.

Both live in `@crisismap/shared` (`packages/shared/src/classification.ts`) so the frontend,
the Amplify schema, and the CRIS-10 Lambda workers share one definition — the same pattern
ADR-0004 established for the domain enums. The pipeline wiring, the Bedrock call itself, the
prompt, and the geocoding of `locationHint` are owned by CRIS-10; this ADR covers only the
contract and the scoring math.

## Options considered

- **Where the classification schema lives.** Inline it in the Lambda (fast, but the frontend
  and schema can't share it and it drifts from the enums) vs. a shared, versioned module that
  is both a JSON Schema for Claude structured output *and* a runtime validator. Chose the
  shared module: one source of truth, and the JSON Schema derives its `category`/`urgency`
  enums from `@crisismap/shared` so the model literally cannot emit an unknown value.
- **Trusting vs. validating the model output.** Persist the model JSON as-is (simple, but a
  bad field poisons the record and the map) vs. validate every field and reject on any
  violation. Chose strict validation via `parseClassification`, which throws
  `ClassificationContractError`; CRIS-10 catches it and routes the report to
  `NEEDS_VERIFICATION` — consistent with the "Bedrock failure ⇒ NEEDS_VERIFICATION"
  resilience rule (architecture.md §3).
- **Model-driven vs. deterministic priority.** Let Claude emit a priority number directly
  (one fewer step, but non-reproducible, unexplainable, and gameable by report text) vs. take
  only `category`/`urgency`/confidence from the model and compute the score in code. Chose the
  deterministic formula — it is the design's explicit requirement (§5.4.2).
- **Scoring shape.** A single opaque weighted number vs. an additive breakdown where each
  factor is expressed in final score-points and the terms sum (pre-clamp) to the score. Chose
  additive-and-explainable: the returned `ScoreBreakdown` is exactly the embedded
  `ScoreBreakdown` custom type on `Report` (CRIS-8), so the UI renders the "why" with no
  transformation.
- **Confidence handling.** Fold confidence into the score (low confidence would depress rank,
  conflating "not urgent" with "not sure") vs. keep it out of the score and use it only as a
  human-review gate. Chose the gate: `shouldEscalateToVerification` escalates when confidence
  is below `CLASSIFICATION_CONFIDENCE_THRESHOLD` or the model flags `needsHumanReview` (§2.6).

## Decision

1. **Versioned contract.** `CLASSIFICATION_CONTRACT_VERSION` and `SCORE_VERSION` are persisted
   (`Report.scoreVersion` already exists) so records are traceable and reprocessable across
   changes. Bump on any breaking change to the shape, weights, curves, or band cutoffs.
2. **`ClassificationResult`** — `category`, `urgency`, `confidence` (0–1), `locationHint`
   (free-text, nullable, **not** geocoded here), `summary`, `rationale`, `needsHumanReview`.
   No reporter identity/contact ever appears (§5.6); model-derived text is treated as
   untrusted and length-capped.
3. **`CLASSIFICATION_JSON_SCHEMA`** — strict JSON Schema (`additionalProperties: false`, all
   fields required, enums from `@crisismap/shared`), usable directly as a Claude
   `output_config.format` / tool `input_schema`. **`parseClassification`** validates a raw
   response and throws `ClassificationContractError` on any violation; `contractVersion` is
   stamped by us, not trusted from the model.
4. **`scoreReport`** — pure function computing
   `clamp(urgency + category + recency + corroboration + manualAdjustment, 0, 10)`, where each
   term is independently bounded:
   - urgency: CRITICAL 5 / HIGH 3.5 / MEDIUM 2 / LOW 0.8 (`URGENCY_MAX_POINTS = 5`) — dominant term;
   - category: per-category weight in [0, 1] × `CATEGORY_MAX_POINTS` (3), life-threat categories highest;
   - recency: exponential decay, `RECENCY_MAX_POINTS` (1.5), `RECENCY_HALF_LIFE_MINUTES` (45);
   - corroboration: saturating in the number of corroborating reports + confirmed
     verifications, `CORROBORATION_MAX_POINTS` (2), `CORROBORATION_HALF_SATURATION` (2);
   - manual: coordinator delta, clamped to ±`MANUAL_ADJUSTMENT_LIMIT` (3).
   All weights are exported named constants. The result carries the `ScoreBreakdown` and the
   band via `priorityBandForScore` (the authoritative cutoffs, kept in `domain.ts`).
5. **Band cutoffs finalized** in `domain.ts` (P0 ≥ 8, P1 ≥ 6, P2 ≥ 3, else P3) — no longer
   TENTATIVE; a change bumps `SCORE_VERSION`.
6. **Sync guard.** `ScoreBreakdown` is duplicated in the Amplify `data` schema (embedded
   custom type); the "score breakdown sync guard" test pins the factor names so the two can't
   drift — same discipline as the enum sync guard (ADR-0006).

## Tradeoffs & consequences

- **Gain:** one shared, versioned contract that constrains the model at generation time *and*
  validates at ingest; a reproducible, auditable, explainable score whose breakdown maps 1:1
  to the stored `ScoreBreakdown`; confidence cleanly separated from priority; safety-critical
  logic is pure and fully unit-tested (conventions.md §Testing).
- **Give up / risks to watch:**
  - **Weights are judgement calls.** The category/urgency/recency/corroboration constants are
    reasonable defaults, not tuned against real incident data. `SCORE_VERSION` exists so they
    can be revised deliberately (a new ADR) once there is data.
  - **Shared defaults vs. `CategoryConfig`.** The per-category weights are duplicated as code
    defaults here and as a runtime-tunable `CategoryConfig.baseWeight` (CRIS-8). CRIS-10 must
    decide precedence (config overrides code) and document it; the code table keeps scoring
    deterministic offline and in tests.
  - **Contract/enum coupling.** The JSON Schema derives its enums from `@crisismap/shared`, so
    an enum change flows through automatically — but a *breaking* contract change still
    requires a `CLASSIFICATION_CONTRACT_VERSION` bump and a reprocessing story (CRIS-10).
  - **`locationHint` is untrusted free text** until CRIS-10 geocodes it; consumers must not
    treat it as a resolved location.
