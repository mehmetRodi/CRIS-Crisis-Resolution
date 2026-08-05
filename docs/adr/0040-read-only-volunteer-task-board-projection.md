# ADR-0040: Volunteer task board is a read-only, explicit projection

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Team (CRIS-33)
- **Relates to:** ADR-0006 (data model), ADR-0036/0037 (frontend accessibility), ADR-0039
  (volunteer authorization tier)

## Context

The design document's Figure 3 calls for a regional volunteer board with five lanes: new task
intake, assigned, in progress, verification needed, and completed. The existing data model already
contains the three records needed to render that view: `Report`, `Assignment`, and `Team`.

It does not yet contain a safe volunteer write boundary. `Assignment`'s generated update operation
is group-wide, not ownership/team/region-scoped, and ADR-0039 records that as an authorization defect.
There is also no volunteer-profile/team-membership model from which the client can securely infer
"my team". Report media is deliberately unavailable to volunteers pending per-assignment signed
delivery.

The custom subscriptions in CRIS-28 are also not connected, so "real time" cannot truthfully be
implemented as push in this ticket.

## Options considered

- **Build the board on the generated model reads and updates.** This would make status controls look
  complete, but any volunteer could update another team's assignment. Rejected: a UI affordance is
  not an authorization boundary.
- **Add a new volunteer mutation and membership model in CRIS-33.** This could provide a full
  ownership-aware workflow, but it materially expands a UI ticket into identity and resolver policy
  already owned by CRIS-24.
- **Ship a read-only, explicitly selected projection over the existing models** (chosen). It provides
  regional task visibility now without ratifying the unsafe generated mutation.

## Decision

1. `/volunteer` requires an authenticated Cognito session before issuing reads. The route performs
   bounded one-shot `Report`, `Assignment`, and `Team` reads, joins them in memory, and supports a
   manual refresh. Subscription-backed updates remain CRIS-28.
2. The `Report` selection set is an explicit allow-list of task-card fields. Raw report text,
   reporter identity/contact, internal notes, and `mediaKeys` never enter the volunteer UI process.
   Cards show the PII-free AI summary and operational classification only.
3. The most recent assignment per report drives the workflow lane. `PROPOSED`/unassigned reports are
   New; `ASSIGNED`/`ACCEPTED` are Assigned; `EN_ROUTE`/`ON_SCENE` are In progress;
   `NEEDS_VERIFICATION` overrides assignment state into Verification needed; `COMPLETED` or a
   resolved report is Completed. Cancelled assignments and rejected reports are omitted.
4. Region, category, and urgency filters narrow the loaded working set client-side. The board does
   not claim that this is server-side region authorization.
5. The board exposes no assignment/report mutation. Guarded, version-checked, team/region-scoped
   volunteer actions require a later custom resolver plus identity-to-team membership.
6. CRIS-33 ships behavior, route-integration, data-hook, and accessibility assertions in Vitest and
   Testing Library, following ADR-0036/0037.

## Tradeoffs & consequences

- Volunteers get a usable task overview with the intended five-lane workflow, filtering, metrics,
  loading/error/authentication states, and no media or reporter-data exposure.
- The three bounded list reads and client join are an MVP working set, not a pagination strategy.
  Server-side region/team queries should replace them when membership and authorization land.
- The board is refresh-driven rather than push-driven and deliberately read-only. The UI says
  "track", not "manage", so it does not promise authority the API cannot safely enforce.
- "My tasks", availability, shift, and trust-score controls from the visual prototype remain deferred
  because no versioned model currently represents those concepts.
