import {
  ALLOWED_MEDIA_CONTENT_TYPES,
  MAX_MEDIA_FILE_SIZE_BYTES,
  isAllowedMediaContentType,
  parseMediaUploadFields,
} from '@crisismap/shared';

import { client } from './amplify';

/**
 * Client side of the CRIS-17 presigned-upload path. Mirrors
 * `apps/mobile/src/lib/media-upload.ts` — same mutation, same validation —
 * but on web primitives (`File`, `fetch`/`FormData`).
 *
 * Never log the file or its contents — media can depict identifiable people
 * or locations tied to a report before it's redacted (§5.6).
 */
export class MediaUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaUploadError';
  }
}

/**
 * Uploads a single photo and returns its S3 object key, ready to pass into
 * `submitReport`'s `mediaKeys`.
 *
 * The client-side *size* check is a fast-fail courtesy — the presigned POST's
 * `content-length-range` enforces it server-side regardless. The *type* check
 * matters more than it looks: the policy pins whatever content type we send, so
 * a wrong type here would be signed and accepted (`File.type` is browser-derived
 * rather than caller-supplied, so this is sound on web; mobile has to work
 * harder — see `apps/mobile/src/lib/media-upload.ts`).
 */
export async function uploadReportMedia(file: File, clientRequestId: string): Promise<string> {
  if (!isAllowedMediaContentType(file.type)) {
    throw new MediaUploadError(
      `Unsupported file type. Allowed: ${ALLOWED_MEDIA_CONTENT_TYPES.join(', ')}.`,
    );
  }
  if (file.size > MAX_MEDIA_FILE_SIZE_BYTES) {
    const maxMb = Math.floor(MAX_MEDIA_FILE_SIZE_BYTES / (1024 * 1024));
    throw new MediaUploadError(`Photo is too large. Maximum size is ${maxMb} MB.`);
  }

  const { data, errors } = await client.mutations.createMediaUploadUrl(
    { clientRequestId, contentType: file.type },
    { authMode: 'identityPool' },
  );
  if ((errors && errors.length > 0) || !data) {
    throw new MediaUploadError(errors?.[0]?.message ?? 'Could not prepare the photo upload.');
  }

  const formData = new FormData();
  const fields = parseMediaUploadFields(data.fields);
  for (const [name, value] of Object.entries(fields)) {
    formData.append(name, value);
  }
  formData.append('file', file); // S3 requires the file field last.

  // `fetch` rejects (rather than returning !ok) when the request never gets a
  // response at all — offline, DNS failure, or an S3 error whose response is
  // missing CORS headers. That surfaces as a bare "TypeError: Failed to fetch",
  // which is not something to show a citizen mid-emergency.
  let response: Response;
  try {
    response = await fetch(data.url, { method: 'POST', body: formData });
  } catch {
    throw new MediaUploadError(
      'The photo upload could not reach the server. Check your connection and try again.',
    );
  }
  if (!response.ok) {
    throw new MediaUploadError('The photo upload failed. Please try again.');
  }

  return data.key;
}
