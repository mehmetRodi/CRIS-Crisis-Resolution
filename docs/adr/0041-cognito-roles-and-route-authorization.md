# ADR-0041: Cognito roles, route-level authorization, and Report auth hardening (CRIS-24)

- **Status:** Accepted
- **Date:** 2026-07-26
- **Deciders:** Team (CRIS-24)
- **Refines:** ADR-0024 (optional auth + anonymous guest access)
- **Discharges:** ADR-0028's "deferred to CRIS-24" note; the CRIS-24 mentions in ADR-0009,
  ADR-0029

## Context

ADR-0024 stood up Cognito groups but deliberately left every group manual/admin-assigned, and
left route/API-level enforcement of those groups for later. Three concrete gaps had accumulated
against that deferral, each already named in code or a prior ADR:

1. **No group is ever assigned automatically.** A self-signed-up user (web or mobile) has no
   Cognito group at all — not even `CITIZEN` — until an admin assigns one by hand.
2. **The `/coordinator` route has no group gate.** `Router.tsx` only checked for _a_ session
   (`useLiveReports` degrading to `unauthenticated`), so any signed-in user — including a bare
   `CITIZEN` — could load the dashboard shell.
3. **The dashboard hardcoded `UserRole.COORDINATOR`** when computing which transition buttons to
   offer (`coordinatorTransitions`), a gap ADR-0028 named explicitly: "Reading the caller's
   actual Cognito groups to gate the affordance is deferred to CRIS-24."

While auditing the data model for this ticket, a fourth issue surfaced that wasn't explicitly
tracked but is squarely an authorization defect: the `Report` model's schema authorization
carried `allow.authenticated().to(['read'])` alongside its group rules. Because `Report` holds
reporter PII (`reporterContact`, `text`, `reporterId` — design doc §5.6), that blanket rule meant
_any_ signed-in user, regardless of group, could `Report.list()`/`get()` the full record. A
self-signed-up citizen with no staff group could read every other citizen's contact info and raw
report text. This is fixed as part of "Cognito roles and authorization" rather than deferred,
since it is the concrete failure mode the ticket exists to prevent.

Out of scope, by explicit decision: a full schema/resolver authorization rewrite (remains
CRIS-32/general hardening); Amazon Location map-tile Cognito auth (ADR-0025's separate CRIS-24
mention — config-only and independent of groups/roles); any staff invite or self-service
role-request flow.

## Options considered

