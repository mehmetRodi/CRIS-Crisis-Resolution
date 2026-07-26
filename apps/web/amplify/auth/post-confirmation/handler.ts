/**
 * postConfirmation trigger (CRIS-24) — auto-assigns `CITIZEN` on self sign-up.
 *
 * Before this, every self-signed-up user (web `SignupPage`, mobile `SignupScreen`)
 * landed with NO Cognito group at all (ADR-0024 deferred this). `CITIZEN` is the
 * only group anyone can reach by self-service — every other role
 * (`VOLUNTEER`/`RESPONDER`/`COORDINATOR`/`ADMIN`) stays admin-assigned, since
 * granting staff authority can't be a side effect of confirming an email address.
 *
 * Cognito ignores whatever a trigger returns beyond the required shape, but a
 * *thrown* error blocks the user's confirmation outright — so a transient
 * `AdminAddUserToGroup` failure (network blip, throttling) must never fail the
 * sign-up flow itself. Log and continue; the user ends up confirmed but
 * group-less, same as before this trigger existed, rather than locked out.
 *
 * Only runs on the initial sign-up confirmation, not `ConfirmForgotPassword`
 * (postConfirmation fires for both `triggerSource`s).
 */
import type { PostConfirmationTriggerHandler } from 'aws-lambda';
import {
  AdminAddUserToGroupCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { UserRole } from '@crisismap/shared';
import { shouldAutoAssignCitizen } from './core';

const client = new CognitoIdentityProviderClient({});

export const handler: PostConfirmationTriggerHandler = async (event) => {
  if (!shouldAutoAssignCitizen(event.triggerSource)) {
    return event;
  }

  try {
    await client.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: event.userPoolId,
        Username: event.userName,
        GroupName: UserRole.CITIZEN,
      }),
    );
  } catch (err) {
    console.error('Failed to auto-assign CITIZEN group', {
      userPoolId: event.userPoolId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return event;
};
