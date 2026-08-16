# ADR-0045: Guarded team assignment (CRIS-32)

- **Status:** Accepted
- **Date:** 2026-08-13
- **Deciders:** Team (CRIS-32)
- **Refines:** ADR-0028 (coordinator status-transition wiring), ADR-0008 (report transition
  engine), ADR-0041 (Cognito roles and route authorization)

## Context

ADR-0028 wired the CRIS-18 status-transition mutation into the coordinator dashboard and
explicitly deferred the rest of "guarded coordinator actions" to this ticket: "the full
guarded-action UX including assignment and merge (CRIS-32)." Two data-model pieces were
already in place anticipating this work — `Report.assignedTeamId` plus its `reportsByTeam`
GSI, and `ReportEventType.ASSIGNED` — but no mutation ever wrote them.

This ADR covers **assigning a response team to a report** only. Merging duplicate report
groups is the other half of "guarded coordinator actions" named by ADR-0028, but ADR-0038
(conservative duplicate detection) explicitly left "merging two existing groups" undecided —
there is no agreed data contract for what a merge does to the non-primary reports' history,
assignments, or events. Building it now would mean inventing that contract under this ticket
rather than deciding it deliberately. Bulk actions (multi-row assignment) are also out of
scope: the queue has no multi-select today. Both remain deferred to a future ticket.

## Options considered

- **Reuse `updateReportStatus`'s transition machinery for assignment.** Assignment isn't a
  `Report.status` change — `STATUS_TRANSITIONS`/`TRANSITION_ROLES` model the status state
  machine specifically, and forcing assignment through it would mean either faking a status
  transition or bolting an unrelated concept onto that table. Rejected.
- **A generated-model mutation on `Assignment` (`client.models.Assignment.create`).** No
  handler to write, but it can't touch `Report.assignedTeamId` or `ReportEvent` atomically —
  the report and its assignment pointer would drift out of sync on a partial failure, and no
  audit event would be recorded. Rejected — this is exactly the gap CRIS-18's guarded mutation
  pattern exists to close.
- **A new guarded custom mutation (`assignTeam`), mirroring `updateReportStatus`'s
  plan-builder/handler split (chosen).** Same shape as CRIS-18's proven pattern: a pure
  `core.ts` (`buildAssignmentPlan`) computes the plan and is exhaustively unit tested; a thin
  `handler.ts` loads state and performs one atomic `TransactWriteCommand`.
- **Fine-grained per-actor authority table for assignment, mirroring `TRANSITION_ROLES`.**
  Status transitions need this because different (from, to) pairs are legal for different
  roles (e.g. only COORDINATOR can reject). Assignment has no such matrix — it is simply
  COORDINATOR/ADMIN or nobody — so a table would model a distinction that doesn't exist.
  Rejected in favor of a single group gate at the schema level (`allow.groups(['COORDINATOR',
'ADMIN'])`), with no additional role check in `core.ts` (nothing else can ever reach it).

## Decision

1. **`assignTeam` custom mutation** (`data/resource.ts`), COORDINATOR/ADMIN-only, taking
   `reportId`, `teamId`, `expectedVersion`, and an optional `note`, returning the updated
   `Report`.
2. **`buildAssignmentPlan`** (`amplify/functions/assign-team/core.ts`) validates two things
   only: the report is not in a terminal status (`isTerminalStatus`, reused from
   `@crisismap/shared` — a REJECTED report cannot be assigned a team), and `expectedVersion`
   matches the report's current `version` (the same optimistic lock as CRIS-18, §5.3). It
   returns a plan covering all three writes: the `Report.assignedTeamId` update, a new
   `Assignment` record (`status: 'ASSIGNED'`), and a `ReportEvent` (`type: 'ASSIGNED'`).
3. **`handler.ts`** loads the report AND the team (rejecting a bogus/deleted `teamId` as
   `NOT_FOUND` before ever building a plan — `updateReportStatus` has no analogous second
   entity to check), then applies the plan in one `TransactWriteCommand`: a conditional
   `Update` on `Report`, a `Put` on `Assignment`, and a `Put` on `ReportEvent`. A version
   conflict on the conditional update surfaces as `CONFLICT:`, matching CRIS-18's contract.
4. **Every call creates a new `Assignment` record** rather than updating an existing one —
   append-only, mirroring `ReportEvent`, so reassignment history is preserved rather than
   overwritten. `Report.assignedTeamId` always reflects only the latest.
5. **Client wiring mirrors CRIS-18 exactly**: `lib/assign-team.ts` (typed `AssignError` with a
   `CONFLICT | NOT_FOUND | ILLEGAL | UNKNOWN` code, mapped from the resolver's stable prefix)
   and `useAssignTeam` (idle → submitting → success/error state machine). `CoordinatorRoute`
   owns both this hook and a new `useTeams` (a one-shot `Team.list()` read for the picker) and
   passes `onAssignTeam`/`assignment`/`teams` into `CoordinatorDashboard`, alongside the
   existing `onTransition`/`transition` props.
6. **`AssignTeamControls` renders independently of `TransitionControls`/`DisabledActions`** in
   the incident-detail panel — a report can be assigned a team regardless of which status
   moves are currently legal, so it is not gated on `onTransition` being wired, only on its own
   `onAssignTeam` prop.
7. **`CoordinatorIncident` gains `assignedTeamId`**, read off `Report.assignedTeamId` in
   `useLiveReports`'s `toRedactedIncident` (the field already existed on the schema, unread
   until now) — so the detail panel can show the current assignment.

## Tradeoffs & consequences

- **Gain:** coordinators can assign a response team from the incident-detail panel with the
  same guarantees CRIS-18 established — role-gated, version-checked, audited in one atomic
  write — closing one of the two gaps ADR-0028 named.
- **Give up / interim:** merging duplicate report groups remains unbuilt (no agreed contract
  per ADR-0038); there is no bulk/multi-select assignment; the team picker is a flat list with
  no capability/region matching (the Dispatch Agent's smarter routing is Phase 2, design doc
  §5.5); reassignment history lives only in the append-only `Assignment` table and the audit
  timeline, with no dedicated "assignment history" UI.
- **Commits us to:** a future merge-action ticket must still decide the data contract ADR-0038
  left open before it can reuse this same guarded-mutation shape; any UI that lets a
  RESPONDER/VOLUNTEER update their own `Assignment.status` (accept/en-route/on-scene) is a
  separate, already-existing generated-model path (`Assignment` allows `RESPONDER`
  read/update) and is unaffected by this ADR.
