import { defineStorage } from '@aws-amplify/backend';

/**
 * Report media storage (S3) — design doc §4 (Media storage).
 *
 * STUB — TODO(CRIS-17): pre-signed upload, quarantine bucket, and signed
 * (CloudFront) delivery per the design doc. The entity_id-scoped guest-write /
 * authenticated-read-write rule below is intentionally left coarse (ADR-0022)
 * — tighter owner/role scoping belongs with the presigned-upload rework.
 */
export const storage = defineStorage({
  name: 'crisismap-report-media',
  access: (allow) => ({
    'reports/{entity_id}/*': [allow.authenticated.to(['read', 'write']), allow.guest.to(['write'])],
  }),
});
