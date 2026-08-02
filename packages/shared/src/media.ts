/**
 * CrisisMap AI — report media upload contract (CRIS-17).
 *
 * Shared between the presigned-upload Lambda (server-side enforcement, the
 * only place that actually matters for security) and both clients
 * (client-side pre-flight checks, so a citizen finds out a photo is too big
 * or the wrong type before spending time on an upload that S3 will reject
 * anyway). Keep the two enforcement points in step.
 */

/** Content types the upload pipeline accepts. Images only — design doc §4. */
export const ALLOWED_MEDIA_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type MediaContentType = (typeof ALLOWED_MEDIA_CONTENT_TYPES)[number];

/** Hard cap on a single upload. Enforced by S3 itself via the presigned POST policy. */
export const MAX_MEDIA_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export function isAllowedMediaContentType(contentType: string): contentType is MediaContentType {
  return (ALLOWED_MEDIA_CONTENT_TYPES as readonly string[]).includes(contentType);
}

/** File extension for a given content type, used to name the S3 object key. */
export function extensionForContentType(contentType: MediaContentType): string {
  switch (contentType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
  }
}

/**
 * Normalizes `createMediaUploadUrl`'s `fields` return value into a plain
 * object, whether the GraphQL `a.json()` scalar comes back already parsed or
 * as a raw JSON string (both are legitimate depending on client/codegen
 * version). This matters a lot more than it looks: iterating a *string* with
 * `Object.entries` doesn't throw — it silently walks it character by
 * character, turning ~6 real form fields into hundreds of one-character
 * fields. Each gets its own multipart boundary/header, which is exactly what
 * blows the presigned POST past S3's fixed 20 KB pre-file-fields cap
 * (`MaxPostPreDataLengthExceeded`) — discovered live chasing that error.
 */
export function parseMediaUploadFields(fields: unknown): Record<string, string> {
  const parsed = typeof fields === 'string' ? JSON.parse(fields) : fields;
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('createMediaUploadUrl returned malformed fields.');
  }
  return parsed as Record<string, string>;
}