- **Auto-assign a role via Cognito triggers vs. leave signup group-less forever.**
  Leaving it manual matches ADR-0024's original stance but means a plain citizen account can
  never do anything role-gated (not even the coordinator dashboard's graceful-degrade path) until
  an admin intervenes — poor for a from-scratch signup flow with no admin UI yet. Chosen:
  auto-assign `CITIZEN` (the only role reachable by self-service) on confirmation; staff groups
  stay manual since granting staff authority can't be a side effect of confirming an email.
- **Duplicate "groups → highest role" client-side vs. share one implementation.**
  `transition-report/handler.ts` already had a correct `ROLE_RANK`/`highestRole` — reimplementing
  it in `AuthContext` would let the two definitions drift. Chosen: move it into
  `@crisismap/shared` (`highestRole`, next to `UserRole`) and have both the Lambda and the client
  import the one function.
- **Route guard as a hard redirect vs. an inline degrade.** The dashboard already degrades
  gracefully for "no session" (`unauthenticated` feed state); redirecting straight to `/login`
  for "no session" preserves that UX intent, but "signed in, wrong role" needs its own state — a
  silent redirect there would be confusing (the user _is_ signed in). Chosen: `RequireRole`
  redirects to `/login` only when unauthenticated, and renders an explicit "not authorized"
  panel when signed in but ungated.
- **Field-level authorization vs. dropping the blanket rule on `Report`.** Amplify Gen 2 field
  auth can only _add_ access beyond the model rule, not restrict it — so no field-level rule
  could claw back the PII fields once `allow.authenticated().to(['read'])` grants them. Chosen:
  remove the blanket rule; the existing `allow.groups(['COORDINATOR','ADMIN'])` (full) and
  `allow.groups(['RESPONDER','VOLUNTEER']).to(['read'])` rules already cover every legitimate
  reader.

## Decision

1. **Citizen-role assignment triggers** (`amplify/auth/post-confirmation/`) call
   `AdminAddUserToGroup` for `CITIZEN` on `PostConfirmation_ConfirmSignUp` (not
   `ConfirmForgotPassword`). Confirmation-time failures are logged and swallowed so a transient
   AWS error does not replace successful email confirmation with an error page. The same function
   also runs after authentication: it calls `AdminListGroupsForUser` and retries the `CITIZEN`
   assignment only when the account still has no known application role. This makes a transient
   confirmation-time failure recover on the next sign-in without adding `CITIZEN` to an existing
   staff account. IAM is limited to these two actions and user pools in the deployment account and
   region; an exact pool ARN would create a circular CloudFormation dependency because the pool
   references the trigger function.
2. **`highestRole(groups)` lives in `@crisismap/shared`** (`domain.ts`, next to `UserRole`).
   `transition-report/handler.ts` imports it instead of keeping a private copy; `AuthContext`
   (web) uses the same function against the ID token's `cognito:groups` claim
   (`fetchAuthSession`), exposing `roles: UserRole[]` and `highestRole: UserRole | null`. Mobile
   is unchanged — it has no staff/coordinator surface (ADR-0020).
3. **`RequireRole` component** (`apps/web/src/RequireRole.tsx`) wraps `/coordinator`:
   `allow={[COORDINATOR, ADMIN]}`. Renders nothing while the session is resolving; redirects to
   `/login` when unauthenticated; shows a plain "not authorized" panel when signed in with an
   ungated role. The resolver/schema remain the real authority — this only stops an unauthorized
   session from loading the surface.
4. **`CoordinatorDashboard` takes a `callerRole?: UserRole` prop** (default `COORDINATOR`, so the
   existing fixture-driven shell tests are unchanged), threaded from `Router.tsx`'s
   `highestRole`. `coordinatorTransitions(from, role)` and the header role badge now use it
   instead of a hardcoded `UserRole.COORDINATOR` — closing the ADR-0028 gap. Since `RequireRole`
   only ever mounts this route for `COORDINATOR`/`ADMIN`, `callerRole` in production is always one
   of those two.
5. **`Report` model authorization drops `allow.authenticated().to(['read'])`.** Only
   `allow.groups(['COORDINATOR','ADMIN'])` (full) and
   `allow.groups(['RESPONDER','VOLUNTEER']).to(['read'])` remain. `Region`/`CategoryConfig` keep
   their broad `allow.authenticated().to(['read'])` deliberately — they hold no PII and every
   role legitimately needs them (dropdowns, scoring config). `IdempotencyRecord`'s
   `allow.groups(['ADMIN']).to(['read'])` is left as-is — low-sensitivity, out of scope here.

## Tradeoffs & consequences

- **Gain:** a self-signed-up account receives `CITIZEN` during confirmation, with a
  post-authentication reconciliation path if that first assignment fails; the coordinator dashboard is
  unreachable by non-staff sessions; the UI's offered actions match the signed-in caller's real
  authority instead of assuming COORDINATOR; the `Report` PII leak to any authenticated user is
  closed.
- **Give up / interim:** staff onboarding (VOLUNTEER/RESPONDER/COORDINATOR/ADMIN) is still a
  manual, out-of-band admin action — no invite or self-service request flow exists. `/map` is not
  route-gated (it renders `PublicReport`-shaped data only, once wired; no PII risk today).
  Schema/resolver authorization elsewhere (every model but `Report`) remains coarse, and generated
  CRUD still coexists with the guarded custom mutations.
- **Commits us to:** any future staff-invite ticket must call `AdminAddUserToGroup` (or an
  equivalent) rather than relying on the automatic role-assignment triggers, since they only ever
  assign `CITIZEN`; CRIS-32 (or a dedicated hardening ticket) inherits the remaining coarse model
  authorization; a live sandbox/staging deploy is required to verify the trigger and IAM grant
  end-to-end — this ADR's changes are verified here only by unit tests and typecheck, not a
  deployed User Pool.
