/**
 * CRIS — AI triage contract & deterministic priority scoring (CRIS-11/30).
 *
 * This module is the single source of truth for two things the async pipeline
 * (CRIS-10) depends on:
 *
 *   1. The **classification JSON contract** (§2.2) — the exact, versioned shape
 *      the Bedrock triage worker (Claude) must return. It doubles as a JSON
 *      Schema for structured output / tool-use so the model is constrained to
 *      valid enum values, and as a runtime validator so a malformed/hallucinated
 *      response is rejected (routing the report to NEEDS_VERIFICATION) rather
 *      than silently corrupting data.
 *
 *   2. The **deterministic scoring formula** (§5.4.2) — priority is a
 *      deterministic, explainable score in [0, 10] mapped to bands P0–P3, NEVER
 *      the raw model output. The model supplies `category`/`urgency`/signals;
 *      this formula turns those into a reproducible score plus a `ScoreBreakdown`
 *      so the UI can show *why* a report ranks where it does.
 *
 * SECURITY (§5.4.1, §5.6): the contract carries only classification metadata —
 * never reporter identity/contact. Raw report text is UNTRUSTED input to the
 * prompt; `summary`/`rationale`/`locationHint` are model-derived and must be
 * treated as untrusted (and PII-free) before display.
 *
 * SCORE-BREAKDOWN SYNC: `ScoreBreakdown` mirrors the `ScoreBreakdown` custom type
 * in `apps/web/amplify/data/resource.ts`. If you add/rename a factor, update BOTH
 * (the "score breakdown sync guard" test in classification.test.ts fails on drift).
 */

import { Category, PriorityBand, priorityBandForScore, Urgency } from './domain';

/* -------------------------------------------------------------------------- */
/* Contract & scoring versions                                                */
/* -------------------------------------------------------------------------- */

/**
 * Version of the classification JSON contract. Persisted on the report so a
 * later contract change is detectable and reprocessable. Bump on any
 * breaking change to `ClassificationResult` / `CLASSIFICATION_JSON_SCHEMA`.
 *
 * v2 (CRIS-20): the Bedrock Triage Agent adds an `entities` object (§2.2) —
 * people affected + infrastructure/hazards extracted from the report. The
 * single-call classifier (CRIS-10) still emits v1 fields; `parseClassification`
 * defaults `entities` to empty for those, so both producers are contract-valid.
 */
export const CLASSIFICATION_CONTRACT_VERSION = 2;

/**
 * Version of the deterministic scoring formula (weights + band cutoffs).
 * Written to `Report.scoreVersion` so scores computed under different formula
 * versions are comparable/recomputable. Bump on any change to the weights,
 * curves, or band cutoffs below.
 */
export const SCORE_VERSION = 2;

/* -------------------------------------------------------------------------- */
/* 1. Classification JSON contract (§2.2)                                     */
/* -------------------------------------------------------------------------- */

/**
 * The structured result the Bedrock triage worker returns for one report.
 * This is the contract boundary between the AI worker (CRIS-10) and the rest
 * of the system — it is validated with {@link parseClassification} before any
 * field is trusted.
 */
export interface ClassificationResult {
  /** Contract version the producer wrote against. */
  contractVersion: number;
  /** Incident category (drives category weight + map icon). */
  category: Category;
  /** Assessed urgency (drives the dominant scoring term). */
  urgency: Urgency;
  /** Model self-reported confidence in [0, 1]. Low → human review. */
  confidence: number;
  /**
   * Free-text location description extracted from the report (e.g.
   * "near the north bridge on Route 9"). NOT itself coordinates — the Triage
   * Agent's geocode tool (CRIS-20 seam / CRIS-21 Amazon Location) resolves it.
   * `null` when no location is stated.
   */
  locationHint: string | null;
  /** Short, PII-free summary for coordinator triage. */
  summary: string;
  /** Brief PII-free justification for the category/urgency (explainability). */
  rationale: string;
  /**
   * Model-flagged escalation — set when the report is ambiguous, conflicting,
   * or possibly a hoax. Forces NEEDS_VERIFICATION regardless of `confidence`.
   */
  needsHumanReview: boolean;
  /**
   * Salient entities extracted from the report (§2.2, CRIS-20) — the "number of
   * people affected" and "specific infrastructure involved" the design calls
   * out, surfaced on the coordinator incident-detail view (design doc Fig 2).
   * Enrichment only: unlike the core fields it is parsed leniently and never
   * feeds the deterministic score (that is CRIS-30's decision). Always present
   * after {@link parseClassification} — empty for the single-call producer.
   */
  entities: TriageEntities;
}

