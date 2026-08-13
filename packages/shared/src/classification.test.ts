import { describe, expect, it } from 'vitest';
import { Category, PriorityBand, Urgency } from './domain';
import {
  AFFECTED_PEOPLE_MAX_POINTS,
  CATEGORY_MAX_POINTS,
  CLASSIFICATION_CONFIDENCE_THRESHOLD,
  CLASSIFICATION_CONTRACT_VERSION,
  CLASSIFICATION_JSON_SCHEMA,
  CLASSIFICATION_MAX_ENTITY_CHARS,
  CLASSIFICATION_MAX_ENTITY_ITEMS,
  CLASSIFICATION_MAX_SUMMARY_CHARS,
  ClassificationContractError,
  DUPLICATE_MAX_POINTS,
  parseClassification,
  parseEntities,
  parseScoreBreakdown,
  RECENCY_HALF_LIFE_MINUTES,
  RECENCY_MAX_POINTS,
  scoreReport,
  SCORE_VERSION,
  STALENESS_GRACE_MINUTES,
  STALENESS_MAX_PENALTY,
  shouldEscalateToVerification,
  TRIAGE_TOOL_INPUT_SCHEMA,
  UNCERTAINTY_MAX_PENALTY,
  URGENCY_MAX_POINTS,
  VERIFICATION_MAX_POINTS,
  type ClassificationResult,
} from './classification';

/** A minimal contract-valid raw response for reuse across cases. */
function rawClassification(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    category: Category.MEDICAL,
    urgency: Urgency.CRITICAL,
    confidence: 0.9,
    locationHint: 'north bridge on Route 9',
    summary: 'Person trapped, needs medical evac.',
    rationale: 'Explicit mention of injury and entrapment.',
    needsHumanReview: false,
    ...overrides,
  };
}

describe('classification contract (§2.2)', () => {
  it('parses a valid response and stamps our contract version (not the model’s)', () => {
    const result = parseClassification(rawClassification({ contractVersion: 999 }));
    expect(result.contractVersion).toBe(CLASSIFICATION_CONTRACT_VERSION);
    expect(result.category).toBe(Category.MEDICAL);
    expect(result.urgency).toBe(Urgency.CRITICAL);
    expect(result.confidence).toBe(0.9);
    expect(result.locationHint).toBe('north bridge on Route 9');
    expect(result.needsHumanReview).toBe(false);
  });

  it('accepts a null locationHint', () => {
    expect(parseClassification(rawClassification({ locationHint: null })).locationHint).toBeNull();
  });

  it.each([
    ['non-object', 42],
    ['null', null],
    ['array', []],
    ['bad category', rawClassification({ category: 'EARTHQUAKE' })],
    ['bad urgency', rawClassification({ urgency: 'EXTREME' })],
    ['confidence > 1', rawClassification({ confidence: 1.5 })],
    ['confidence < 0', rawClassification({ confidence: -0.1 })],
    ['confidence NaN', rawClassification({ confidence: Number.NaN })],
    ['confidence non-number', rawClassification({ confidence: '0.9' })],
    ['missing summary', rawClassification({ summary: undefined })],
    ['non-boolean needsHumanReview', rawClassification({ needsHumanReview: 'yes' })],
    ['locationHint wrong type', rawClassification({ locationHint: 5 })],
  ])('rejects %s with ClassificationContractError', (_label, raw) => {
    expect(() => parseClassification(raw)).toThrow(ClassificationContractError);
  });

  it('truncates over-long free-text fields (prompt-injection bloat defense)', () => {
    const long = 'x'.repeat(CLASSIFICATION_MAX_SUMMARY_CHARS + 100);
    expect(parseClassification(rawClassification({ summary: long })).summary).toHaveLength(
      CLASSIFICATION_MAX_SUMMARY_CHARS,
    );
  });

  it('JSON schema constrains category/urgency to the shared enums', () => {
    expect(CLASSIFICATION_JSON_SCHEMA.properties.category.enum).toEqual(Object.values(Category));
    expect(CLASSIFICATION_JSON_SCHEMA.properties.urgency.enum).toEqual(Object.values(Urgency));
    // Strict-mode ready: every property is required, no extras allowed.
    expect(CLASSIFICATION_JSON_SCHEMA.additionalProperties).toBe(false);
    expect([...CLASSIFICATION_JSON_SCHEMA.required].sort()).toEqual(
      Object.keys(CLASSIFICATION_JSON_SCHEMA.properties).sort(),
    );
  });

  it('bumps the contract version to 2 for the entity-carrying triage payload', () => {
    expect(CLASSIFICATION_CONTRACT_VERSION).toBe(2);
  });
});

