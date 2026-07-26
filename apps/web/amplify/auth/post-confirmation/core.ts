/**
 * Pure logic for the `postConfirmation` trigger (CRIS-24) — isolated from the AWS
 * SDK call so it's unit-testable without mocking Cognito, mirroring the
 * handler/core split used by the other functions (e.g. `transition-report`).
 */

/**
 * `postConfirmation` fires for both `PostConfirmation_ConfirmSignUp` and
 * `PostConfirmation_ConfirmForgotPassword`. Only a fresh sign-up should get the
 * default `CITIZEN` group — a password reset must never re-grant or alter it.
 */
export function shouldAutoAssignCitizen(triggerSource: string): boolean {
  return triggerSource === 'PostConfirmation_ConfirmSignUp';
}