/**
 * PII-free entities the Triage Agent pulls out of a report for triage context
 * (§2.2). Model-derived and untrusted; treat as display metadata, never as an
 * authority for routing. All fields are optional/absent-tolerant — a report is
 * never rejected over malformed entities (see {@link parseEntities}).
 */
export interface TriageEntities {
  /** Estimated people affected / at risk (§2.2; "Affected People" in Fig 4). `null` when not stated. */
  peopleAffected: number | null;
  /** Specific infrastructure involved, e.g. "north bridge", "power substation" (§2.2). */
  infrastructure: string[];
  /** Other salient hazards/impacts mentioned (e.g. "gas leak", "road blocked"). */
  hazards: string[];
}

/**
 * Minimum `confidence` at or above which a classification is auto-accepted.
 * Below this the report is escalated to NEEDS_VERIFICATION (§2.6). Tunable;
 * a change should be recorded (it shifts the human-review workload).
 */
export const CLASSIFICATION_CONFIDENCE_THRESHOLD = 0.6;

/** Max character lengths for free-text fields (defense-in-depth vs. prompt-injection bloat). */
export const CLASSIFICATION_MAX_SUMMARY_CHARS = 500;
export const CLASSIFICATION_MAX_RATIONALE_CHARS = 500;
export const CLASSIFICATION_MAX_LOCATION_HINT_CHARS = 300;

/** Caps on the entity lists (CRIS-20) — same prompt-injection-bloat defense as above. */
export const CLASSIFICATION_MAX_ENTITY_ITEMS = 12;
export const CLASSIFICATION_MAX_ENTITY_CHARS = 120;

/**
 * JSON Schema for the contract — usable directly as a Claude structured-output
 * schema (`output_config.format`) or a tool `input_schema`. Enum arrays are
 * derived from `@crisismap/shared` so the model can only emit valid values.
 * `additionalProperties: false` + full `required` make it strict-mode ready.
 */
export const CLASSIFICATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    category: { type: 'string', enum: Object.values(Category) },
    urgency: { type: 'string', enum: Object.values(Urgency) },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    locationHint: { type: ['string', 'null'], maxLength: CLASSIFICATION_MAX_LOCATION_HINT_CHARS },
    summary: { type: 'string', maxLength: CLASSIFICATION_MAX_SUMMARY_CHARS },
    rationale: { type: 'string', maxLength: CLASSIFICATION_MAX_RATIONALE_CHARS },
    needsHumanReview: { type: 'boolean' },
  },
  required: [
    'category',
    'urgency',
    'confidence',
    'locationHint',
    'summary',
    'rationale',
    'needsHumanReview',
  ],
} as const;

/** JSON Schema for the `entities` object (CRIS-20). No exotic constraints — see below. */
export const TRIAGE_ENTITIES_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    peopleAffected: { type: ['integer', 'null'] },
    infrastructure: {
      type: 'array',
      items: { type: 'string', maxLength: CLASSIFICATION_MAX_ENTITY_CHARS },
    },
    hazards: {
      type: 'array',
      items: { type: 'string', maxLength: CLASSIFICATION_MAX_ENTITY_CHARS },
    },
  },
  required: ['peopleAffected', 'infrastructure', 'hazards'],
} as const;

/**
 * Input schema for the Triage Agent's `submit_triage` tool (CRIS-20). It is the
 * base classification contract plus `entities`, so the tool-using agent emits
 * one structured payload validated by the same {@link parseClassification}. The
 * single-call fallback keeps using {@link CLASSIFICATION_JSON_SCHEMA} (no
 * entities) — both are contract-valid because entity parsing is lenient.
 */
export const TRIAGE_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...CLASSIFICATION_JSON_SCHEMA.properties,
    entities: TRIAGE_ENTITIES_JSON_SCHEMA,
  },
  required: [...CLASSIFICATION_JSON_SCHEMA.required, 'entities'],
} as const;

/** Thrown when a model response violates the contract. Caller routes to NEEDS_VERIFICATION. */
export class ClassificationContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClassificationContractError';
  }
}

const CATEGORY_VALUES = new Set<string>(Object.values(Category));
const URGENCY_VALUES = new Set<string>(Object.values(Urgency));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Normalize an untrusted value into a bounded list of trimmed, capped strings. */
function toEntityList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (out.length >= CLASSIFICATION_MAX_ENTITY_ITEMS) break;
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed) out.push(trimmed.slice(0, CLASSIFICATION_MAX_ENTITY_CHARS));
  }
  return out;
}