describe('triage entities (§2.2, CRIS-20)', () => {
  it('defaults to empty entities when the (single-call) producer omits them', () => {
    // The CRIS-10 single-call classifier emits no `entities`; it must stay valid.
    expect(parseClassification(rawClassification()).entities).toEqual({
      peopleAffected: null,
      infrastructure: [],
      hazards: [],
    });
  });

  it('parses well-formed entities from the triage agent', () => {
    const entities = {
      peopleAffected: 50,
      infrastructure: ['north bridge', 'Route 9'],
      hazards: ['road blocked'],
    };
    expect(parseClassification(rawClassification({ entities })).entities).toEqual(entities);
  });

  it('is lenient — never throws, normalizing junk to safe defaults', () => {
    // Malformed entities must NOT fail the whole report to NEEDS_VERIFICATION.
    const result = parseEntities({
      peopleAffected: 'many',
      infrastructure: 'not-an-array',
      hazards: ['gas leak', 42, '', '  bridge  '],
    });
    expect(result.peopleAffected).toBeNull();
    expect(result.infrastructure).toEqual([]);
    // Non-strings dropped, blanks dropped, surviving strings trimmed.
    expect(result.hazards).toEqual(['gas leak', 'bridge']);
  });

  it('rounds a fractional count and rejects a negative one', () => {
    expect(parseEntities({ peopleAffected: 12.6 }).peopleAffected).toBe(13);
    expect(parseEntities({ peopleAffected: -5 }).peopleAffected).toBeNull();
  });

  it('caps entity list length and per-item length (bloat defense)', () => {
    const many = Array.from({ length: CLASSIFICATION_MAX_ENTITY_ITEMS + 5 }, (_, i) => `x${i}`);
    const long = 'y'.repeat(CLASSIFICATION_MAX_ENTITY_CHARS + 50);
    const result = parseEntities({ infrastructure: many, hazards: [long] });
    expect(result.infrastructure).toHaveLength(CLASSIFICATION_MAX_ENTITY_ITEMS);
    expect(result.hazards[0]).toHaveLength(CLASSIFICATION_MAX_ENTITY_CHARS);
  });

  it('triage tool schema is the base contract plus a required entities object', () => {
    expect(TRIAGE_TOOL_INPUT_SCHEMA.properties.entities).toBeDefined();
    expect(TRIAGE_TOOL_INPUT_SCHEMA.required).toContain('entities');
    // Same strict-mode invariant as the base schema: required === property keys.
    expect([...TRIAGE_TOOL_INPUT_SCHEMA.required].sort()).toEqual(
      Object.keys(TRIAGE_TOOL_INPUT_SCHEMA.properties).sort(),
    );
    // Reuses the shared enums (not a divergent copy).
    expect(TRIAGE_TOOL_INPUT_SCHEMA.properties.category.enum).toEqual(Object.values(Category));
  });
});

describe('human-review escalation (§2.6)', () => {
  const base: ClassificationResult = parseClassification(rawClassification());

  it('escalates when the model flags review, regardless of confidence', () => {
    expect(shouldEscalateToVerification({ ...base, needsHumanReview: true })).toBe(true);
  });

  it('escalates below the confidence threshold and accepts at/above it', () => {
    expect(
      shouldEscalateToVerification({
        ...base,
        confidence: CLASSIFICATION_CONFIDENCE_THRESHOLD - 0.01,
      }),
    ).toBe(true);
    expect(
      shouldEscalateToVerification({ ...base, confidence: CLASSIFICATION_CONFIDENCE_THRESHOLD }),
    ).toBe(false);
  });
});

