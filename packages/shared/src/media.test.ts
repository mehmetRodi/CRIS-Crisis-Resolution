import { describe, expect, it } from 'vitest';

import {
  ALLOWED_MEDIA_CONTENT_TYPES,
  extensionForContentType,
  isAllowedMediaContentType,
  parseMediaUploadFields,
} from './media';

describe('isAllowedMediaContentType', () => {
  it('accepts every allowed content type', () => {
    for (const type of ALLOWED_MEDIA_CONTENT_TYPES) {
      expect(isAllowedMediaContentType(type)).toBe(true);
    }
  });

  it('rejects unlisted content types', () => {
    expect(isAllowedMediaContentType('application/pdf')).toBe(false);
    expect(isAllowedMediaContentType('image/gif')).toBe(false);
    expect(isAllowedMediaContentType('')).toBe(false);
  });
});

describe('extensionForContentType', () => {
  it('maps each allowed type to its extension', () => {
    expect(extensionForContentType('image/jpeg')).toBe('jpg');
    expect(extensionForContentType('image/png')).toBe('png');
    expect(extensionForContentType('image/webp')).toBe('webp');
  });
});

describe('parseMediaUploadFields', () => {
  const expected = { key: 'reports/req-1/a.jpg', policy: 'abc', 'x-amz-signature': 'def' };

  it('passes through an already-parsed object unchanged', () => {
    expect(parseMediaUploadFields(expected)).toEqual(expected);
  });

  it('parses a JSON-string value instead of iterating its characters', () => {
    expect(parseMediaUploadFields(JSON.stringify(expected))).toEqual(expected);
  });

  it('throws on null', () => {
    expect(() => parseMediaUploadFields(null)).toThrow();
  });

  it('throws on a non-JSON string', () => {
    expect(() => parseMediaUploadFields('not json')).toThrow();
  });
});
