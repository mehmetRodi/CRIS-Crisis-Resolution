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
export class MediaUploadError extends Error {}

/**
 * Uploads a single photo and returns its S3 object key, ready to pass into
 * `submitReport`'s `mediaKeys`. Client-side type/size checks are a fast-fail
 * courtesy — the presigned POST policy (`createMediaUploadUrl` handler)
 * enforces both server-side regardless.
 */
export async function uploadReportMedia(
  asset: ImagePickerAsset,
  clientRequestId: string,
): Promise<string> {
  const contentType = asset.mimeType ?? 'image/jpeg';
  if (!isAllowedMediaContentType(contentType)) {
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

  const response = await fetch(data.url, { method: 'POST', body: formData });
  if (!response.ok) {
    throw new MediaUploadError('The photo upload failed. Please try again.');
  }

  return data.key;
}