describe('deterministic priority scoring (§5.4.2)', () => {
  it('is pure — identical inputs yield identical output', () => {
    const input = {
      urgency: Urgency.HIGH,
      category: Category.FIRE,
      confidence: 0.9,
      ageMinutes: 10,
    };
    expect(scoreReport(input)).toEqual(scoreReport(input));
  });

  it('scores a fresh, confident critical medical report as P0', () => {
    const { priorityScore, priorityBand, breakdown, scoreVersion } = scoreReport({
      urgency: Urgency.CRITICAL,
      category: Category.MEDICAL,
      confidence: 0.9,
      ageMinutes: 0,
    });
    expect(breakdown.urgencyWeight).toBe(5.5);
    expect(breakdown.categoryWeight).toBe(2);
    expect(breakdown.recencyWeight).toBe(RECENCY_MAX_POINTS);
    expect(breakdown.affectedPeopleWeight).toBe(0);
    expect(breakdown.verificationWeight).toBe(0);
    expect(breakdown.duplicateWeight).toBe(0);
    expect(breakdown.uncertaintyPenalty).toBe(0);
    expect(breakdown.stalenessPenalty).toBe(0);
    expect(priorityScore).toBe(8.5);
    expect(priorityBand).toBe(PriorityBand.P0);
    expect(scoreVersion).toBe(SCORE_VERSION);
  });

  it('pins the agreed no-evidence baseline bands', () => {
    const baseline = (urgency: Urgency, category: Category) =>
      scoreReport({ urgency, category, confidence: 0.9, ageMinutes: 0 }).priorityBand;

    expect(baseline(Urgency.CRITICAL, Category.MEDICAL)).toBe(PriorityBand.P0);
    expect(baseline(Urgency.HIGH, Category.FIRE)).toBe(PriorityBand.P1);
    expect(baseline(Urgency.MEDIUM, Category.FLOOD)).toBe(PriorityBand.P2);
    expect(baseline(Urgency.LOW, Category.OTHER)).toBe(PriorityBand.P3);
  });

  it('adds evidence and subtracts penalties in the explainable breakdown', () => {
    const { priorityScore, breakdown } = scoreReport({
      urgency: Urgency.MEDIUM,
      category: Category.UTILITY,
      confidence: 0.7,
      ageMinutes: STALENESS_GRACE_MINUTES + 60,
      peopleAffected: 5,
      confirmedHumanVerifications: 1,
      strongDuplicateReports: 2,
    });
    const explained =
      breakdown.urgencyWeight +
      breakdown.categoryWeight +
      breakdown.affectedPeopleWeight +
      breakdown.verificationWeight +
      breakdown.recencyWeight +
      breakdown.duplicateWeight -
      breakdown.uncertaintyPenalty -
      breakdown.stalenessPenalty;
    expect(priorityScore).toBeCloseTo(explained, 2);
  });

  it('decays recency by half after one half-life', () => {
    const fresh = scoreReport({
      urgency: Urgency.LOW,
      category: Category.OTHER,
      confidence: 0.9,
      ageMinutes: 0,
    });
    const aged = scoreReport({
      urgency: Urgency.LOW,
      category: Category.OTHER,
      confidence: 0.9,
      ageMinutes: RECENCY_HALF_LIFE_MINUTES,
    });
    expect(aged.breakdown.recencyWeight).toBeCloseTo(fresh.breakdown.recencyWeight / 2, 2);
  });

  it('uses independent saturating curves for affected people, verification and duplicates', () => {
    const scored = scoreReport({
      urgency: Urgency.LOW,
      category: Category.OTHER,
      confidence: 0.9,
      ageMinutes: 0,
      peopleAffected: 5,
      confirmedHumanVerifications: 1,
      strongDuplicateReports: 2,
    });
    expect(scored.breakdown.affectedPeopleWeight).toBe(AFFECTED_PEOPLE_MAX_POINTS / 2);
    expect(scored.breakdown.verificationWeight).toBe(VERIFICATION_MAX_POINTS / 2);
    expect(scored.breakdown.duplicateWeight).toBe(DUPLICATE_MAX_POINTS / 2);
  });

  it('treats absent or malformed evidence as zero rather than a priority boost', () => {
    const scored = scoreReport({
      urgency: Urgency.LOW,
      category: Category.OTHER,
      confidence: 0.9,
      ageMinutes: 0,
      peopleAffected: Number.NaN,
      confirmedHumanVerifications: -3,
      strongDuplicateReports: Number.POSITIVE_INFINITY,
    });
    expect(scored.breakdown.affectedPeopleWeight).toBe(0);
    expect(scored.breakdown.verificationWeight).toBe(0);
    expect(scored.breakdown.duplicateWeight).toBe(0);
  });

  it('penalizes confidence below 0.8 and clamps malformed confidence conservatively', () => {
    const certain = scoreReport({
      urgency: Urgency.HIGH,
      category: Category.FIRE,
      confidence: 0.8,
      ageMinutes: 0,
    });
    const uncertain = scoreReport({
      urgency: Urgency.HIGH,
      category: Category.FIRE,
      confidence: 0.4,
      ageMinutes: 0,
    });
    const malformed = scoreReport({
      urgency: Urgency.HIGH,
      category: Category.FIRE,
      confidence: Number.NaN,
      ageMinutes: 0,
    });
    expect(certain.breakdown.uncertaintyPenalty).toBe(0);
    expect(uncertain.breakdown.uncertaintyPenalty).toBe(1);
    expect(malformed.breakdown.uncertaintyPenalty).toBe(UNCERTAINTY_MAX_PENALTY);
  });

  it('applies no staleness penalty during the grace period and then saturates', () => {
    const grace = scoreReport({
      urgency: Urgency.MEDIUM,
      category: Category.FLOOD,
      confidence: 0.9,
      ageMinutes: STALENESS_GRACE_MINUTES,
    });
    const stale = scoreReport({
      urgency: Urgency.MEDIUM,
      category: Category.FLOOD,
      confidence: 0.9,
      ageMinutes: 100_000,
    });
    expect(grace.breakdown.stalenessPenalty).toBe(0);
    expect(stale.breakdown.stalenessPenalty).toBeLessThanOrEqual(STALENESS_MAX_PENALTY);
    expect(stale.breakdown.stalenessPenalty).toBeGreaterThan(1.4);
  });

  it('clamps the final score to [0, 10]', () => {
    const maxed = scoreReport({
      urgency: Urgency.CRITICAL,
      category: Category.MEDICAL,
      confidence: 1,
      ageMinutes: 0,
      peopleAffected: 10_000,
      confirmedHumanVerifications: 100,
      strongDuplicateReports: 100,
    });
    expect(maxed.priorityScore).toBe(10);
    expect(maxed.priorityBand).toBe(PriorityBand.P0);

    const floored = scoreReport({
      urgency: Urgency.LOW,
      category: Category.OTHER,
      confidence: 0,
      ageMinutes: Number.NaN,
    });
    expect(floored.priorityScore).toBe(0);
    expect(floored.priorityBand).toBe(PriorityBand.P3);
  });

  it('ranks urgency as the dominant term across categories', () => {
    const critical = scoreReport({
      urgency: Urgency.CRITICAL,
      category: Category.OTHER,
      confidence: 0.9,
      ageMinutes: 0,
    });
    const low = scoreReport({
      urgency: Urgency.LOW,
      category: Category.MEDICAL,
      confidence: 0.9,
      ageMinutes: 0,
    });
    expect(critical.priorityScore).toBeGreaterThan(low.priorityScore);
  });

  it('keeps per-term caps consistent with the exported constants', () => {
    expect(URGENCY_MAX_POINTS).toBe(5.5);
    expect(CATEGORY_MAX_POINTS).toBe(2);
    // Every category weight stays within [0, CATEGORY_MAX_POINTS].
    for (const category of Object.values(Category)) {
      const { categoryWeight } = scoreReport({
        urgency: Urgency.LOW,
        category,
        confidence: 0.9,
        ageMinutes: 0,
      }).breakdown;
      expect(categoryWeight).toBeGreaterThanOrEqual(0);
      expect(categoryWeight).toBeLessThanOrEqual(CATEGORY_MAX_POINTS);
    }
  });
});

