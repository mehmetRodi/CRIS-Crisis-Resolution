import { describe, expect, it } from 'vitest';
import {
  CLASSIFICATION_CATEGORIES,
  CLASSIFICATION_JSON_SCHEMA,
  CLASSIFICATION_URGENCIES,
  validateClassification,
} from './classification';
import { Category, Urgency } from './domain';

const valid = {
  category: Category.STRUCTURAL_DAMAGE,
  urgency: Urgency.CRITICAL,
  confidence: 0.92,
  entities: ['Harborfront Pier', 'bridge'],
  summary: 'A bridge collapsed near Harborfront Pier; multiple vehicles involved.',
};

describe('validateClassification (§5.4.1 JSON contract)', () => {
  it('accepts a well-formed classification', () => {
    const result = validateClassification(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.category).toBe(Category.STRUCTURAL_DAMAGE);
      expect(result.value.urgency).toBe(Urgency.CRITICAL);
    }
  });

  it('rejects a non-object payload', () => {
    expect(validateClassification('not json').ok).toBe(false);
    expect(validateClassification(null).ok).toBe(false);
    expect(validateClassification([]).ok).toBe(false);
  });

  it('rejects a category outside the enum allow-list', () => {
    const result = validateClassification({ ...valid, category: 'EARTHQUAKE' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.startsWith('category'))).toBe(true);
  });

  it('rejects an urgency outside the enum allow-list', () => {
    const result = validateClassification({ ...valid, urgency: 'SEVERE' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.startsWith('urgency'))).toBe(true);
  });

  it('rejects confidence outside [0, 1]', () => {
    expect(validateClassification({ ...valid, confidence: 1.5 }).ok).toBe(false);
    expect(validateClassification({ ...valid, confidence: -0.1 }).ok).toBe(false);
    expect(validateClassification({ ...valid, confidence: 'high' }).ok).toBe(false);
  });

  it('rejects non-string-array entities', () => {
    expect(validateClassification({ ...valid, entities: [1, 2] }).ok).toBe(false);
    expect(validateClassification({ ...valid, entities: 'a,b' }).ok).toBe(false);
  });

  it('rejects an empty or missing summary', () => {
    expect(validateClassification({ ...valid, summary: '   ' }).ok).toBe(false);
    const { summary: _omit, ...noSummary } = valid;
    expect(validateClassification(noSummary).ok).toBe(false);
  });

  it('reports every problem at once (drives the single repair prompt)', () => {
    const result = validateClassification({ category: 'NOPE', urgency: 'NOPE', confidence: 9 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('classification schema mirrors the shared enums', () => {
  it('exposes the Category / Urgency allow-lists as the JSON Schema enums', () => {
    expect(CLASSIFICATION_CATEGORIES).toEqual(Object.values(Category));
    expect(CLASSIFICATION_URGENCIES).toEqual(Object.values(Urgency));
    expect(CLASSIFICATION_JSON_SCHEMA.properties.category.enum).toEqual(Object.values(Category));
    expect(CLASSIFICATION_JSON_SCHEMA.properties.urgency.enum).toEqual(Object.values(Urgency));
    expect(CLASSIFICATION_JSON_SCHEMA.additionalProperties).toBe(false);
  });
});
