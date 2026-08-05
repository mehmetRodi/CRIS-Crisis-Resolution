# ADR-0042: Volunteer tasks use a server-enforced redacted projection

- **Status:** Accepted
- **Date:** 2026-08-05
- **Deciders:** Team (CRIS-33 review)
- **Supersedes:** ADR-0040 Decisions 1–2 where they place redaction and model joins in the client
- **Relates to:** ADR-0039 (volunteer authorization tier), ADR-0041 (Cognito role enforcement)

## Context

ADR-0040 introduced a read-only volunteer task board by issuing bounded `Report`, `Assignment`,
and `Team` model reads in the browser. Its explicit GraphQL selection sets prevented the shipped UI
from requesting raw report text, reporter identity/contact, media keys, and internal notes.

That is data minimization for an honest client, but it is not an authorization boundary. After the
concurrent CRIS-24 work removed the blanket authenticated `Report` read, the model still granted
`VOLUNTEER` group members full generated `Report` reads. A caller could bypass the web selection set
and directly request PII-bearing fields. The volunteer selection also requested exact coordinates
and geohashes that no task-board component displayed.

## Options considered

- **Keep client-side selection sets as the boundary.** Rejected: callers control GraphQL selection
  sets and can bypass the application code.
- **Use field-level authorization on the existing `Report` model.** Rejected: Amplify field rules
  add access; they cannot retract fields already granted by a model-level read rule.
- **Add a custom server-side projection and remove direct volunteer model reads** (chosen). This
  creates one enforceable response shape without expanding the ticket into team-membership policy.

## Decision

1. `listVolunteerTasks` is a Cognito-group-authorized AppSync query for `VOLUNTEER`, `RESPONDER`,
   `COORDINATOR`, and `ADMIN`. `/volunteer` uses the same role allow-list through `RequireRole`, so
   unauthorized routes do not mount the data hook.
2. Its data-stack Lambda receives read-only IAM grants for `Report`, `Assignment`, and `Team`. Each
   DynamoDB scan has a strict `ProjectionExpression`; reporter data, raw text, media, notes, exact
   coordinates, and geohashes cannot enter the function's join or response.
3. The custom GraphQL `VolunteerTask` type is the response allow-list. It contains task identity,
   lifecycle/classification, redacted AI summary, coarse region, assignment/team labels, and lane.
4. `VOLUNTEER` is removed from generated model authorization for `Report`, `Assignment`, `Team`,
   and `DuplicateGroup`. The custom query is the volunteer operational read boundary.
5. The query keeps ADR-0040's bounded 250-record MVP working set and refresh-driven UI. It still
   does not claim team/region authorization: identity-to-team membership and server-side scoping
   remain prerequisites for interactive volunteer workflows.

## Tradeoffs & consequences

- A modified client cannot request reporter PII or unused exact location through the volunteer
  operation; redaction is enforced in IAM-backed server code and the GraphQL response type.
- The Lambda performs three bounded scans and an in-memory join. This is intentionally an MVP
  implementation, not the eventual GSI-backed, team-scoped access pattern.
- Responders/coordinators/admins may use the volunteer board while retaining their separate model
  permissions. Volunteers lose all generated-model reads and depend on the custom operation.
- A sandbox/staging deployment is still required to validate synthesized AppSync auth, Lambda IAM,
  table environment variables, and representative production-size latency end to end.