/**
 * Drift guard (mirrors the enum sync guard in domain.test.ts): the
 * `ScoreBreakdown` factor names are persisted as JSON and consumed by the
 * coordinator UI. If you add/rename a factor, update both and this expectation.
 */
describe('parseScoreBreakdown', () => {
  it('round-trips a breakdown produced by scoreReport', () => {
    const { breakdown } = scoreReport({
      urgency: Urgency.HIGH,
      category: Category.FIRE,
      confidence: 0.9,
      ageMinutes: 0,
      strongDuplicateReports: 2,
    });
    expect(parseScoreBreakdown(breakdown)).toEqual(breakdown);
  });

  it('parses the complete v2 breakdown', () => {
    const raw = {
      urgencyWeight: 4,
      categoryWeight: 1.9,
      affectedPeopleWeight: 0.75,
      verificationWeight: 0.5,
      recencyWeight: 1,
      duplicateWeight: 0.75,
      uncertaintyPenalty: 0.25,
      stalenessPenalty: 0,
    };
    expect(parseScoreBreakdown(raw)).toEqual(raw);
  });

  it('returns null when a numeric factor is missing or not a finite number', () => {
    const base = {
      urgencyWeight: 3.5,
      categoryWeight: 2,
      affectedPeopleWeight: 0.75,
      verificationWeight: 0.5,
      recencyWeight: 1,
      duplicateWeight: 0.75,
      uncertaintyPenalty: 0,
      stalenessPenalty: 0,
    };
    expect(parseScoreBreakdown({ ...base, recencyWeight: undefined })).toBeNull();
    expect(parseScoreBreakdown({ ...base, categoryWeight: 'x' })).toBeNull();
    expect(parseScoreBreakdown({ ...base, urgencyWeight: Number.NaN })).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(parseScoreBreakdown(null)).toBeNull();
    expect(parseScoreBreakdown('breakdown')).toBeNull();
    expect(parseScoreBreakdown(undefined)).toBeNull();
  });
});

describe('score breakdown sync guard', () => {
  it('pins the breakdown factor names that must match the Amplify ScoreBreakdown type', () => {
    const { breakdown } = scoreReport({
      urgency: Urgency.HIGH,
      category: Category.FIRE,
      confidence: 0.9,
      ageMinutes: 0,
    });
    expect(Object.keys(breakdown).sort()).toEqual(
      [
        'affectedPeopleWeight',
        'categoryWeight',
        'duplicateWeight',
        'recencyWeight',
        'stalenessPenalty',
        'uncertaintyPenalty',
        'urgencyWeight',
        'verificationWeight',
      ].sort(),
    );
  });
});
