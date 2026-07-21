/**
 * Client-side password policy shared by the web and mobile sign-up surfaces
 * (CRIS-7, ADR-0024) so both enforce the same rule and show the same message
 * from one source of truth — the same reason the report-form core is shared
 * (ADR-0021).
 *
 * This is a UX pre-check only, to fail fast before hitting Cognito. Cognito's
 * User Pool policy remains the authority; keep this rule in sync with (or
 * looser than) that policy so a password this accepts is never rejected only
 * by the backend.
 */

export const PASSWORD_MIN_LENGTH = 8;

/** Human-readable statement of the rule, shown as a hint and on failure. */
export const PASSWORD_RULE_HINT =
  'At least 8 characters, with an uppercase letter, a lowercase letter, and a number.';

/** True when `pw` satisfies the minimum client-side password policy. */
export function isPasswordValid(pw: string): boolean {
  return (
    pw.length >= PASSWORD_MIN_LENGTH && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw)
  );
}
