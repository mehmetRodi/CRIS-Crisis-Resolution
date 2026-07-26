import { defineAuth } from '@aws-amplify/backend';
import { postConfirmation } from './post-confirmation/resource';

/**
 * Cognito authentication (design doc §5.6, ADR-0024, ADR-0040).
 *
 * Sign-in is optional (ADR-0024): named accounts use this Cognito User Pool,
 * but citizens can submit anonymously as Identity Pool guests. Guest access
 * needs no extra config here — Amplify Gen 2 provisions the unauthenticated
 * Identity Pool role automatically from the `allow.guest()` rules already on
 * `submitReport` (`amplify/data/resource.ts`) and report media
 * (`amplify/storage/resource.ts`).
 *
 * `postConfirmation` (CRIS-24, ADR-0040) auto-assigns the `CITIZEN` group to
 * every self-signed-up user — closing the ADR-0024 gap where a fresh account
 * had no group at all. Staff groups remain manual/admin-assigned.
 *
 * Deferred:
 *   - A staff invite / self-service role-request flow.
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
  triggers: {
    postConfirmation,
  },
});