/**
 * Normalize an untrusted `entities` value into {@link TriageEntities}. Lenient
 * by design — entities are enrichment, not a safety-critical field, so a
 * malformed/absent value yields empty entities rather than failing the whole
 * report to NEEDS_VERIFICATION. Never throws.
 */
export function parseEntities(raw: unknown): TriageEntities {
  const obj = isRecord(raw) ? raw : {};
  const people = obj.peopleAffected;
  const peopleAffected =
    typeof people === 'number' && Number.isFinite(people) && people >= 0
      ? Math.round(people)
      : null;
  return {
    peopleAffected,
    infrastructure: toEntityList(obj.infrastructure),
    hazards: toEntityList(obj.hazards),
  };
}

/**
 * Validate and normalize a raw model response into a {@link ClassificationResult}.
 * Enforces enum membership, `confidence ∈ [0, 1]`, field presence, and length
 * caps. `contractVersion` is stamped by us (not trusted from the model).
 *
 * @throws {ClassificationContractError} if the response is not contract-valid.
 */
export function parseClassification(raw: unknown): ClassificationResult {
  if (!isRecord(raw)) {
    throw new ClassificationContractError('classification response is not an object');
  }

  const {
    category,
    urgency,
    confidence,
    locationHint,
    summary,
    rationale,
    needsHumanReview,
    entities,
  } = raw;

  if (typeof category !== 'string' || !CATEGORY_VALUES.has(category)) {
    throw new ClassificationContractError(`invalid category: ${String(category)}`);
  }
  if (typeof urgency !== 'string' || !URGENCY_VALUES.has(urgency)) {
    throw new ClassificationContractError(`invalid urgency: ${String(urgency)}`);
  }
  if (
    typeof confidence !== 'number' ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    throw new ClassificationContractError(
      `confidence must be a number in [0, 1]: ${String(confidence)}`,
    );
  }
  if (locationHint !== null && typeof locationHint !== 'string') {
    throw new ClassificationContractError('locationHint must be a string or null');
  }
  if (typeof summary !== 'string') {
    throw new ClassificationContractError('summary must be a string');
  }
  if (typeof rationale !== 'string') {
    throw new ClassificationContractError('rationale must be a string');
  }
  if (typeof needsHumanReview !== 'boolean') {
    throw new ClassificationContractError('needsHumanReview must be a boolean');
  }

  return {
    contractVersion: CLASSIFICATION_CONTRACT_VERSION,
    category: category as Category,
    urgency: urgency as Urgency,
    confidence,
    locationHint:
      locationHint === null ? null : locationHint.slice(0, CLASSIFICATION_MAX_LOCATION_HINT_CHARS),
    summary: summary.slice(0, CLASSIFICATION_MAX_SUMMARY_CHARS),
    rationale: rationale.slice(0, CLASSIFICATION_MAX_RATIONALE_CHARS),
    needsHumanReview,
    entities: parseEntities(entities),
  };
}

/**
 * Whether a valid classification should still be escalated to human review
 * (§2.6): the model flagged it, or confidence is below the accept threshold.
 */
export function shouldEscalateToVerification(result: ClassificationResult): boolean {
  return result.needsHumanReview || result.confidence < CLASSIFICATION_CONFIDENCE_THRESHOLD;
}

/* -------------------------------------------------------------------------- */
/* 2. Deterministic priority scoring (§5.4.2)                                 */
/* -------------------------------------------------------------------------- */

/**
 * Priority factors expressed in final score-points. Positive evidence is added,
 * penalties are subtracted, and the result is clamped to [0, 10]. Mirrors the
 * persisted `scoreBreakdown` JSON contract — keep consumers in sync (the guard
 * test enforces this).
 */
export interface ScoreBreakdown {
  /** Points from assessed urgency (dominant term). */
  urgencyWeight: number;
  /** Points from incident category. */
  categoryWeight: number;
  /** Points from the estimated number of people affected. */
  affectedPeopleWeight: number;
  /** Points from confirmed human verifications. */
  verificationWeight: number;
  /** Points from freshness (time-decayed). */
  recencyWeight: number;
  /** Points from strongly linked duplicate reports. */
  duplicateWeight: number;
  /** Penalty caused by classification uncertainty (stored as a positive magnitude). */
  uncertaintyPenalty: number;
  /** Penalty caused by report staleness (stored as a positive magnitude). */
  stalenessPenalty: number;
}

