import { describe, expect, it } from 'vitest';
import {
  AssignmentStatus,
  Category,
  PriorityBand,
  ReportStatus,
  Urgency,
  UserRole,
} from '@crisismap/shared';

import {
  ASSIGNMENT_STATUS_LABELS,
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  ROLE_LABELS,
  STATUS_LABELS,
  UNSCORED_LABEL,
  URGENCY_LABELS,
  categoryLabel,
  priorityLabel,
  roleLabel,
  statusLabel,
  urgencyLabel,
} from './domain-display';

/**
 * The maps are typed as total `Record<Enum, …>`, so a missing entry is already
 * a compile error. These tests cover what the type cannot: that no label leaks
 * a raw `SCREAMING_SNAKE` value to a user, and that "not yet scored" stays
 * distinguishable from "ranked lowest".
 */
describe('enum coverage', () => {
  it.each([
    ['ReportStatus', Object.values(ReportStatus), STATUS_LABELS],
    ['PriorityBand', Object.values(PriorityBand), PRIORITY_LABELS],
    ['AssignmentStatus', Object.values(AssignmentStatus), ASSIGNMENT_STATUS_LABELS],
    ['UserRole', Object.values(UserRole), ROLE_LABELS],
  ])('gives every %s value a human label', (_name, values, labels) => {
    for (const value of values) {
      const label = (labels as Record<string, { label: string }>)[value]?.label;
      expect(label, value).toBeTruthy();
      expect(label, value).not.toMatch(/_/);
      expect(label, value).not.toBe(value);
    }
  });

  it.each([
    ['Category', Object.values(Category), CATEGORY_LABELS],
    ['Urgency', Object.values(Urgency), URGENCY_LABELS],
  ])('gives every %s value a human label', (_name, values, labels) => {
    for (const value of values) {
      const label = (labels as Record<string, string>)[value];
      expect(label, value).toBeTruthy();
      expect(label, value).not.toMatch(/_/);
      expect(label, value).not.toBe(value);
    }
  });
});

describe('priorityLabel', () => {
  it('returns a distinct, non-P3 treatment for an unscored report', () => {
    const unscored = priorityLabel(null);
    expect(unscored).toBe(UNSCORED_LABEL);
    expect(unscored.tone).not.toBe(PRIORITY_LABELS[PriorityBand.P3].tone);
  });

  it('describes what each band means, not just what it is called', () => {
    // Legends, tooltips, and accessible names read these; "P0" alone carries no
    // urgency to anyone who has not been trained on the scale.
    for (const band of Object.values(PriorityBand)) {
      expect(PRIORITY_LABELS[band].description.length, band).toBeGreaterThan(10);
    }
  });
});

describe('categories', () => {
  it('assigns no severity tone to any category', () => {
    // Colour means severity, everywhere. Two competing colour languages on one
    // screen would cost the one that matters (ADR-0054).
    expect(Object.values(CATEGORY_LABELS).every((value) => typeof value === 'string')).toBe(true);
  });
});

describe('fallbacks for absent values', () => {
  it('names the absent case rather than rendering nothing', () => {
    expect(categoryLabel(null)).toBe('Unclassified');
    expect(urgencyLabel(null)).toBe('Unassessed');
    expect(roleLabel(null)).toBe('Guest');
    expect(statusLabel(null)).toBe('Unknown');
  });
});

describe('statusLabel', () => {
  it('falls back to the stored value for a status this build does not know', () => {
    // Audit events store statuses as free-form strings, so a record written
    // under an older vocabulary can name one that no longer exists. Losing it
    // would mean an audit trail dropping information it already holds.
    expect(statusLabel('SOME_RETIRED_STATUS')).toBe('SOME_RETIRED_STATUS');
    expect(statusLabel(ReportStatus.NEEDS_VERIFICATION)).toBe('Needs verification');
  });
});

describe('urgency vs priority', () => {
  it('keeps urgency free of severity tones', () => {
    // Urgency is the AI's assessment; the band is the deterministic score's
    // verdict. Colouring urgency on the severity scale would imply a second,
    // competing ranking beside the real one.
    expect(Object.values(URGENCY_LABELS)).toEqual(['Critical', 'High', 'Medium', 'Low']);
  });
});
