import { describe, expect, it } from 'vitest';

import { MediaUploadValidationError, buildMediaUploadPlan, validateMediaUploadInput } from './core';

describe('validateMediaUploadInput', () => {
  it('accepts a valid input', () => {
    expect(() =>
      validateMediaUploadInput({ clientRequestId: 'req-1', contentType: 'image/jpeg' }),
    ).not.toThrow();
  });

  it('rejects a missing clientRequestId', () => {
    expect(() =>
      validateMediaUploadInput({ clientRequestId: '', contentType: 'image/jpeg' }),
    ).toThrow(MediaUploadValidationError);
  });

  it('rejects a blank clientRequestId', () => {
    expect(() =>
      validateMediaUploadInput({ clientRequestId: '   ', contentType: 'image/jpeg' }),
    ).toThrow(MediaUploadValidationError);
  });

  it('rejects a disallowed content type', () => {
    expect(() =>
      validateMediaUploadInput({ clientRequestId: 'req-1', contentType: 'application/pdf' }),
    ).toThrow(/contentType must be one of/);
  });
});

describe('buildMediaUploadPlan', () => {
  it('builds a key scoped by clientRequestId with the matching extension', () => {
    const plan = buildMediaUploadPlan(
      { clientRequestId: 'req-123', contentType: 'image/png' },
      'media-1',
    );
    expect(plan.key).toBe('reports/req-123/media-1.png');
    expect(plan.contentType).toBe('image/png');
    expect(plan.maxSizeBytes).toBeGreaterThan(0);
  });

  it('mints a random media id when none is given', () => {
    const a = buildMediaUploadPlan({ clientRequestId: 'req-1', contentType: 'image/jpeg' });
    const b = buildMediaUploadPlan({ clientRequestId: 'req-1', contentType: 'image/jpeg' });
    expect(a.key).not.toBe(b.key);
  });

  it('throws on invalid input rather than building a plan', () => {
    expect(() =>
      buildMediaUploadPlan({ clientRequestId: '', contentType: 'image/png' }),
    ).toThrow(MediaUploadValidationError);
  });
});
