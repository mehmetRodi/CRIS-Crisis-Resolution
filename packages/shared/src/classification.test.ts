import { describe, expect, it } from 'vitest';
import { Category, PriorityBand, Urgency } from './domain';
import {
  CATEGORY_MAX_POINTS,
  CLASSIFICATION_CONFIDENCE_THRESHOLD,
  CLASSIFICATION_CONTRACT_VERSION,
  CLASSIFICATION_JSON_SCHEMA,
  CLASSIFICATION_MAX_SUMMARY_CHARS,
  ClassificationContractError,
  MANUAL_ADJUSTMENT_LIMIT,
  parseClassification,
  RECENCY_HALF_LIFE_MINUTES,
  RECENCY_MAX_POINTS,
  scoreReport,
  SCORE_VERSION,
  shouldEscalateToVerification,
  URGENCY_MAX_POINTS,
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
    const input = { urgency: Urgency.HIGH, category: Category.FIRE, ageMinutes: 10 };
    expect(scoreReport(input)).toEqual(scoreReport(input));
  });

  it('scores a fresh critical medical report near the top and bands it P0', () => {
    const { priorityScore, priorityBand, breakdown, scoreVersion } = scoreReport({
      urgency: Urgency.CRITICAL,
      category: Category.MEDICAL,
      ageMinutes: 0,
    });
    // 5 (urgency) + 3 (category 1.0×3) + 1.5 (fresh) + 0 (no corroboration)
    expect(breakdown.urgencyWeight).toBe(5);
    expect(breakdown.categoryWeight).toBe(3);
    expect(breakdown.recencyWeight).toBe(RECENCY_MAX_POINTS);
    expect(breakdown.corroborationWeight).toBe(0);
    expect(priorityScore).toBe(9.5);
    expect(priorityBand).toBe(PriorityBand.P0);
    expect(scoreVersion).toBe(SCORE_VERSION);
  });

  it('breakdown terms sum to the (pre-clamp) score', () => {
    const { priorityScore, breakdown } = scoreReport({
      urgency: Urgency.MEDIUM,
      category: Category.UTILITY,
      ageMinutes: 20,
      corroboratingReports: 1,
    });
    const sum =
      breakdown.urgencyWeight +
      breakdown.categoryWeight +
      breakdown.recencyWeight +
      breakdown.corroborationWeight +
      breakdown.manualAdjustment;
    expect(priorityScore).toBeCloseTo(sum, 2);
  });

  it('decays recency by half after one half-life', () => {
    const fresh = scoreReport({ urgency: Urgency.LOW, category: Category.OTHER, ageMinutes: 0 });
    const aged = scoreReport({
      urgency: Urgency.LOW,
      category: Category.OTHER,
      ageMinutes: RECENCY_HALF_LIFE_MINUTES,
    });
    expect(aged.breakdown.recencyWeight).toBeCloseTo(fresh.breakdown.recencyWeight / 2, 2);
  });

  it('corroboration saturates and never exceeds its cap', () => {
    const none = scoreReport({ urgency: Urgency.LOW, category: Category.OTHER });
    const some = scoreReport({
      urgency: Urgency.LOW,
      category: Category.OTHER,
      corroboratingReports: 2,
    });
    const many = scoreReport({
      urgency: Urgency.LOW,
      category: Category.OTHER,
      corroboratingReports: 50,
      confirmedVerifications: 50,
    });
    expect(none.breakdown.corroborationWeight).toBe(0);
    expect(some.breakdown.corroborationWeight).toBeGreaterThan(0);
    expect(many.breakdown.corroborationWeight).toBeLessThan(2);
    expect(many.breakdown.corroborationWeight).toBeGreaterThan(some.breakdown.corroborationWeight);
  });

  it('clamps the final score to [0, 10]', () => {
    const maxed = scoreReport({
      urgency: Urgency.CRITICAL,
      category: Category.MEDICAL,
      ageMinutes: 0,
      corroboratingReports: 100,
      manualAdjustment: 3,
    });
    expect(maxed.priorityScore).toBe(10);
    expect(maxed.priorityBand).toBe(PriorityBand.P0);

    const floored = scoreReport({
      urgency: Urgency.LOW,
      category: Category.OTHER,
      ageMinutes: 100_000,
      manualAdjustment: -3,
    });
    expect(floored.priorityScore).toBe(0);
    expect(floored.priorityBand).toBe(PriorityBand.P3);
  });

  it('clamps a manual adjustment to ±MANUAL_ADJUSTMENT_LIMIT', () => {
    expect(
      scoreReport({ urgency: Urgency.LOW, category: Category.OTHER, manualAdjustment: 99 })
        .breakdown.manualAdjustment,
    ).toBe(MANUAL_ADJUSTMENT_LIMIT);
    expect(
      scoreReport({ urgency: Urgency.LOW, category: Category.OTHER, manualAdjustment: -99 })
        .breakdown.manualAdjustment,
    ).toBe(-MANUAL_ADJUSTMENT_LIMIT);
  });

  it('carries an optional note into the breakdown only when provided', () => {
    expect(
      scoreReport({ urgency: Urgency.LOW, category: Category.OTHER }).breakdown.notes,
    ).toBeUndefined();
    expect(
      scoreReport({ urgency: Urgency.LOW, category: Category.OTHER, notes: 'coordinator bump' })
        .breakdown.notes,
    ).toBe('coordinator bump');
  });

  it('ranks urgency as the dominant term across categories', () => {
    const critical = scoreReport({ urgency: Urgency.CRITICAL, category: Category.OTHER });
    const low = scoreReport({ urgency: Urgency.LOW, category: Category.MEDICAL });
    expect(critical.priorityScore).toBeGreaterThan(low.priorityScore);
  });

  it('keeps per-term caps consistent with the exported constants', () => {
    expect(URGENCY_MAX_POINTS).toBe(5);
    expect(CATEGORY_MAX_POINTS).toBe(3);
    // Every category weight stays within [0, CATEGORY_MAX_POINTS].
    for (const category of Object.values(Category)) {
      const { categoryWeight } = scoreReport({ urgency: Urgency.LOW, category }).breakdown;
      expect(categoryWeight).toBeGreaterThanOrEqual(0);
      expect(categoryWeight).toBeLessThanOrEqual(CATEGORY_MAX_POINTS);
    }
  });
});

/**
 * Drift guard (mirrors the enum sync guard in domain.test.ts): the
 * `ScoreBreakdown` factor names are duplicated in the Amplify `ScoreBreakdown`
 * custom type in `apps/web/amplify/data/resource.ts`. If you add/rename a
 * factor, update BOTH and this expectation.
 */
describe('score breakdown sync guard', () => {
  it('pins the breakdown factor names that must match the Amplify ScoreBreakdown type', () => {
    const { breakdown } = scoreReport({
      urgency: Urgency.HIGH,
      category: Category.FIRE,
      notes: 'x',
    });
    expect(Object.keys(breakdown).sort()).toEqual(
      [
        'categoryWeight',
        'corroborationWeight',
        'manualAdjustment',
        'notes',
        'recencyWeight',
        'urgencyWeight',
      ].sort(),
    );
  });
});
