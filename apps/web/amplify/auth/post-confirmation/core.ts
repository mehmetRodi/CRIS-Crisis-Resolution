/**
 * Pure logic for the Cognito role-assignment triggers (CRIS-24) — isolated from
 * the AWS SDK calls so it's unit-testable without mocking Cognito, mirroring the
 * handler/core split used by the other functions (e.g. `transition-report`).
 */

/**
 * Assign on initial confirmation, then reconcile a previously failed assignment
 * on authentication. Password resets must never alter group membership.
 */
export function shouldEnsureCitizenRole(triggerSource: string): boolean {
  return (
    triggerSource === 'PostConfirmation_ConfirmSignUp' ||
    triggerSource === 'PostAuthentication_Authentication'
  );
}

/** True when Cognito already reports at least one application role for a user. */
export function hasKnownRole(
  groups: readonly { GroupName?: string | undefined }[] | undefined,
  knownRoles: readonly string[],
): boolean {
  return (
    groups?.some((group) => group.GroupName != null && knownRoles.includes(group.GroupName)) ??
    false
  );
}
