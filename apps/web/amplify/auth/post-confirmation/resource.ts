import { defineFunction } from '@aws-amplify/backend';

/**
 * `postConfirmation` Cognito trigger (CRIS-24, design doc §5.6).
 *
 * Fires once, right after a self-signed-up user confirms their email. Auto-assigns
 * the `CITIZEN` group so a named account is never group-less — see `handler.ts` for
 * why `CITIZEN` specifically. Staff groups (`VOLUNTEER`/`RESPONDER`/`COORDINATOR`/
 * `ADMIN`) remain admin-assigned; no invite flow exists yet.
 *
 * The `cognito-idp:AdminAddUserToGroup` grant is set in `backend.ts` (scoped to this
 * User Pool's ARN, which doesn't exist until auth is synthesized).
 *
 * Pinned to the `auth` stack (`resourceGroupName: 'auth'`): `auth` wires this function
 * as a trigger (needs the function's ARN) and the function's IAM grant needs the User
 * Pool's ARN back from `auth` — opposing edges that CloudFormation rejects as a
 * nested-stack cycle unless both live in the same stack (same fix as `classify-report`
 * vs. the `data` stack, ADR-0031).
 */
export const postConfirmation = defineFunction({
  name: 'post-confirmation',
  entry: './handler.ts',
  timeoutSeconds: 10,
  memoryMB: 128,
  resourceGroupName: 'auth',
});
