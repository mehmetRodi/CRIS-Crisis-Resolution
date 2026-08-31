# ADR-0056: Unauthenticated public incident read path for the citizen map

- **Status:** Accepted
- **Date:** 2026-08-31
- **Deciders:** Product owner + implementation (CRIS-54 UI/UX rebuild)

## Context

The citizen surfaces were to include a public map showing what is already known nearby, so that
someone about to report a fire they can see from their window can check whether it is already
handled. This reduces duplicate reports during exactly the surge when duplicate handling is most
expensive (§5.4.3), and gives people in an affected area something actionable without an account.

No such read path existed. The schema comment above the subscriptions recorded the gap
deliberately: the public `/map` "has neither a baseline public query nor incident markers. Public
subscription auth is deferred until that complete read path can be introduced and operated
together." Every read — models, `listVolunteerTasks`, all three subscriptions — required a Cognito
user-pool session.

Opening the first unauthenticated data path in a system holding disaster-victim PII is a security
decision, not a UI one. It was raised as such and explicitly approved.

## Options considered

- **Build the map UI, leave the path closed.** Zero security change; the map populates only for
  signed-in users and shows an explanatory empty state otherwise. But it does not deliver the
  feature, and a public map that shows nothing to the public is not one.
- **Expose `Report` with a guest model-level rule.** Minimal code. Rejected outright: a model rule
  can express neither the field allow-list nor a status filter, so reporter identity, contact
  details, internal notes, and the untrusted raw report body would all cross the wire.
- **A dedicated Lambda resolver enforcing both redactions server-side.** More code and another
  function to operate. Chosen.

## Decision

1. **`listPublicReports` is a Lambda-backed query** authorized `allow.guest()` (the identity pool's
   unauthenticated role) plus `allow.authenticated()` — both are required, because a signed-in
   caller presents a user-pool token and would not otherwise match the guest rule. The client picks
   its auth mode from the session (`usePublicIncidents`).
2. **Two independent redactions, both server-side.** Neither is expressible as a model rule:
   - **Fields** — only the `PublicReport` allow-list.
   - **Incidents** — only `PUBLICLY_VISIBLE_STATUSES`.
3. **Only human-confirmed incidents are published.** `VERIFIED`, `IN_PROGRESS`, and `RESOLVED`.
   Withheld: `NEW`/`PROCESSING` (nothing has assessed them), `AI_CLASSIFIED` (the _model_ believes
   it; no human has agreed), `NEEDS_VERIFICATION` (actively flagged as doubtful), and `REJECTED`
   (a claim already known to be untrue). Redaction answers "which FIELDS are safe to expose"; this
   answers the separate question "which INCIDENTS are safe to expose at all". A perfectly redacted
   but unverified report is still an unconfirmed claim, and putting one on a public map during a
   disaster broadcasts possibly-false information to everyone in the area. Staff surfaces are
   unaffected — triaging unverified reports is the job.
4. **Three redaction layers, deliberately redundant.** The DynamoDB `ProjectionExpression` never
   returns sensitive attributes, so they are not in the Lambda's memory to leak; a
   `FilterExpression` drops non-public statuses in DynamoDB; and `toPublicReport` rebuilds each
   record from the shared field allow-list rather than deleting keys, so a newly-added sensitive
   column cannot pass through by default. Layer three is what survives a mistake in the first two.
   The status filter is also re-asserted in code, because a `FilterExpression` is one typo from
   returning everything.
5. **The visibility rule lives in `@crisismap/shared`** (`PUBLICLY_VISIBLE_STATUSES`,
   `isPubliclyVisible`), and the resolver builds its filter from that constant rather than a
   literal list, so adding a status cannot leave the query behind.
6. **The `limit` argument is clamped server-side** to `[1, 250]`. It arrives from an
   unauthenticated caller, which makes an unclamped value a free denial-of-wallet lever.
7. **The map states what it is showing.** "Confirmed incidents … Unconfirmed reports are not
   shown." A public map that silently omits half the picture is worse than one that explains its
   scope.
8. **The function is granted `grantReadData` on `Report` and nothing else**, and is alarmed through
   the existing observability topic.

## Tradeoffs & consequences

**Gained.** The citizen map works without an account. Duplicate-report pressure during a surge is
reduced. The redaction rule is now a shared, tested constant rather than an implicit assumption.

**Given up.** The system's first unauthenticated data path, and a Lambda to operate alongside the
existing resolvers. The public map is intentionally incomplete — an area with real but unverified
incidents looks quieter than it is, which is the correct trade against broadcasting unconfirmed
claims, but it is a trade.

**OPEN RISK — accepted and tracked.** This endpoint is unauthenticated and therefore un-throttled
beyond AppSync defaults. **Rate limiting belongs to CRIS-25 (WAF), which is still open.** The
`limit` clamp bounds a single request's cost but nothing bounds request volume. Until WAF lands,
`listPublicReports` invocation and error curves are the first place an abuse pattern would show
up, which is why the function is explicitly alarmed. Do not treat this ADR as complete until
CRIS-25 covers this endpoint.

**Watch.** The three `onReportUpdate*` subscriptions remain user-pool-only, so the public map is a
polled snapshot with a manual refresh rather than live. Extending guest auth to a subscription is a
separate decision and should not be inferred from this one.
