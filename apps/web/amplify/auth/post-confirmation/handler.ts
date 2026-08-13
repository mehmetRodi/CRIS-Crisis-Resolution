/**
 * Cognito role-assignment triggers (CRIS-24) — auto-assign `CITIZEN` on self
 * sign-up and reconcile a failed assignment on the user's next authentication.
 *
 * Before this, every self-signed-up user (web `SignupPage`, mobile `SignupScreen`)
 * landed with NO Cognito group at all (ADR-0024 deferred this). `CITIZEN` is the
 * only group anyone can reach by self-service — every other role
 * (`VOLUNTEER`/`RESPONDER`/`COORDINATOR`/`ADMIN`) stays admin-assigned, since
 * granting staff authority can't be a side effect of confirming an email address.
 *
 * A transient `AdminAddUserToGroup` failure must not turn successful email
 * confirmation into an error page. The post-confirmation path therefore logs and
 * returns, while the post-authentication path checks for an existing application
 * role and retries the default assignment when the user is still role-less.
 *
 * Assignment runs on the initial sign-up confirmation and role reconciliation
 * runs after authentication. `ConfirmForgotPassword` never alters roles.
 */
import type { PostAuthenticationTriggerEvent, PostConfirmationTriggerEvent } from 'aws-lambda';
import {
  AdminAddUserToGroupCommand,
  AdminListGroupsForUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { UserRole } from '@crisismap/shared';
import { hasKnownRole, shouldEnsureCitizenRole } from './core';

const client = new CognitoIdentityProviderClient({});

type CitizenRoleEvent = PostConfirmationTriggerEvent | PostAuthenticationTriggerEvent;

export const handler = async (event: CitizenRoleEvent): Promise<CitizenRoleEvent> => {
  if (!shouldEnsureCitizenRole(event.triggerSource)) {
    return event;
  }

  try {
    // Authentication is the recovery path for a transient confirmation-time
    // failure. Do not add CITIZEN to an account that already has any application
    // role (for example an admin-created staff account).
    if (event.triggerSource === 'PostAuthentication_Authentication') {
      const existing = await client.send(
        new AdminListGroupsForUserCommand({
          UserPoolId: event.userPoolId,
          Username: event.userName,
        }),
      );
      if (hasKnownRole(existing.Groups, Object.values(UserRole))) {
        return event;
      }
    }

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
      triggerSource: event.triggerSource,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return event;
};
