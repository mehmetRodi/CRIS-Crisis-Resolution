import { describe, expect, it } from 'vitest';
import { ReportEventType, ReportStatus, UserRole } from '@crisismap/shared';
import {
  buildTransitionPlan,
  IllegalTransitionError,
  TransitionForbiddenError,
  VersionConflictError,
  type CurrentReport,
  type TransitionCommand,
  type TransitionContext,
} from './core';

const ctx: TransitionContext = {
  eventId: '01J000000000000000000EVT',
  now: '2026-07-06T12:00:00.000Z',
};

const current: CurrentReport = {
  id: '01J000000000000000000RPT',
  status: ReportStatus.AI_CLASSIFIED,
  version: 3,
};

function cmd(overrides: Partial<TransitionCommand> = {}): TransitionCommand {
  return {
    toStatus: ReportStatus.VERIFIED,
    expectedVersion: 3,
    actorId: 'user-coordinator',
    actorRole: UserRole.COORDINATOR,
    ...overrides,
  };
}

describe('buildTransitionPlan', () => {
  it('bumps version and records a STATUS_CHANGED audit event', () => {
    const plan = buildTransitionPlan(current, cmd(), ctx);
    expect(plan.update.fromStatus).toBe(ReportStatus.AI_CLASSIFIED);
    expect(plan.update.toStatus).toBe(ReportStatus.VERIFIED);
    expect(plan.update.expectedVersion).toBe(3);
    expect(plan.update.nextVersion).toBe(4);
    expect(plan.event.type).toBe(ReportEventType.STATUS_CHANGED);
    expect(plan.event.version).toBe(4);
    expect(plan.event.actorRole).toBe(UserRole.COORDINATOR);
  });

  it('captures an optional note on the audit event', () => {
    const plan = buildTransitionPlan(current, cmd({ note: '  corroborated by field team  ' }), ctx);
    expect(plan.event.detail).toEqual({ note: 'corroborated by field team' });
    const noNote = buildTransitionPlan(current, cmd({ note: '   ' }), ctx);
    expect(noNote.event.detail).toBeNull();
  });

  it('rejects structurally illegal moves and terminal sources', () => {
    expect(() =>
      buildTransitionPlan(current, cmd({ toStatus: ReportStatus.RESOLVED }), ctx),
    ).toThrow(IllegalTransitionError);
    const rejected: CurrentReport = { ...current, status: ReportStatus.REJECTED };
    expect(() =>
      buildTransitionPlan(rejected, cmd({ toStatus: ReportStatus.VERIFIED }), ctx),
    ).toThrow(IllegalTransitionError);
  });

  it('enforces role authorization', () => {
    // Responder cannot reject.
    expect(() =>
      buildTransitionPlan(
        current,
        cmd({ toStatus: ReportStatus.REJECTED, actorRole: UserRole.RESPONDER }),
        ctx,
      ),
    ).toThrow(TransitionForbiddenError);
    // Citizen cannot drive workflow transitions.
    expect(() => buildTransitionPlan(current, cmd({ actorRole: UserRole.CITIZEN }), ctx)).toThrow(
      TransitionForbiddenError,
    );
  });

  it('enforces the optimistic lock (CONFLICT on stale version)', () => {
    expect(() => buildTransitionPlan(current, cmd({ expectedVersion: 2 }), ctx)).toThrow(
      VersionConflictError,
    );
  });

  it('checks legality before the version (illegal beats stale)', () => {
    expect(() =>
      buildTransitionPlan(current, cmd({ toStatus: ReportStatus.NEW, expectedVersion: 99 }), ctx),
    ).toThrow(IllegalTransitionError);
  });
});
