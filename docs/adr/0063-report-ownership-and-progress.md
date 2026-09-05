# ADR-0063: Report ownership and progress updates

- **Status:** Accepted
- **Date:** 2026-09-05
- **Scope:** CRIS-32 coordinator assignment, CRIS-33 volunteer/responder workflow
- **Supersedes in part:** ADR-0040/0042 read-only task interactions

## Context

The user requested visible team/person assignment, volunteer and responder claims,
and a place to record work. Existing team assignments did not model an individual
responsible person; volunteer tasks were read-only. The user requested working
backend actions rather than presentation-only controls.

## Decision

Retain the guarded `assignTeam` operation and expose it near the top of incident
details. Coordinators/admins can create an active response team using existing
Team model authorization and select it for guarded assignment.

Introduce a private `ReportWork` record keyed by report ID. A report has at most
one responsible person, independently of its team assignment. Operational callers
can claim verified/in-progress reports. Coordinators/admins may assign an enabled
Cognito volunteer/responder using their sign-in identifier. The Lambda verifies
the target's user-pool account and group; the browser cannot assert an actor ID.
An existing claim must be explicitly released before another person is assigned.
The owner or a coordinator can release it. The owner and coordinators can add
bounded progress notes to reports that are not resolved/rejected.

The shared work engine enforces permissions and expected work version. A DynamoDB
transaction conditionally increments the current Report version, conditionally
writes ReportWork, and appends a WORK_UPDATED ReportEvent. Report status remains
under STATUS_TRANSITIONS and the existing status mutation. This serializes claims
against one another and against incident closure. Failed/conflicting writes retain
the user's draft and require a refresh; no automatic retry claims success.

Generated work model access is read-only for coordinators/admins. Operational
clients use custom `getReportWork`, `updateReportWork`, and `listMyReportWork`.
Other volunteers/responders can see an ownership label but not another person's
ID or progress notes. Notes are visible only to the current owner and coordinators;
they never enter public projections, AI prompts, or subscription payloads.
The latest 50 notes live in the bounded work record; immutable audit events retain
history. A successful work write sends an existing redacted report invalidation.

My tasks reads only the authenticated user's report IDs. For the bounded MVP it
scans at most 20 pages of 250 work records with a server-side actor filter and an
ID-only projection. Exceeding that bound returns an explicit error, not a partial
personal list. A user-indexed query is the next scaling step. The visible task
feed retains its existing 250-record bound, so My tasks is scoped to that feed.

The function has narrowly scoped table and Cognito permissions, X-Ray tracing,
and an expected-error-aware CloudWatch alarm. No credentials are committed.

## Consequences

The new schema, table, IAM grants, and Lambda must be deployed before claim/person
assignment/progress actions work. Existing environments show service-unavailable
feedback until their backend and generated outputs are updated. Frontend code
never fabricates a successful claim. This change does not add team membership,
travel routing, automatic acceptance of a team assignment, or user administration.

Development verification uses mocked AWS-boundary integration tests for writes.
The supplied admin account can verify existing deployed reads and navigation;
real reports are not changed as part of visual verification.
