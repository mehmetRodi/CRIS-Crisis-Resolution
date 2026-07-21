import { defineAuth } from '@aws-amplify/backend';

/**
 * Cognito authentication (design doc §5.6, ADR-0024).
 *
 * Sign-in is optional (ADR-0024): named accounts use this Cognito User Pool,
 * but citizens can submit anonymously as Identity Pool guests. Guest access
 * needs no extra config here — Amplify Gen 2 provisions the unauthenticated
 * Identity Pool role automatically from the `allow.guest()` rules already on
 * `submitReport` (`amplify/data/resource.ts`) and report media
 * (`amplify/storage/resource.ts`).
 *
 * Deferred, not part of CRIS-7:
 *   - Automatic group assignment for self-signed-up users (all group
 *     membership — including CITIZEN — is manual/admin-assigned for now).
 *   - External identity providers (Cognito-only for MVP per §1.2).
 *
 * The five groups mirror the roles in `@crisismap/shared` (UserRole). Keep this
 * list in sync with that enum.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  groups: ['CITIZEN', 'VOLUNTEER', 'RESPONDER', 'COORDINATOR', 'ADMIN'],
});
