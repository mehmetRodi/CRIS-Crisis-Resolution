// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { hasStructuredClassification } from './classification-outcome';

const complete = {
  category: 'FIRE',
  urgency: 'HIGH',
  confidence: 0.55,
  summary: 'Synthetic kitchen fire.',
  priorityScore: 6,
  priorityBand: 'P1',
};

describe('hasStructuredClassification', () => {
  it('accepts a complete low-confidence classification', () => {
    expect(hasStructuredClassification(complete)).toBe(true);
  });

  it.each(Object.keys(complete))('rejects a handled-failure result missing %s', (field) => {
    expect(hasStructuredClassification({ ...complete, [field]: null })).toBe(false);
  });
});
