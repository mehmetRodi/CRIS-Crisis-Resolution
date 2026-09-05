import { describe, expect, it } from 'vitest';
import { ReportStatus, UserRole, WorkAction } from '@crisismap/shared';
import { buildWorkUpdate, type WorkRecord } from './core';
const current: WorkRecord = {
  id: 'r1',
  version: 0,
  updates: [],
  createdAt: '2026-09-05T00:00:00Z',
  updatedAt: '2026-09-05T00:00:00Z',
};
const actor = { id: 'volunteer-1', role: UserRole.VOLUNTEER, label: 'Volunteer' };
const context = { now: '2026-09-05T01:00:00Z', eventId: 'event-1' };
const claimed = { ...current, version: 1, assigneeId: actor.id, assigneeLabel: actor.label };
describe('Work ownership guards', () => {
  it('claims a verified report for the authenticated actor', () => {
    expect(
      buildWorkUpdate(
        current,
        ReportStatus.VERIFIED,
        actor,
        { action: WorkAction.CLAIM, expectedVersion: 0 },
        context,
      ),
    ).toMatchObject({ assigneeId: actor.id, version: 1 });
  });
  it('rejects a second claim and stale writes', () => {
    expect(() =>
      buildWorkUpdate(
        claimed,
        ReportStatus.VERIFIED,
        actor,
        { action: WorkAction.CLAIM, expectedVersion: 1 },
        context,
      ),
    ).toThrow('CONFLICT');
    expect(() =>
      buildWorkUpdate(
        claimed,
        ReportStatus.VERIFIED,
        actor,
        { action: WorkAction.NOTE, expectedVersion: 0, note: 'On site' },
        context,
      ),
    ).toThrow('CONFLICT');
  });
  it.each([
    ReportStatus.NEW,
    ReportStatus.NEEDS_VERIFICATION,
    ReportStatus.RESOLVED,
    ReportStatus.REJECTED,
  ])('refuses to claim %s', (status) => {
    expect(() =>
      buildWorkUpdate(
        current,
        status,
        actor,
        { action: WorkAction.CLAIM, expectedVersion: 0 },
        context,
      ),
    ).toThrow('ILLEGAL');
  });
  it('refuses updates and releases by another volunteer', () => {
    for (const action of [WorkAction.NOTE, WorkAction.RELEASE])
      expect(() =>
        buildWorkUpdate(
          claimed,
          ReportStatus.VERIFIED,
          { ...actor, id: 'other' },
          { action, expectedVersion: 1, note: 'On site' },
          context,
        ),
      ).toThrow('FORBIDDEN');
  });
  it('allows the owner to add a bounded note and release ownership', () => {
    const next = buildWorkUpdate(
      claimed,
      ReportStatus.VERIFIED,
      actor,
      { action: WorkAction.NOTE, expectedVersion: 1, note: ' Arrived on site. ' },
      context,
    );
    expect(next.updates[0]).toMatchObject({ text: 'Arrived on site.', authorLabel: actor.label });
    expect(
      buildWorkUpdate(
        next,
        ReportStatus.VERIFIED,
        actor,
        { action: WorkAction.RELEASE, expectedVersion: 2 },
        context,
      ),
    ).not.toHaveProperty('assigneeId');
  });
  it('allows coordinators to assign a person and rejects volunteer assignment', () => {
    const command = {
      action: WorkAction.ASSIGN,
      expectedVersion: 0,
      target: { id: 'responder-1', label: 'Responder' },
    };
    expect(() => buildWorkUpdate(current, ReportStatus.VERIFIED, actor, command, context)).toThrow(
      'FORBIDDEN',
    );
    expect(
      buildWorkUpdate(
        current,
        ReportStatus.VERIFIED,
        { ...actor, role: UserRole.ADMIN },
        command,
        context,
      ).assigneeId,
    ).toBe('responder-1');
  });
  it('rejects empty and oversized notes and notes on closed reports', () => {
    for (const note of ['', ' '.repeat(10), 'x'.repeat(2001)])
      expect(() =>
        buildWorkUpdate(
          claimed,
          ReportStatus.VERIFIED,
          actor,
          { action: WorkAction.NOTE, expectedVersion: 1, note },
          context,
        ),
      ).toThrow('VALIDATION');
    expect(() =>
      buildWorkUpdate(
        claimed,
        ReportStatus.RESOLVED,
        actor,
        { action: WorkAction.NOTE, expectedVersion: 1, note: 'Done' },
        context,
      ),
    ).toThrow('ILLEGAL');
  });
});
