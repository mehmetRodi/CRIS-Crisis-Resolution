/**
 * Report state-machine transition — pure business logic (design doc §5.1, §5.3).
 *
 * Every status change is (1) structurally legal per `STATUS_TRANSITIONS`,
 * (2) authorized for the actor's role per `TRANSITION_ROLES`, (3) version-checked
 * with an optimistic lock, and (4) recorded as an immutable `STATUS_CHANGED`
 * audit event. This module computes that plan with no AWS/Lambda imports so it
 * can be exhaustively unit tested; `handler.ts` performs the conditional write.
 */
import {
  canActorTransition,
  canTransition,
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
}

/** A requested transition. `expectedVersion` drives the optimistic lock (§5.3). */
export interface TransitionCommand {
  toStatus: ReportStatusT;
  expectedVersion: number;
  actorId: string;
  actorRole: TransitionActor;
  /** Optional free-text reason, captured on the audit event. */
  note?: string | null;
}

/** Deterministic ids/time injected by the handler for a testable plan. */
export interface TransitionContext {
  eventId: string;
  now: string;
}

/** The optimistic-locked update to apply to the Report item. */
export interface ReportUpdate {
  id: string;
  fromStatus: ReportStatusT;
  toStatus: ReportStatusT;
  /** The version the conditional write must match (`expectedVersion`). */
  expectedVersion: number;
  /** The new version to persist (`expectedVersion + 1`). */
  nextVersion: number;
  updatedAt: string;
}

export interface ReportEventRecord {
  id: string;
  reportId: string;
  eventId: string;
  type: ReportEventTypeT;
  fromStatus: ReportStatusT;
  toStatus: ReportStatusT;
  actorId: string;
  actorRole: string;
  version: number;
  detail: { note: string } | null;
  createdAt: string;
}

export interface TransitionPlan {
  update: ReportUpdate;
  event: ReportEventRecord;
}

/** Illegal move (terminal source or not in `STATUS_TRANSITIONS`). */
export class IllegalTransitionError extends Error {
  constructor(from: ReportStatusT, to: ReportStatusT) {
    super(`Illegal transition ${from} → ${to}.`);
    this.name = 'IllegalTransitionError';
  }
}

/** Actor's role may not perform this (otherwise legal) transition. */
export class TransitionForbiddenError extends Error {
  constructor(actor: TransitionActor, from: ReportStatusT, to: ReportStatusT) {
    super(`${actor} is not permitted to perform ${from} → ${to}.`);
    this.name = 'TransitionForbiddenError';
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
 * Validate and build the transition plan. Throws a specific error for each
 * failure mode so the resolver can map it to a stable GraphQL error
 * (`CONFLICT` for a version mismatch, per §5.3). The optimistic lock is checked
 * here for a fast, clear failure and enforced again by the conditional write.
 */
export function buildTransitionPlan(
  current: CurrentReport,
  command: TransitionCommand,
  ctx: TransitionContext,
): TransitionPlan {
  const from = current.status;
  const to = command.toStatus;

  if (isTerminalStatus(from) || !canTransition(from, to)) {
    throw new IllegalTransitionError(from, to);
  }
  if (!canActorTransition(command.actorRole, from, to)) {
    throw new TransitionForbiddenError(command.actorRole, from, to);
  }
  if (command.expectedVersion !== current.version) {
    throw new VersionConflictError(command.expectedVersion, current.version);
  }

  const nextVersion = current.version + 1;
  const note = command.note?.trim() ? command.note.trim() : null;

  return {
    update: {
      id: current.id,
      fromStatus: from,
      toStatus: to,
      expectedVersion: current.version,
      nextVersion,
      updatedAt: ctx.now,
    },
    event: {
      id: ctx.eventId,
      reportId: current.id,
      eventId: ctx.eventId,
      type: ReportEventType.STATUS_CHANGED,
      fromStatus: from,
      toStatus: to,
      actorId: command.actorId,
      actorRole: command.actorRole,
      version: nextVersion,
      detail: note ? { note } : null,
      createdAt: ctx.now,
    },
  };
}
