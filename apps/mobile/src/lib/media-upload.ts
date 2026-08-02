import type { ImagePickerAsset } from 'expo-image-picker';
import {
  ALLOWED_MEDIA_CONTENT_TYPES,
  MAX_MEDIA_FILE_SIZE_BYTES,
  isAllowedMediaContentType,
  parseMediaUploadFields,
} from '@crisismap/shared';

import { client } from './amplify';

/**
 * Client side of the CRIS-17 presigned-upload path. Mirrors
 * `apps/web/src/lib/media-upload.ts` — same mutation, same validation — but
 * on React Native primitives (`ImagePickerAsset`'s local file `uri`, RN's
 * `FormData` file-descriptor upload instead of a `File`/`Blob`).
 *
 * Never log the asset or its contents — media can depict identifiable people
 * or locations tied to a report before it's redacted (§5.6).
 */
export class MediaUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaUploadError';
  }
}

/**
 * Resolve the asset's content type without ever guessing.
 *
 * expo-image-picker omits `mimeType` for some Android content-provider URIs and
 * some iOS paths. The previous `?? 'image/jpeg'` fallback was unsafe: the
 * presigned policy pins the very content type we claim here, so a mislabelled
 * HEIC or GIF satisfied S3's check and landed as a `.jpg` that may not render.
 * The server cannot catch this — it only ever sees our claim. So derive from the
 * file extension instead, and return null (reject) when even that is unknown.
 */
function resolveContentType(asset: ImagePickerAsset): string | null {
  if (asset.mimeType) return asset.mimeType;
  const extension = (asset.fileName ?? asset.uri).split('?')[0].split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return null;
}

/**
 * Uploads a single photo and returns its S3 object key, ready to pass into
 * `submitReport`'s `mediaKeys`.
 *
 * The client-side *size* check is a fast-fail courtesy — the presigned POST's
 * `content-length-range` enforces it server-side regardless. The *type* check is
 * not merely a courtesy: the policy pins whatever content type we send, so this
 * is the only place a wrong type can be caught (see `resolveContentType`).
 */
export async function uploadReportMedia(
  asset: ImagePickerAsset,
  clientRequestId: string,
): Promise<string> {
  const contentType = resolveContentType(asset);
  if (contentType === null || !isAllowedMediaContentType(contentType)) {
    throw new MediaUploadError(
      `Unsupported file type. Allowed: ${ALLOWED_MEDIA_CONTENT_TYPES.join(', ')}.`,
    );
  }
  if (asset.fileSize != null && asset.fileSize > MAX_MEDIA_FILE_SIZE_BYTES) {
    const maxMb = Math.floor(MAX_MEDIA_FILE_SIZE_BYTES / (1024 * 1024));
    throw new MediaUploadError(`Photo is too large. Maximum size is ${maxMb} MB.`);
  }

  const { data, errors } = await client.mutations.createMediaUploadUrl({
    clientRequestId,
    contentType,
  });
  if ((errors && errors.length > 0) || !data) {
    throw new MediaUploadError(errors?.[0]?.message ?? 'Could not prepare the photo upload.');
  }

  const formData = new FormData();
  const fields = parseMediaUploadFields(data.fields);
  for (const [name, value] of Object.entries(fields)) {
    formData.append(name, value);
  }
  // RN's FormData accepts a { uri, name, type } file descriptor in place of a
  // Blob — TS's DOM-derived FormData typing doesn't know this RN-specific
  // shape, hence the cast. Must be appended last (S3 requires the file field last).
  formData.append('file', {
    uri: asset.uri,
    name: asset.fileName ?? 'photo.jpg',
    type: contentType,
  } as unknown as Blob);

  // `fetch` rejects (rather than returning !ok) when the request never gets a
  // response at all — offline, DNS failure, or an S3 error whose CORS headers
  // are missing. RN surfaces that as a bare "Network request failed", which is
  // not something to show a citizen mid-emergency.
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
