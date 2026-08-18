import { describe, expect, it } from 'vitest';
import { ReportEventType, ReportStatus, UserRole } from '@crisismap/shared';
import {
  AlreadyAssignedError,
  AssignmentIllegalError,
  buildAssignmentPlan,
  VersionConflictError,
  type AssignCommand,
  type AssignContext,
  type CurrentReport,
} from './core';

const ctx: AssignContext = {
  eventId: '01J000000000000000000EVT',
  assignmentId: '01J000000000000000000ASG',
  now: '2026-08-12T12:00:00.000Z',
};

const current: CurrentReport = {
  id: '01J000000000000000000RPT',
  status: ReportStatus.VERIFIED,
  version: 3,
  assignedTeamId: null,
};

function cmd(overrides: Partial<AssignCommand> = {}): AssignCommand {
  return {
    teamId: '01J000000000000000000TEA',
    expectedVersion: 3,
    actorId: 'user-coordinator',
    actorRole: UserRole.COORDINATOR,
    ...overrides,
  };
}

describe('buildAssignmentPlan', () => {
  it('bumps version and records an ASSIGNED audit event', () => {
    const plan = buildAssignmentPlan(current, cmd(), ctx);
    expect(plan.update.teamId).toBe('01J000000000000000000TEA');
    expect(plan.update.expectedVersion).toBe(3);
    expect(plan.update.nextVersion).toBe(4);
    expect(plan.assignment.reportId).toBe(current.id);
    expect(plan.assignment.status).toBe('ASSIGNED');
    expect(plan.assignment.version).toBe(1);
    expect(plan.event.type).toBe(ReportEventType.ASSIGNED);
    expect(plan.event.version).toBe(4);
    expect(plan.event.actorRole).toBe(UserRole.COORDINATOR);
    expect(plan.event.detail).toEqual({
      teamId: '01J000000000000000000TEA',
      assignmentId: '01J000000000000000000ASG',
      note: null,
    });
  });

  it('captures an optional note on the audit event', () => {
    const plan = buildAssignmentPlan(current, cmd({ note: '  send the nearest team  ' }), ctx);
    expect(plan.event.detail.note).toBe('send the nearest team');
    const noNote = buildAssignmentPlan(current, cmd({ note: '   ' }), ctx);
    expect(noNote.event.detail.note).toBeNull();
  });

  it('rejects assigning a team to a terminal (REJECTED) report', () => {
    const rejected: CurrentReport = { ...current, status: ReportStatus.REJECTED };
    expect(() => buildAssignmentPlan(rejected, cmd(), ctx)).toThrow(AssignmentIllegalError);
  });

  it('rejects a second active assignment', () => {
    expect(() =>
      buildAssignmentPlan({ ...current, assignedTeamId: 'existing-team' }, cmd(), ctx),
    ).toThrow(AlreadyAssignedError);
  });

  it('enforces the optimistic lock (CONFLICT on stale version)', () => {
    expect(() => buildAssignmentPlan(current, cmd({ expectedVersion: 2 }), ctx)).toThrow(
      VersionConflictError,
    );
  });

  it('checks legality before the version (illegal beats stale)', () => {
    const rejected: CurrentReport = { ...current, status: ReportStatus.REJECTED };
    expect(() => buildAssignmentPlan(rejected, cmd({ expectedVersion: 99 }), ctx)).toThrow(
      AssignmentIllegalError,
    );
  });
});
