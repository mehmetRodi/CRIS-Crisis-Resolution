import { defineStorage } from '@aws-amplify/backend';

/**
 * Report media storage (S3) — design doc §4 (Media storage).
 *
 * Uploads go through the presigned-POST `createMediaUploadUrl` mutation
 * (CRIS-17) exclusively — the Lambda's own IAM role is granted `s3:PutObject`
 * directly (`backend.ts`), not through this `access` block. Guests and
 * authenticated citizens therefore get NO direct write access here: writing
 * straight to the bucket via the Storage SDK would bypass the presigned
 * policy's enforced content-type/size limits entirely.
 *
 * Read is group-scoped, NOT `allow.authenticated` (ADR-0035 §4). Because the
 * key is now scoped by `clientRequestId` rather than identity, the old
 * `reports/{entity_id}/*` owner-scoping no longer matches anything — so an
 * `authenticated` rule here would mean *every* signed-in account, and sign-up
 * is open with group membership assigned manually. A fresh self-registered
 * user would have been able to read every citizen's photo.
 *
 * `VOLUNTEER` is deliberately excluded: `TRANSITION_ROLES` grants volunteers no
 * report authority at all, and design doc §2.5 places them with citizens
 * ("confirm reports they have witnessed") rather than with official responders.
 * Volunteer access to scene imagery should be earned per assignment and per
 * region, which a bucket-wide group grant cannot express — see ADR-0039 and
 * the deferred signed-delivery work below.
 *
 * Quarantine bucket / antivirus scanning and signed CloudFront delivery
 * remain deferred — out of scope for CRIS-17 (presigned upload only).
 */
export const storage = defineStorage({
  name: 'crisismap-report-media',
  access: (allow) => ({
    'reports/*': [allow.groups(['RESPONDER', 'COORDINATOR', 'ADMIN']).to(['read'])],
  }),
});
