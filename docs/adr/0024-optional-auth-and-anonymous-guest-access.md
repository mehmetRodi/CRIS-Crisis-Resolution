# ADR-0024: Optional Cognito sign-in + anonymous guest access (CRIS-7)

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Team

## Context

CRIS-7 owns "auth + anonymous" (design doc §5.6, §2.1). Two needs pull in different
directions:

1. Citizens reporting an emergency must not be blocked by a sign-in wall — ADR-0021 already
   established that reachability (no install, no account) is the point of the web fallback
   form, and the mobile form (ADR-0020) is guest-first for the same reason.
2. Coordinators, responders, and volunteers are named users who need persistent identity —
   audit trails (design doc §5.1) and role-scoped authorization depend on knowing who acted.

`amplify/auth/resource.ts` was a stub with Cognito groups defined but no guest/unauthenticated
identity wiring. `amplify/data/resource.ts` (CRIS-9) and `amplify/storage/resource.ts`
(CRIS-6) already added `allow.guest()` rules to `submitReport` and report media, anticipating
this decision.

## Options considered

- **Sign-in required for everything** — simplest authorization model, but reintroduces the
  reachability failure ADR-0021 exists to solve: a citizen without an account (or without
  patience for signup during an emergency) couldn't report.
- **Fully anonymous, no accounts at all** — matches the citizen path but breaks the
  coordinator/responder/volunteer surfaces, which require persistent role-scoped identity and
  an audit trail per design doc §5.1.
- **Optional sign-in: Cognito User Pool for named accounts, Identity Pool guest identities for
  anonymous submission** — citizens can report as guests (no account) or, once authenticated
  surfaces exist, sign in for a persistent identity; every other role signs in normally. Chosen.

## Decision

1. **Sign-in is optional, not gated.** `/`, `/report`, `/login`, `/signup`, and
   `/confirm-signup` are all public routes (`apps/web/src/Router.tsx`) — there is no
   `ProtectedRoute` in this scaffold. `App.tsx` shows a Sign In link when unauthenticated and
   the user's email + Sign Out when authenticated, but nothing requires signing in to reach the
   report form.
2. **Anonymous citizen submission uses Cognito Identity Pool guest identities**, not a
   backend anonymity flag layered on an authenticated call. The web and mobile clients call
   `submitReport` with `authMode: 'identityPool'`; an unauthenticated visitor gets a guest
   identity, and `allow.guest()` on `submitReport` (`amplify/data/resource.ts`) and on report
   media (`amplify/storage/resource.ts`) authorizes it. No change was needed in
   `amplify/auth/resource.ts` for this — Amplify Gen 2 provisions the unauthenticated Identity
   Pool role automatically from those `allow.guest()` rules.
3. **Named accounts use Cognito User Pool email/password sign-in** — web
   (`AuthContext.tsx`, `LoginPage.tsx`, `SignupPage.tsx`, `ConfirmSignupPage.tsx`) and the
   mobile twins (`apps/mobile/src/lib/AuthContext.tsx`, `src/screens/auth/*`), independent of
   the guest path.
   The five `UserRole` groups (`CITIZEN`, `VOLUNTEER`, `RESPONDER`, `COORDINATOR`, `ADMIN`)
   remain defined on the User Pool but are **not** auto-assigned at signup — group membership
   is manual/admin-assigned until a role-assignment story is scoped.
4. **Anonymity is a per-submission choice, not an account property.** `ReportForm`'s
   `anonymous` toggle controls whether reporter contact info is attached
   (`toReportSubmission` in `@crisismap/shared`); it is independent of whether the submitter is
   signed in.
5. **One password policy, two enforcers.** The client rule (`isPasswordValid` /
   `PASSWORD_MIN_LENGTH` in `@crisismap/shared`) and the Cognito User Pool policy (set via the
   CDK escape hatch in `apps/web/amplify/backend.ts`, since `defineAuth` exposes no policy
   option) are kept identical — minimum length with an uppercase letter, a lowercase letter,
   and a number; **no** required symbol. This ensures the sign-up form never accepts a password
   that Cognito would then reject, which would otherwise surface as a confusing raw backend
   error.

## Tradeoffs & consequences

- **Gain:** citizens can report without ever creating an account, satisfying the availability
  goal; coordinators/responders still get durable, auditable identity when that UI exists.
- **Give up:** no automatic mapping from a new signup to a role — an admin (or a future
  ticket) must assign groups before a signed-up user can use any role-gated surface.
- **Commits us to:**
  - Deferred to a future ticket: automatic group assignment (e.g. a `postConfirmation`
    trigger), external identity providers, and route guards once CRIS-12/13/22/23 add
    surfaces that actually need `COORDINATOR`/`RESPONDER` authorization.
  - Deferred to CRIS-17: tightening `amplify/storage/resource.ts` beyond its current
    entity_id-scoped guest-write / authenticated-read-write rule, alongside the presigned
    upload rework.
  - Mobile sign-in mirrors the web surfaces: `apps/mobile` ships the same optional Cognito
    flow (`src/lib/AuthContext.tsx`, `src/screens/auth/*`, reachable from `RootNavigator`),
    while report submission stays guest-first via `identityPool`
    (`apps/mobile/src/lib/amplify.ts`).
