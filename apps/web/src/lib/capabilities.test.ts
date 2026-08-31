import { describe, expect, it } from 'vitest';
import { ReportStatus, UserRole } from '@crisismap/shared';

import { capabilitiesFor, transitionsFor } from './capabilities';

/**
 * Role capabilities (CRIS-54, ADR-0055).
 *
 * These are PRESENTATION rules, not enforcement — the server rejects an
 * unauthorized caller regardless. But they decide which controls a role is
 * offered, and a control that is offered and then refused reads as a broken
 * product, so each flag is pinned against the server rule it mirrors.
 */
describe('capabilitiesFor', () => {
  it('gives no capability at all to a signed-out caller', () => {
    const capabilities = capabilitiesFor(null);
    expect(capabilities.isOperational).toBe(false);
    expect(capabilities.canReadIncidentFeed).toBe(false);
    expect(capabilities.canReadVolunteerTasks).toBe(false);
    expect(capabilities.canTransitionStatus).toBe(false);
    expect(capabilities.canAssignTeam).toBe(false);
  });

  it('keeps a bare CITIZEN out of the operational workspace entirely', () => {
    // A citizen account is created by the post-confirmation trigger for every
    // sign-up, so this is the DEFAULT signed-in state — not an edge case.
    const capabilities = capabilitiesFor(UserRole.CITIZEN);
    expect(capabilities.isOperational).toBe(false);
    expect(capabilities.canReadIncidentFeed).toBe(false);
    expect(capabilities.canReadVolunteerTasks).toBe(false);
  });

  it('routes a VOLUNTEER to the task board because they have no coordinates', () => {
    const capabilities = capabilitiesFor(UserRole.VOLUNTEER);
    // The `VolunteerTask` projection carries no lat/lng at all (ADR-0042), so a
    // map for this role could only ever render empty — which would read as "no
    // incidents nearby" rather than "not shown to you".
    expect(capabilities.view).toBe('tasks');
    expect(capabilities.canReadIncidentFeed).toBe(false);
    expect(capabilities.canReadVolunteerTasks).toBe(true);
    expect(capabilities.canTransitionStatus).toBe(false);
    expect(capabilities.canAssignTeam).toBe(false);
  });

  it.each([UserRole.RESPONDER, UserRole.COORDINATOR, UserRole.ADMIN])(
    'routes %s to the incident map',
    (role) => {
      const capabilities = capabilitiesFor(role);
      expect(capabilities.view).toBe('incidents');
      expect(capabilities.canReadIncidentFeed).toBe(true);
      expect(capabilities.canViewTimeline).toBe(true);
      expect(capabilities.canTransitionStatus).toBe(true);
    },
  );

  it('withholds team assignment from a RESPONDER', () => {
    // Mirrors `assignTeam`'s COORDINATOR/ADMIN group rule, which has no
    // per-actor matrix behind it — the group gate is the entire check.
    expect(capabilitiesFor(UserRole.RESPONDER).canAssignTeam).toBe(false);
    expect(capabilitiesFor(UserRole.COORDINATOR).canAssignTeam).toBe(true);
    expect(capabilitiesFor(UserRole.ADMIN).canAssignTeam).toBe(true);
  });
});

describe('transitionsFor', () => {
  it('hides SYSTEM-only pipeline moves from responders and coordinators', () => {
    // NEW → PROCESSING and the classification outcomes belong to the triage
    // worker. `TRANSITION_ROLES` grants them to SYSTEM alone, so offering them
    // as buttons would produce a guaranteed FORBIDDEN from the resolver.
    for (const role of [UserRole.RESPONDER, UserRole.COORDINATOR]) {
      expect(transitionsFor(ReportStatus.NEW, role)).toEqual([]);
      expect(transitionsFor(ReportStatus.PROCESSING, role)).toEqual([]);
    }
  });

  it('keeps the ADMIN override the shared model grants, rather than diverging', () => {
    // `canActorTransition` gives ADMIN every STRUCTURALLY legal move, pipeline
    // moves included, and `updateReportStatus` accepts the ADMIN group — so the
    // server really would perform this. Hiding it here would put the UI out of
    // step with the authority it claims to mirror, which is the drift this
    // module exists to prevent. Whether an admin SHOULD be able to hand-drive
    // the pipeline is a question for the domain model, not for the buttons.
    expect(transitionsFor(ReportStatus.NEW, UserRole.ADMIN)).toEqual([ReportStatus.PROCESSING]);
  });

  it('lets a coordinator reject but not a responder', () => {
    expect(transitionsFor(ReportStatus.AI_CLASSIFIED, UserRole.COORDINATOR)).toContain(
      ReportStatus.REJECTED,
    );
    expect(transitionsFor(ReportStatus.AI_CLASSIFIED, UserRole.RESPONDER)).not.toContain(
      ReportStatus.REJECTED,
    );
  });

  it('offers reopening a resolved incident to coordinators only', () => {
    expect(transitionsFor(ReportStatus.RESOLVED, UserRole.COORDINATOR)).toEqual([
      ReportStatus.IN_PROGRESS,
    ]);
    expect(transitionsFor(ReportStatus.RESOLVED, UserRole.RESPONDER)).toEqual([]);
  });

  it('offers nothing from the terminal REJECTED state, even to an admin', () => {
    expect(transitionsFor(ReportStatus.REJECTED, UserRole.ADMIN)).toEqual([]);
  });
});
