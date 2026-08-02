import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const createMediaUploadUrl = vi.fn();
vi.mock('./amplify', () => ({
  client: {
    mutations: { createMediaUploadUrl: (...args: unknown[]) => createMediaUploadUrl(...args) },
  },
}));

import { MediaUploadError, uploadReportMedia } from './media-upload';

function makeFile(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

describe('uploadReportMedia', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    createMediaUploadUrl.mockReset();
    global.fetch = vi.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('rejects an unsupported content type without calling the mutation', async () => {
    const file = makeFile('doc.pdf', 'application/pdf', 100);
    await expect(uploadReportMedia(file, 'req-1')).rejects.toThrow(MediaUploadError);
    expect(createMediaUploadUrl).not.toHaveBeenCalled();
  });

  it('rejects an oversized file without calling the mutation', async () => {
    const file = makeFile('big.jpg', 'image/jpeg', 11 * 1024 * 1024);
    await expect(uploadReportMedia(file, 'req-1')).rejects.toThrow(/too large/i);
    expect(createMediaUploadUrl).not.toHaveBeenCalled();
  });

  it('uploads via the presigned POST and returns the key', async () => {
    createMediaUploadUrl.mockResolvedValue({
      data: {
        url: 'https://bucket.s3.example/',
        fields: { key: 'reports/req-1/a.jpg' },
        key: 'reports/req-1/a.jpg',
      },
      errors: null,
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    const file = makeFile('photo.jpg', 'image/jpeg', 1024);
    const key = await uploadReportMedia(file, 'req-1');

    expect(key).toBe('reports/req-1/a.jpg');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://bucket.s3.example/',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('parses fields returned as a JSON string instead of iterating its characters', async () => {
    // Regression test: AppSync's a.json() scalar can come back as a raw JSON
    // string rather than an already-parsed object. Object.entries on a string
    // silently walks it character-by-character instead of throwing, which
    // blew a real upload past S3's MaxPostPreDataLengthExceeded cap.
    const realFields = { key: 'reports/req-1/a.jpg', policy: 'abc', 'x-amz-signature': 'def' };
    createMediaUploadUrl.mockResolvedValue({
      data: {
        url: 'https://bucket.s3.example/',
        fields: JSON.stringify(realFields),
        key: 'reports/req-1/a.jpg',
      },
      errors: null,
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    const file = makeFile('photo.jpg', 'image/jpeg', 1024);
    await uploadReportMedia(file, 'req-1');

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    const [, options] = call;
    const sentFormData = options.body as FormData;
    const entries = Array.from(sentFormData.entries());
    // 3 real fields + the file, not hundreds of one-character fields.
    expect(entries).toHaveLength(4);
    expect(sentFormData.get('key')).toBe('reports/req-1/a.jpg');
    expect(sentFormData.get('policy')).toBe('abc');
  });

  it('appends the file field last, after every policy field', async () => {
    // S3 rejects a presigned POST whose file part is not last, so this ordering
    // is a hard protocol requirement rather than a stylistic one. Without this
    // assertion, moving the append earlier breaks every real upload while the
    // rest of the suite stays green.
    createMediaUploadUrl.mockResolvedValue({
      data: {
        url: 'https://bucket.s3.example/',
        fields: { key: 'reports/req-1/a.jpg', policy: 'abc', 'x-amz-signature': 'def' },
        key: 'reports/req-1/a.jpg',
      },
      errors: null,
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    await uploadReportMedia(makeFile('photo.jpg', 'image/jpeg', 1024), 'req-1');

    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    const names = Array.from((options.body as FormData).entries()).map(([name]) => name);
    expect(names[names.length - 1]).toBe('file');
    expect(names.filter((n) => n === 'file')).toHaveLength(1);
  });

  it('requests the upload URL over the identity pool so guests can upload', async () => {
    // The web client defaults to the Cognito user pool. Anonymous reporting is
    // the primary path (ADR-0024), so dropping this override would break every
    // guest upload — the case least likely to be caught by hand-testing signed in.
    createMediaUploadUrl.mockResolvedValue({
      data: { url: 'https://bucket.s3.example/', fields: {}, key: 'reports/req-1/a.jpg' },
      errors: null,
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    await uploadReportMedia(makeFile('photo.jpg', 'image/jpeg', 1024), 'req-1');

    expect(createMediaUploadUrl).toHaveBeenCalledWith(
      expect.objectContaining({ clientRequestId: 'req-1', contentType: 'image/jpeg' }),
      { authMode: 'identityPool' },
    );
  });

  it('reports a reachability failure rather than leaking a raw fetch TypeError', async () => {
    // Offline, DNS failure, or an S3 error response missing CORS headers all
    // reject rather than resolving !ok — "TypeError: Failed to fetch" is not
    // something to render to a citizen mid-emergency.
    createMediaUploadUrl.mockResolvedValue({
      data: { url: 'https://bucket.s3.example/', fields: {}, key: 'reports/req-1/a.jpg' },
      errors: null,
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError('Failed to fetch'));

    const file = makeFile('photo.jpg', 'image/jpeg', 1024);
    await expect(uploadReportMedia(file, 'req-1')).rejects.toThrow(MediaUploadError);
    await expect(uploadReportMedia(file, 'req-1')).rejects.toThrow(/could not reach the server/i);
  });

  it('throws when the mutation returns errors', async () => {
    createMediaUploadUrl.mockResolvedValue({ data: null, errors: [{ message: 'nope' }] });
    const file = makeFile('photo.jpg', 'image/jpeg', 1024);
    await expect(uploadReportMedia(file, 'req-1')).rejects.toThrow('nope');
  });

  it('throws when the S3 upload itself fails', async () => {
    createMediaUploadUrl.mockResolvedValue({
      data: { url: 'https://bucket.s3.example/', fields: {}, key: 'reports/req-1/a.jpg' },
      errors: null,
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });

    const file = makeFile('photo.jpg', 'image/jpeg', 1024);
    await expect(uploadReportMedia(file, 'req-1')).rejects.toThrow(/upload failed/i);
  });
});