/** Inputs to the v2 scoring formula at a specific scoring event. */
export interface ScoreInput {
  urgency: Urgency;
  category: Category;
  /** Validated classification confidence in [0, 1]. */
  confidence: number;
  /** Report age in minutes (score time − submission time). */
  ageMinutes: number;
  /** Estimated people affected; absent/unknown evidence contributes zero. */
  peopleAffected?: number | null;
  /** Count of CONFIRMED HUMAN verification records. */
  confirmedHumanVerifications?: number;
  /** Count of OTHER reports strongly linked to this incident (§5.4.3). */
  strongDuplicateReports?: number;
}

/** Result of scoring: the score, its band, the formula version, and the explainable breakdown. */
export interface ScoringResult {
  priorityScore: number;
  priorityBand: PriorityBand;
  scoreVersion: number;
  breakdown: ScoreBreakdown;
}

/** Max points contributed by urgency. CRITICAL saturates this term. */
export const URGENCY_MAX_POINTS = 5.5;
const URGENCY_POINTS: Record<Urgency, number> = {
  CRITICAL: 5.5,
  HIGH: 4,
  MEDIUM: 2,
  LOW: 0.5,
};

/** Max points contributed by category (category factor × this). */
export const CATEGORY_MAX_POINTS = 2;
/**
 * Versioned per-category weight in [0, 1] — life-threat categories rank highest.
 * Runtime `CategoryConfig` overrides are deliberately excluded: without a
 * config version they would make identical score inputs irreproducible.
 */
const CATEGORY_WEIGHT: Record<Category, number> = {
  MEDICAL: 1.0,
  RESCUE: 1.0,
  FIRE: 0.95,
  HAZMAT: 0.9,
  STRUCTURAL_DAMAGE: 0.8,
  FLOOD: 0.75,
  SHELTER: 0.6,
  UTILITY: 0.5,
  BLOCKED_ROAD: 0.45,
  OTHER: 0.3,
};

/** Max points contributed by recency; decays with a half-life. */
export const RECENCY_MAX_POINTS = 1;
/** Minutes for the recency contribution to halve (exponential decay). */
export const RECENCY_HALF_LIFE_MINUTES = 60;

/** Max points contributed by the estimated affected population. */
export const AFFECTED_PEOPLE_MAX_POINTS = 1.5;
/** Population count at which the affected-people factor reaches half its max. */
export const AFFECTED_PEOPLE_HALF_SATURATION = 5;

/** Max points contributed by confirmed human verifications. */
export const VERIFICATION_MAX_POINTS = 1;
/** Verification count at which the verification factor reaches half its max. */
export const VERIFICATION_HALF_SATURATION = 1;

/** Max points contributed by strong duplicate corroboration. */
export const DUPLICATE_MAX_POINTS = 1.5;
/** Strong-duplicate count at which corroboration reaches half its max. */
export const DUPLICATE_HALF_SATURATION = 2;

/** Confidence at or above which no uncertainty penalty is applied. */
export const UNCERTAINTY_FREE_CONFIDENCE = 0.8;
/** Largest uncertainty penalty, reached at zero confidence. */
export const UNCERTAINTY_MAX_PENALTY = 2;

