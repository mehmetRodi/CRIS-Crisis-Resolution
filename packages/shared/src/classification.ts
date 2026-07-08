/**
 * CrisisMap AI — AI classification JSON contract (design doc §5.4.1, §2.2).
 *
 * The async classifier worker (CRIS-10) calls Bedrock (Claude) with a
 * **JSON-only contract** and validates the response against a JSON Schema plus
 * the `@crisismap/shared` enum allow-lists before trusting it. Invalid output
 * gets at most one repair attempt, then the report drops to
 * `NEEDS_VERIFICATION` (§5.4.1). This module is the single source of truth for
 * that contract — the Amplify data schema, the Lambda worker, and the incident
 * detail UI (Fig. 2 "AI Classification (JSON Preview)") all agree on it.
 *
 * Kept dependency-free on purpose: `validateClassification` is a hand-rolled
 * validator (no ajv) so `@crisismap/shared` stays a source-only, zero-dependency
 * package (ADR-0004) and the check runs identically in the browser, the Lambda,
 * and unit tests. The exported `CLASSIFICATION_JSON_SCHEMA` is what we hand to
 * Bedrock structured outputs; the runtime validator re-checks the enum
 * allow-lists as defense in depth (the model output is untrusted, §5.6).
 *
 * NOTE: this delivers the CRIS-11 classification contract. The deterministic
 * priority-scoring formula (§5.4.2) is a separate CRIS-11 concern; see
 * `priorityBandForScore` in `domain.ts` for the TENTATIVE band mapping.
 */

import { Category, Urgency } from './domain';

/**
 * Normalized classification returned by the Triage Agent (§2.2, §5.4.1).
 *
 * - `category` / `urgency` are constrained to the shared enums.
 * - `confidence` is the model's self-reported confidence in [0, 1]; the report
 *   is escalated to human review below a threshold (§2.6) — that threshold is
 *   applied by the scoring/verification logic, not here.
 * - `entities` are salient extracted entities (locations, landmarks, hazards)
 *   for the incident detail view; never reporter PII (§5.6).
 * - `summary` is a short neutral summary of the situation.
 */
export interface ClassificationResult {
  category: Category;
  urgency: Urgency;
  confidence: number;
  entities: string[];
  summary: string;
}

/** Allowed `category` values, lifted from the shared enum (single source). */
export const CLASSIFICATION_CATEGORIES = Object.values(Category);

/** Allowed `urgency` values, lifted from the shared enum (single source). */
export const CLASSIFICATION_URGENCIES = Object.values(Urgency);

/**
 * JSON Schema handed to Bedrock structured outputs (`output_config.format`).
 *
 * Structured-outputs constraints: every object sets `additionalProperties:
 * false` and lists `required`; numeric range/length constraints are NOT part of
 * the schema (unsupported by structured outputs) — `confidence` bounds and
 * non-empty `summary` are enforced by `validateClassification` instead.
 */
export const CLASSIFICATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'urgency', 'confidence', 'entities', 'summary'],
  properties: {
    category: { type: 'string', enum: [...CLASSIFICATION_CATEGORIES] },
    urgency: { type: 'string', enum: [...CLASSIFICATION_URGENCIES] },
    confidence: { type: 'number' },
    entities: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
} as const;

/**
 * Result of validating an untrusted classification payload. Discriminated on
 * `ok` so callers get a typed `ClassificationResult` on success and a list of
 * human-readable reasons (fed into the single repair prompt) on failure.
 */
export type ClassificationValidation =
  { ok: true; value: ClassificationResult } | { ok: false; errors: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validate an untrusted (model-produced) value against the classification
 * contract: shape, enum allow-lists, `confidence` ∈ [0, 1], non-empty `summary`,
 * and a string-array `entities`. Returns every problem found so the repair
 * prompt can be specific. Pure and dependency-free — safe in any runtime.
 */
export function validateClassification(raw: unknown): ClassificationValidation {
  const errors: string[] = [];

  if (!isRecord(raw)) {
    return { ok: false, errors: ['response is not a JSON object'] };
  }

  const { category, urgency, confidence, entities, summary } = raw;

  if (typeof category !== 'string' || !(CLASSIFICATION_CATEGORIES as string[]).includes(category)) {
    errors.push(`category must be one of: ${CLASSIFICATION_CATEGORIES.join(', ')}`);
  }
  if (typeof urgency !== 'string' || !(CLASSIFICATION_URGENCIES as string[]).includes(urgency)) {
    errors.push(`urgency must be one of: ${CLASSIFICATION_URGENCIES.join(', ')}`);
  }
  if (
    typeof confidence !== 'number' ||
    Number.isNaN(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    errors.push('confidence must be a number between 0 and 1');
  }
  if (!Array.isArray(entities) || !entities.every((e) => typeof e === 'string')) {
    errors.push('entities must be an array of strings');
  }
  if (typeof summary !== 'string' || summary.trim().length === 0) {
    errors.push('summary must be a non-empty string');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      category: category as Category,
      urgency: urgency as Urgency,
      confidence: confidence as number,
      entities: entities as string[],
      summary: summary as string,
    },
  };
}
