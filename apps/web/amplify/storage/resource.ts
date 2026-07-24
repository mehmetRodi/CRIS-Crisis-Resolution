import { defineStorage } from '@aws-amplify/backend';

/**
 * Report media storage (S3) — design doc §4 (Media storage).
 *
 * Uploads go through the presigned-POST `createMediaUploadUrl` mutation
 * (CRIS-17) exclusively — the Lambda's own IAM role is granted `s3:PutObject`
 * directly (`backend.ts`), not through this `access` block. Guests and
 * authenticated citizens therefore get NO direct write access here: writing
 * straight to the bucket via the Storage SDK would bypass the presigned
 * policy's enforced content-type/size limits entirely. Read access stays
 * broad for authenticated staff (coordinators/responders/volunteers) viewing
 * report photos.
 *
 * Quarantine bucket / antivirus scanning and signed CloudFront delivery
 * remain deferred — out of scope for CRIS-17 (presigned upload only).
 */
export const storage = defineStorage({
  name: 'crisismap-report-media',
  access: (allow) => ({
    'reports/*': [allow.authenticated.to(['read'])],
  }),
});
