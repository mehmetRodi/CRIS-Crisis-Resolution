# ADR-0054: Password reset (web + mobile)

- **Status:** Accepted
- **Date:** 2026-08-21
- **Deciders:** Team

## Context

Neither client had a way for a citizen or staff user to recover a forgotten password —
`LoginPage`/`LoginScreen` had no "forgot password" link, no route/screen existed on either
platform, and `AuthContext` (web and mobile) wrapped `signIn`/`signUp`/`confirmSignUp`/
`resendSignUpCode` but never Cognito's `resetPassword`/`confirmResetPassword`. No configuration
change was needed on the Cognito side: `loginWith: { email: true }` with no other login
mechanism means the User Pool's account-recovery path is already email-based by default.

## Decision

1. **Two-step flow, two pages/screens per platform** — a request step (enter email) and a
   confirm step (enter the emailed code + new password) — mirroring the existing `SignupPage` →
   `ConfirmSignupPage` two-step precedent already established in both clients, rather than one
   combined page. The email is carried from the request step to the confirm step via router/
   navigation state (`location.state?.email` on web, a route param on mobile), the same
   mechanism `ConfirmSignupPage`/`ConfirmSignupScreen` already use; the confirm step redirects
   back to the request step if that state is missing (same guard `ConfirmSignupPage` already
   applies).
2. **Never reveal whether an email is registered.** The request step always shows the same
   generic message ("If an account exists for that email, we've sent a reset code") regardless
   of what Cognito's `resetPassword` call actually does — whether the account exists, doesn't
   exist, or Cognito's own "prevent user existence errors" setting is on. This is the safe
   default for this class of UI regardless of the User Pool's specific configuration, and avoids
   turning the form into a user-enumeration oracle. Only a clearly non-account-existence failure
   (a thrown `TypeError`, i.e. a network-level failure with no Cognito response at all) gets a
   distinct message.
3. **Reuse the existing shared password rule** (`isPasswordValid`/`PASSWORD_MIN_LENGTH`/
   `PASSWORD_RULE_HINT`, `packages/shared/src/auth.ts`) for the new-password field on the
   confirm step — the identical rule already enforced by `SignupPage`/`SignupScreen` and by the
   Cognito password policy in `backend.ts` (ADR-0024). No new validation logic.
4. **`AuthContext` gains two new thin wrapper methods**, in both `apps/web/src/AuthContext.tsx`
   and `apps/mobile/src/lib/AuthContext.tsx`, with the identical shape:
   `resetPassword(email)` → Cognito `resetPassword({ username: email })`, and
   `confirmResetPassword(email, code, newPassword)` → Cognito
   `confirmResetPassword({ username: email, confirmationCode: code, newPassword })`. Same
   thin-wrapper-over-Amplify pattern as every existing method on both contexts — no extra state.
5. **Built for both web and mobile together**, not staged one-platform-first as some earlier
   features were — mobile's auth screens are structurally identical to web's (same Cognito API
   surface, same form/error patterns, shared `authStyles`), so the marginal cost of building both
   at once was low relative to leaving one platform without password recovery at all.
6. **No new tests for the mobile screens or the mobile `AuthContext` additions** — `LoginScreen`,
   `SignupScreen`, and `ConfirmSignupScreen` have no test coverage today (confirmed: no test file
   exists for any mobile auth screen, nor for mobile's `AuthContext`), an established, pre-existing
   gap this ticket doesn't newly introduce or attempt to backfill. The web equivalents (which do
   have test coverage) are fully tested.

## Tradeoffs & consequences

- **Gain:** citizens and staff on both platforms can recover a forgotten password without
  contacting an administrator; the implementation reuses every existing pattern (two-step flow,
  shared password rule, thin `AuthContext` wrappers, shared mobile `authStyles`) rather than
  introducing new ones.
- **Give up / interim:** the generic "if an account exists" messaging means a user who mistypes
  their email gets no explicit signal that nothing was sent — an accepted UX cost of the
  anti-enumeration decision; mobile's new screens and `AuthContext` methods ship without
  automated tests, consistent with (not a deviation from) this repo's existing mobile test-
  coverage gap.
- **Commits us to:** if mobile auth screens are ever given test coverage as a dedicated ticket,
  the new `ForgotPasswordScreen`/`ResetPasswordScreen` should be included in that pass rather
  than treated as a special case.
