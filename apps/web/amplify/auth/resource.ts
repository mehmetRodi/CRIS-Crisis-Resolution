import { defineAuth } from '@aws-amplify/backend';

/**
 * Cognito authentication (design doc §5.6).
 *
 * STUB — TODO(CRIS-7): full authentication + anonymous submission wiring.
 * Left to do here:
 *   - Guest / unauthenticated identities for anonymous citizen reports (§2.1).
 *   - Group-scoped resource authorization at the data/storage layers.
 *   - Any external identity providers (deferred; Cognito-only for MVP per §1.2).
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
