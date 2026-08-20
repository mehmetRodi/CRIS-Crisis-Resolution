/**
 * Team assignment — pure business logic (CRIS-32, design doc §5.1).
 *
 * Mirrors `transition-report/core.ts`'s split: this module computes the plan
 * with no AWS/Lambda imports so it is exhaustively unit tested; `handler.ts`
 * performs the conditional write. Unlike a status transition, assignment has
 * no per-actor authority matrix — the `assignTeam` mutation is COORDINATOR/
 * ADMIN-only at the schema level (`data/resource.ts`), so there is no
 * `FORBIDDEN` case to compute here. Report-side guards reject terminal reports
 * and prevent a second active assignment until reassignment lifecycle semantics
 * are implemented.
 */
import {
  isTerminalStatus,
  ReportEventType,
  type ReportEventType as ReportEventTypeT,
  type ReportStatus as ReportStatusT,
  type TransitionActor,
} from '@crisismap/shared';

/** The minimal current-report state the engine needs (loaded from DynamoDB). */
export interface CurrentReport {
  id: string;
  status: ReportStatusT;
  version: number;
  assignedTeamId: string | null;
}

/** A requested assignment. `expectedVersion` drives the optimistic lock (§5.3). */
export interface AssignCommand {
  teamId: string;
  expectedVersion: number;
  actorId: string;
  actorRole: TransitionActor;
  /** Optional free-text reason, captured on the audit event. */
  note?: string | null;
}

/** Deterministic ids/time injected by the handler for a testable plan. */
export interface AssignContext {
  eventId: string;
  assignmentId: string;
  now: string;
}

/** The optimistic-locked update to apply to the Report item. */
export interface ReportAssignmentUpdate {
  id: string;
  teamId: string;
  /** The version the conditional write must match (`expectedVersion`). */
  expectedVersion: number;
  /** The new version to persist (`expectedVersion + 1`). */
  nextVersion: number;
  updatedAt: string;
}

/** A new `Assignment` record linking the team to the report (§5.1). */
export interface AssignmentRecord {
  id: string;
  reportId: string;
  teamId: string;
  status: 'ASSIGNED';
  assignedById: string;
  version: number;
  createdAt: string;
}

export interface ReportEventRecord {
  id: string;
  reportId: string;
  eventId: string;
  type: ReportEventTypeT;
  actorId: string;
  actorRole: string;
  version: number;
  detail: { teamId: string; assignmentId: string; note: string | null };
  createdAt: string;
}

export interface AssignmentPlan {
  update: ReportAssignmentUpdate;
  assignment: AssignmentRecord;
  event: ReportEventRecord;
}

/** The report is in a terminal status and cannot be assigned a team. */
export class AssignmentIllegalError extends Error {
  constructor(status: ReportStatusT) {
    super(`Report in terminal status ${status} cannot be assigned a team.`);
    this.name = 'AssignmentIllegalError';
  }
}

/** Reassignment requires retiring the existing assignment lifecycle first. */
export class AlreadyAssignedError extends Error {
  constructor(teamId: string) {
    super(`Report is already assigned to team ${teamId}.`);
    this.name = 'AlreadyAssignedError';
  }
}

/** `expectedVersion` did not match the current report version (§5.3 CONFLICT). */
export class VersionConflictError extends Error {
  constructor(expected: number, actual: number) {
    super(`Version conflict: expected ${expected}, found ${actual}.`);
    this.name = 'VersionConflictError';
  }
}

/**
 * Validate and build the assignment plan. Throws a specific error for each
 * failure mode so the resolver can map it to a stable GraphQL error code
 * (`CONFLICT` for a version mismatch, per §5.3).
 */
export function buildAssignmentPlan(
  current: CurrentReport,
  command: AssignCommand,
  ctx: AssignContext,
): AssignmentPlan {
  if (isTerminalStatus(current.status)) {
    throw new AssignmentIllegalError(current.status);
  }
  if (current.assignedTeamId) {
    throw new AlreadyAssignedError(current.assignedTeamId);
  }
  if (command.expectedVersion !== current.version) {
    throw new VersionConflictError(command.expectedVersion, current.version);
  }

  const nextVersion = current.version + 1;
  const note = command.note?.trim() ? command.note.trim() : null;

  return {
    update: {
      id: current.id,
      teamId: command.teamId,
      expectedVersion: current.version,
      nextVersion,
      updatedAt: ctx.now,
    },
    assignment: {
      id: ctx.assignmentId,
      reportId: current.id,
      teamId: command.teamId,
      status: 'ASSIGNED',
      assignedById: command.actorId,
      version: 1,
      createdAt: ctx.now,
    },
    event: {
      id: ctx.eventId,
      reportId: current.id,
      eventId: ctx.eventId,
      type: ReportEventType.ASSIGNED,
      actorId: command.actorId,
      actorRole: command.actorRole,
      version: nextVersion,
      detail: { teamId: command.teamId, assignmentId: ctx.assignmentId, note },
      createdAt: ctx.now,
    },
  };
}
