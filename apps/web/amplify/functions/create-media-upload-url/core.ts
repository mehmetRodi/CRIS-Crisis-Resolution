/**
 * createMediaUploadUrl — pure business logic (CRIS-17, design doc §4).
 *
 * Builds the S3 object key and upload constraints for a citizen's media
 * upload. Deliberately AWS-SDK-free (no actual presign call here) so it's
 * unit-testable in isolation — `handler.ts` calls `createPresignedPost` with
 * this plan's `key`/`contentType`/`maxSizeBytes`.
 *
 * The key is scoped by `clientRequestId`, not a report id: a photo is picked
 * (and must upload) before `submitReport` has ever run, so no report id
 * exists yet. `clientRequestId` is already minted client-side at that point
 * (§5.4.4) and is reused across retries of the same report, giving every
 * upload a stable, collision-resistant prefix without waiting on the report.
 */
import { randomUUID } from 'node:crypto';
import {
  ALLOWED_MEDIA_CONTENT_TYPES,
  MAX_MEDIA_FILE_SIZE_BYTES,
  extensionForContentType,
  isAllowedMediaContentType,
  type MediaContentType,
} from '@crisismap/shared';

export interface CreateMediaUploadUrlInput {
  clientRequestId: string;
  contentType: string;
}

export class MediaUploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaUploadValidationError';
  }
}

export function validateMediaUploadInput(input: CreateMediaUploadUrlInput): void {
  if (!input.clientRequestId || input.clientRequestId.trim().length === 0) {
    throw new MediaUploadValidationError('clientRequestId is required.');
  }
  if (!isAllowedMediaContentType(input.contentType)) {
    throw new MediaUploadValidationError(
      `contentType must be one of: ${ALLOWED_MEDIA_CONTENT_TYPES.join(', ')}.`,
    );
  }
}

export interface MediaUploadPlan {
  /** S3 object key the presigned POST will be scoped to. */
  key: string;
  contentType: MediaContentType;
  /** Enforced by the presigned POST policy itself, not just client-side. */
  maxSizeBytes: number;
}

/**
 * Validate the input and build the upload plan. `mediaId` is a parameter (not
 * generated inline) so key construction is deterministic and testable.
 */
export function buildMediaUploadPlan(
  input: CreateMediaUploadUrlInput,
  mediaId: string = randomUUID(),
): MediaUploadPlan {
  validateMediaUploadInput(input);
  const contentType = input.contentType as MediaContentType; // validated above
  const ext = extensionForContentType(contentType);
  return {
    key: `reports/${input.clientRequestId}/${mediaId}.${ext}`,
    contentType,
    maxSizeBytes: MAX_MEDIA_FILE_SIZE_BYTES,
  };
}
