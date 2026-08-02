import { describe, expect, it } from 'vitest';

import { Category, Urgency } from './domain';
import {
  LOCATION_HINT_MAX_LENGTH,
  REPORT_TEXT_MAX_LENGTH,
  REPORT_TEXT_MIN_LENGTH,
  createEmptyReportDraft,
  isReportDraftSubmittable,
  toReportSubmission,
  toSubmissionText,
  validateReportDraft,
  type ReportDraft,
} from './report-form';

function submittableDraft(overrides: Partial<ReportDraft> = {}): ReportDraft {
  return {
    ...createEmptyReportDraft(),
    text: 'Collapsed wall, two people trapped near the market.',
    category: Category.RESCUE,
    urgency: Urgency.CRITICAL,
    ...overrides,
  };
}

describe('validateReportDraft', () => {
  it('flags every required field on an empty draft', () => {
    const errors = validateReportDraft(createEmptyReportDraft());
    expect(Object.keys(errors).sort()).toEqual(['category', 'text', 'urgency']);
  });

  it('accepts a complete draft', () => {
    expect(validateReportDraft(submittableDraft())).toEqual({});
    expect(isReportDraftSubmittable(submittableDraft())).toBe(true);
  });

  it('rejects a description at or below the minimum length after trimming', () => {
    const padded = `  ${'x'.repeat(REPORT_TEXT_MIN_LENGTH)}  `;
    expect(validateReportDraft(submittableDraft({ text: padded }))).toHaveProperty('text');
    expect(
      validateReportDraft(submittableDraft({ text: 'x'.repeat(REPORT_TEXT_MIN_LENGTH + 1) })),
    ).toEqual({});
  });

  it('rejects a description above the maximum length', () => {
    const oversized = 'x'.repeat(REPORT_TEXT_MAX_LENGTH + 1);
    expect(validateReportDraft(submittableDraft({ text: oversized }))).toHaveProperty('text');
  });

  it('treats subcategory and contact as optional', () => {
    expect(validateReportDraft(submittableDraft({ subcategory: '', contact: '' }))).toEqual({});
  });

  it('treats location and locationHint as optional', () => {
    expect(validateReportDraft(submittableDraft({ location: null, locationHint: '' }))).toEqual({});
  });

  it('rejects a location hint above the maximum length', () => {
    const oversized = 'x'.repeat(LOCATION_HINT_MAX_LENGTH + 1);
    expect(validateReportDraft(submittableDraft({ locationHint: oversized }))).toHaveProperty(
      'locationHint',
    );
  });
});

describe('toReportSubmission', () => {
  it('throws on a draft that is not submittable', () => {
    expect(() => toReportSubmission(createEmptyReportDraft())).toThrow(/not submittable/);
  });

  it('trims text and normalizes empty optionals to null', () => {
    const submission = toReportSubmission(
      submittableDraft({ text: '  Bridge out on route 9, cars backed up.  ', subcategory: '  ' }),
    );
    expect(submission.text).toBe('Bridge out on route 9, cars backed up.');
    expect(submission.subcategory).toBeNull();
    expect(submission.contact).toBeNull();
  });

  it('strips contact data when the report is anonymous', () => {
    const submission = toReportSubmission(
      submittableDraft({ anonymous: true, contact: '+90 555 000 0000' }),
    );
    expect(submission.anonymous).toBe(true);
    expect(submission.contact).toBeNull();
  });

  it('keeps trimmed contact data on a non-anonymous report', () => {
    const submission = toReportSubmission(
      submittableDraft({ anonymous: false, contact: ' reporter@example.org ' }),
    );
    expect(submission.contact).toBe('reporter@example.org');
  });

  it('defaults mediaKeys to an empty array when omitted', () => {
    const submission = toReportSubmission(submittableDraft());
    expect(submission.mediaKeys).toEqual([]);
  });

  it('passes through the provided mediaKeys', () => {
    const submission = toReportSubmission(submittableDraft(), ['reports/abc/photo.jpg']);
    expect(submission.mediaKeys).toEqual(['reports/abc/photo.jpg']);
  });

  it('maps a resolved location to lat/lng, or null when uncaptured', () => {
    const withLocation = toReportSubmission(
      submittableDraft({ location: { lat: 41.0082, lng: 28.9784 } }),
    );
    expect(withLocation.lat).toBe(41.0082);
    expect(withLocation.lng).toBe(28.9784);

    const without = toReportSubmission(submittableDraft({ location: null }));
    expect(without.lat).toBeNull();
    expect(without.lng).toBeNull();
  });

  it('trims the location hint and normalizes blank to null', () => {
    const hinted = toReportSubmission(
      submittableDraft({ locationHint: '  near the blue bridge  ' }),
    );
    expect(hinted.locationHint).toBe('near the blue bridge');

    const blank = toReportSubmission(submittableDraft({ locationHint: '   ' }));
    expect(blank.locationHint).toBeNull();
  });
});

describe('toSubmissionText', () => {
  it('appends citizen selections as a delimited hint block', () => {
    const text = toSubmissionText(toReportSubmission(submittableDraft()));
    expect(text).toBe(
      'Collapsed wall, two people trapped near the market.\n\n' +
        '[Citizen selections — category: RESCUE; urgency: CRITICAL]',
    );
  });

  it('includes the supply hint only when a subcategory was given', () => {
    const text = toSubmissionText(toReportSubmission(submittableDraft({ subcategory: 'Water' })));
    expect(text).toContain('supply: Water');
  });

  it('includes the location hint only when one was given', () => {
    const withHint = toSubmissionText(
      toReportSubmission(submittableDraft({ locationHint: 'near the blue bridge' })),
    );
    expect(withHint).toContain('location hint: near the blue bridge');

    const without = toSubmissionText(toReportSubmission(submittableDraft()));
    expect(without).not.toContain('location hint');
  });
});
