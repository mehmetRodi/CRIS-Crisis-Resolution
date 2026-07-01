import { defineStorage } from '@aws-amplify/backend';

/**
 * Report media storage (S3) — design doc §4 (Media storage).
 *
 * STUB — TODO: pre-signed upload, quarantine bucket, and signed (CloudFront)
 * delivery per the design doc. Access rules below are a coarse placeholder;
 * tighten to owner/role scoping with CRIS-7.
 */
export const storage = defineStorage({
  name: 'crisismap-report-media',
  access: (allow) => ({
    'reports/{entity_id}/*': [allow.authenticated.to(['read', 'write']), allow.guest.to(['write'])],
  }),
});
