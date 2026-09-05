import {
  canClaimReport,
  canCoordinateWork,
  isWorkReadOnly,
  WorkAction,
  WORK_NOTE_MAX_LENGTH,
  type ReportStatus,
  type UserRole,
  type WorkUpdate,
} from '@crisismap/shared';

export interface WorkRecord {
  id: string;
  version: number;
  assigneeId?: string;
  assigneeLabel?: string;
  updates: WorkUpdate[];
  createdAt: string;
  updatedAt: string;
}
export interface WorkActor {
  id: string;
  role: UserRole;
  label: string;
}
export interface WorkCommand {
  action: WorkAction;
  expectedVersion: number;
  note?: string | null;
  target?: { id: string; label: string };
}

export function buildWorkUpdate(
  current: WorkRecord,
  status: ReportStatus,
  actor: WorkActor,
  command: WorkCommand,
  context: { now: string; eventId: string },
): WorkRecord {
  if (!Number.isInteger(command.expectedVersion) || command.expectedVersion < 0)
    throw new Error('VALIDATION: Invalid work version.');
  if (current.version !== command.expectedVersion)
    throw new Error('CONFLICT: This task changed. Refresh before trying again.');
  const coordinator = canCoordinateWork(actor.role);
  const mine = current.assigneeId === actor.id;
  const next = { ...current, version: current.version + 1, updatedAt: context.now };
  switch (command.action) {
    case WorkAction.CLAIM:
      if (!canClaimReport(status))
        throw new Error('ILLEGAL: Only verified or in-progress reports can be claimed.');
      if (current.assigneeId) throw new Error('CONFLICT: This report is already claimed.');
      next.assigneeId = actor.id;
      next.assigneeLabel = actor.label;
      break;
    case WorkAction.ASSIGN:
      if (!coordinator) throw new Error('FORBIDDEN: Only coordinators can assign a person.');
      if (!canClaimReport(status))
        throw new Error('ILLEGAL: Verify the report before assigning a person.');
      if (current.assigneeId)
        throw new Error('CONFLICT: Release the current claim before assigning another person.');
      if (!command.target?.id)
        throw new Error('VALIDATION: Choose an active volunteer or responder account.');
      next.assigneeId = command.target.id;
      next.assigneeLabel = command.target.label;
      break;
    case WorkAction.RELEASE:
      if (!current.assigneeId || (!mine && !coordinator))
        throw new Error(
          'FORBIDDEN: Only the assigned person or a coordinator can release this claim.',
        );
      delete next.assigneeId;
      delete next.assigneeLabel;
      break;
    case WorkAction.NOTE: {
      if (!mine && !coordinator)
        throw new Error('FORBIDDEN: Claim the report before adding an update.');
      if (isWorkReadOnly(status))
        throw new Error('ILLEGAL: Closed reports cannot receive new work updates.');
      const note = command.note?.trim();
      if (!note || note.length > WORK_NOTE_MAX_LENGTH)
        throw new Error(
          `VALIDATION: Write an update between 1 and ${WORK_NOTE_MAX_LENGTH} characters.`,
        );
      // Full history remains in immutable ReportEvents; keep the working record bounded.
      next.updates = [
        ...current.updates,
        { id: context.eventId, text: note, authorLabel: actor.label, createdAt: context.now },
      ].slice(-50);
      break;
    }
    default:
      throw new Error('VALIDATION: Unknown work action.');
  }
  return next;
}