/** Report age before a staleness penalty starts. */
export const STALENESS_GRACE_MINUTES = 6 * 60;
/** Largest staleness penalty. */
export const STALENESS_MAX_PENALTY = 1.5;
/** Minutes beyond the grace period at which staleness reaches half its max. */
export const STALENESS_HALF_SATURATION_MINUTES = 12 * 60;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Round to 2 decimals — scores are display/comparison values, not currency. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A finite, non-negative evidence count; malformed/absent evidence contributes zero. */
function evidenceCount(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Saturating contribution `max * n/(n + half)` for independently bounded evidence. */
function saturatingWeight(value: number, max: number, half: number): number {
  return round2(max * (value / (value + half)));
}

/**
 * Compute a deterministic, explainable priority score in [0, 10] and its band.
 *
 * P = clamp(U + C + A + V + R + D − uncertainty − staleness, 0, 10)
 *
 * Each term is bounded and independently explainable; the returned
 * `breakdown` records every contribution so the UI can render the "why".
 * Pure and deterministic — identical inputs always yield identical output.
 */
export function scoreReport(input: ScoreInput): ScoringResult {
  // Invalid age must not be treated as fresh. The staleness curve approaches
  // its cap at large finite ages, so this sentinel stays deterministic.
  const ageMinutes = Number.isFinite(input.ageMinutes)
    ? Math.max(0, input.ageMinutes)
    : Number.MAX_SAFE_INTEGER;
  const confidence = Number.isFinite(input.confidence) ? clamp(input.confidence, 0, 1) : 0;
  const peopleAffected = evidenceCount(input.peopleAffected);
  const confirmedHumanVerifications = evidenceCount(input.confirmedHumanVerifications);
  const strongDuplicateReports = evidenceCount(input.strongDuplicateReports);

  const urgencyWeight = URGENCY_POINTS[input.urgency];
  const categoryWeight = round2(CATEGORY_WEIGHT[input.category] * CATEGORY_MAX_POINTS);
  const affectedPeopleWeight = saturatingWeight(
    peopleAffected,
    AFFECTED_PEOPLE_MAX_POINTS,
    AFFECTED_PEOPLE_HALF_SATURATION,
  );
  const verificationWeight = saturatingWeight(
    confirmedHumanVerifications,
    VERIFICATION_MAX_POINTS,
    VERIFICATION_HALF_SATURATION,
  );
  const recencyWeight = round2(
    RECENCY_MAX_POINTS * Math.pow(0.5, ageMinutes / RECENCY_HALF_LIFE_MINUTES),
  );
  const duplicateWeight = saturatingWeight(
    strongDuplicateReports,
    DUPLICATE_MAX_POINTS,
    DUPLICATE_HALF_SATURATION,
  );
  const uncertaintyPenalty = round2(
    UNCERTAINTY_MAX_PENALTY *
      (Math.max(0, UNCERTAINTY_FREE_CONFIDENCE - confidence) / UNCERTAINTY_FREE_CONFIDENCE),
  );
  const staleMinutes = Math.max(0, ageMinutes - STALENESS_GRACE_MINUTES);
  const stalenessPenalty = saturatingWeight(
    staleMinutes,
    STALENESS_MAX_PENALTY,
    STALENESS_HALF_SATURATION_MINUTES,
  );

  const raw =
    urgencyWeight +
    categoryWeight +
    affectedPeopleWeight +
    verificationWeight +
    recencyWeight +
    duplicateWeight -
    uncertaintyPenalty -
    stalenessPenalty;
  const priorityScore = round2(clamp(raw, 0, 10));

  const breakdown: ScoreBreakdown = {
    urgencyWeight,
    categoryWeight,
    affectedPeopleWeight,
    verificationWeight,
    recencyWeight,
    duplicateWeight,
    uncertaintyPenalty,
    stalenessPenalty,
  };

  return {
    priorityScore,
    priorityBand: priorityBandForScore(priorityScore),
    scoreVersion: SCORE_VERSION,
    breakdown,
  };
}

/** Narrow an untrusted value to a finite number, or `null`. */
function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Parse a persisted `scoreBreakdown` (stored as `a.json()` on `Report`, so
 * untyped at read time) back into a {@link ScoreBreakdown}, or `null` when it is
 * absent/malformed. Unlike {@link scoreReport} — which produces the breakdown —
 * this is the read-side counterpart the coordinator incident-detail view (CRIS-23)
 * uses to render *why* a report ranks where it does.
 *
 * Strict on the eight numeric factors (all must be finite numbers, since the UI
 * renders each as a contribution to the score).
 * A breakdown missing any factor is treated as absent rather than partially
 * rendered — the detail view simply omits the "why" panel for that report.
 * Never throws.
 */
export function parseScoreBreakdown(raw: unknown): ScoreBreakdown | null {
  if (!isRecord(raw)) return null;
  const urgencyWeight = finiteNumber(raw.urgencyWeight);
  const categoryWeight = finiteNumber(raw.categoryWeight);
  const affectedPeopleWeight = finiteNumber(raw.affectedPeopleWeight);
  const verificationWeight = finiteNumber(raw.verificationWeight);
  const recencyWeight = finiteNumber(raw.recencyWeight);
  const duplicateWeight = finiteNumber(raw.duplicateWeight);
  const uncertaintyPenalty = finiteNumber(raw.uncertaintyPenalty);
  const stalenessPenalty = finiteNumber(raw.stalenessPenalty);
  if (
    urgencyWeight === null ||
    categoryWeight === null ||
    affectedPeopleWeight === null ||
    verificationWeight === null ||
    recencyWeight === null ||
    duplicateWeight === null ||
    uncertaintyPenalty === null ||
    stalenessPenalty === null
  ) {
    return null;
  }
  return {
    urgencyWeight,
    categoryWeight,
    affectedPeopleWeight,
    verificationWeight,
    recencyWeight,
    duplicateWeight,
    uncertaintyPenalty,
    stalenessPenalty,
  };
}
