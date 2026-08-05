import { defineFunction } from '@aws-amplify/backend';

/**
 * Cognito citizen-role assignment function (CRIS-24, design doc §5.6).
 *
 * Runs after sign-up confirmation to assign `CITIZEN`, and after authentication
 * to reconcile a transient confirmation-time failure. The authentication path
 * leaves accounts with any existing application role untouched. Staff groups
 * (`VOLUNTEER`/`RESPONDER`/`COORDINATOR`/`ADMIN`) remain admin-assigned.
 *
 * The Cognito grants are set in `backend.ts` and restricted to user pools in the
 * deployment account and region without referencing this pool's generated ID.
 *
 * Pinned to the `auth` stack (`resourceGroupName: 'auth'`) because both trigger
 * registrations belong to the User Pool lifecycle. The IAM policy deliberately
 * avoids referencing the pool's generated ARN, which would create a circular
 * resource dependency inside this stack.
 */
export const citizenRoleAssignment = defineFunction({
  name: 'citizen-role-assignment',
  entry: './handler.ts',
  timeoutSeconds: 10,
  memoryMB: 128,
  resourceGroupName: 'auth',
});
