import { describe, expect, it } from 'vitest';
import {
  AlertChannel,
  AlertDeliveryStatus,
  AssignmentStatus,
  canActorTransition,
  canTransition,
  Category,
  DuplicateLinkType,
  isTerminalStatus,
  priorityBandForScore,
  PriorityBand,
  PUBLIC_REPORT_FIELDS,
  ReportEventType,
  ReportStatus,
  rolesForTransition,
  STATUS_TRANSITIONS,
  toPublicReport,
  TRANSITION_ROLES,
  Urgency,
  UserRole,
  VerificationOutcome,
  type RedactableReport,
} from './domain';

describe('report state machine', () => {
  it('allows the documented happy-path transitions (§5.1)', () => {
    expect(canTransition(ReportStatus.NEW, ReportStatus.PROCESSING)).toBe(true);
    expect(canTransition(ReportStatus.PROCESSING, ReportStatus.AI_CLASSIFIED)).toBe(true);
    expect(canTransition(ReportStatus.AI_CLASSIFIED, ReportStatus.VERIFIED)).toBe(true);
    expect(canTransition(ReportStatus.VERIFIED, ReportStatus.IN_PROGRESS)).toBe(true);
    expect(canTransition(ReportStatus.IN_PROGRESS, ReportStatus.RESOLVED)).toBe(true);
  });

  it('supports low-confidence escalation and reopen', () => {
    expect(canTransition(ReportStatus.PROCESSING, ReportStatus.NEEDS_VERIFICATION)).toBe(true);
    expect(canTransition(ReportStatus.RESOLVED, ReportStatus.IN_PROGRESS)).toBe(true);
  });

  it('rejects illegal jumps and treats REJECTED as terminal', () => {
    expect(canTransition(ReportStatus.NEW, ReportStatus.RESOLVED)).toBe(false);
    expect(canTransition(ReportStatus.NEW, ReportStatus.VERIFIED)).toBe(false);
    expect(STATUS_TRANSITIONS.REJECTED).toHaveLength(0);
  });

  it('identifies terminal states (only REJECTED today)', () => {
    expect(isTerminalStatus(ReportStatus.REJECTED)).toBe(true);
    expect(isTerminalStatus(ReportStatus.RESOLVED)).toBe(false); // can reopen
    expect(isTerminalStatus(ReportStatus.NEW)).toBe(false);
  });
});

describe('transition authorization (§5.6)', () => {
  it('keeps TRANSITION_ROLES a subset of the structural state machine', () => {
    for (const from of Object.keys(TRANSITION_ROLES) as ReportStatus[]) {
      for (const to of Object.keys(TRANSITION_ROLES[from]) as ReportStatus[]) {
        expect(canTransition(from, to)).toBe(true);
      }
    }
  });

  it('reserves classification transitions for the pipeline (SYSTEM)', () => {
    expect(rolesForTransition(ReportStatus.NEW, ReportStatus.PROCESSING)).toEqual(['SYSTEM']);
    expect(canActorTransition('SYSTEM', ReportStatus.PROCESSING, ReportStatus.AI_CLASSIFIED)).toBe(
      true,
    );
    expect(
      canActorTransition(UserRole.COORDINATOR, ReportStatus.NEW, ReportStatus.PROCESSING),
    ).toBe(false);
  });

  it('gates rejection and reopen to coordinators', () => {
    expect(
      canActorTransition(UserRole.RESPONDER, ReportStatus.VERIFIED, ReportStatus.REJECTED),
    ).toBe(false);
    expect(
      canActorTransition(UserRole.COORDINATOR, ReportStatus.VERIFIED, ReportStatus.REJECTED),
    ).toBe(true);
    expect(
      canActorTransition(UserRole.RESPONDER, ReportStatus.RESOLVED, ReportStatus.IN_PROGRESS),
    ).toBe(false);
  });

  it('lets responders confirm and progress, and ADMIN do any legal move', () => {
    expect(
      canActorTransition(UserRole.RESPONDER, ReportStatus.VERIFIED, ReportStatus.IN_PROGRESS),
    ).toBe(true);
    expect(canActorTransition(UserRole.ADMIN, ReportStatus.NEW, ReportStatus.PROCESSING)).toBe(
      true,
    );
    // ADMIN still cannot make a structurally illegal jump.
    expect(canActorTransition(UserRole.ADMIN, ReportStatus.NEW, ReportStatus.RESOLVED)).toBe(false);
  });
});

describe('public projection (§5.3, §5.6)', () => {
  const internal: RedactableReport = {
    id: 'rpt-1',
    status: ReportStatus.VERIFIED,
    category: Category.MEDICAL,
    urgency: Urgency.CRITICAL,
    priorityScore: 9.2,
    priorityBand: PriorityBand.P0,
    summary: 'Multiple casualties reported near the market.',
    lat: 40.1,
    lng: -73.9,
    geohash: 'dr5regw',
    geohashPrefix: 'dr5re',
    regionId: 'region-7',
    createdAt: '2026-07-06T12:00:00.000Z',
    updatedAt: '2026-07-06T12:05:00.000Z',
    // Sensitive — must never appear on the projection.
    text: 'My name is Jane Doe, call me at 555-0100',
    reporterId: 'user-123',
    reporterContact: 'jane@example.com',
    notes: 'internal: reporter is off-duty EMT',
  };

  it('copies only the allow-listed public fields', () => {
    const publicReport = toPublicReport(internal);
    expect(Object.keys(publicReport).sort()).toEqual([...PUBLIC_REPORT_FIELDS].sort());
  });

  it('never leaks identity, contact, raw text, or internal notes', () => {
    const serialized = JSON.stringify(toPublicReport(internal));
    expect(serialized).not.toContain('Jane Doe');
    expect(serialized).not.toContain('jane@example.com');
    expect(serialized).not.toContain('user-123');
    expect(serialized).not.toContain('off-duty');
    for (const forbidden of ['text', 'reporterId', 'reporterContact', 'notes']) {
      expect(toPublicReport(internal)).not.toHaveProperty(forbidden);
    }
  });

  it('preserves the safe operational fields the map needs', () => {
    const publicReport = toPublicReport(internal);
    expect(publicReport.reportId).toBe('rpt-1');
    expect(publicReport.priorityBand).toBe(PriorityBand.P0);
    expect(publicReport.summary).toContain('casualties');
    expect(publicReport.geohash).toBe('dr5regw');
  });
});

describe('priority band mapping (§5.4.2)', () => {
  it('maps scores to bands with P0 most critical', () => {
    expect(priorityBandForScore(10)).toBe(PriorityBand.P0);
    expect(priorityBandForScore(7)).toBe(PriorityBand.P1);
    expect(priorityBandForScore(4)).toBe(PriorityBand.P2);
    expect(priorityBandForScore(0)).toBe(PriorityBand.P3);
  });
});

/**
 * Drift guard (CLAUDE.md, docs/conventions.md): `a.enum()` needs literal arrays,
 * so every enum that keys or constrains a field in `apps/web/amplify/data/resource.ts`
 * is duplicated there as an inlined `a.enum([...])`. The expected arrays below are
 * the contract that schema MUST mirror — change an enum in domain.ts and this test
 * fails until you update BOTH this expectation AND the inlined array in the schema
 * (in the same PR). Order matters: it mirrors the source-of-truth declaration order.
 */
describe('schema enum sync guard', () => {
  it('pins the enum arrays that must stay identical to the Amplify schema', () => {
    expect(Object.values(ReportStatus)).toEqual([
      'NEW',
      'PROCESSING',
      'AI_CLASSIFIED',
      'NEEDS_VERIFICATION',
      'VERIFIED',
      'IN_PROGRESS',
      'RESOLVED',
      'REJECTED',
    ]);
    expect(Object.values(Category)).toEqual([
      'MEDICAL',
      'RESCUE',
      'STRUCTURAL_DAMAGE',
      'FIRE',
      'FLOOD',
      'HAZMAT',
      'BLOCKED_ROAD',
      'SHELTER',
      'UTILITY',
      'OTHER',
    ]);
    expect(Object.values(Urgency)).toEqual(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
    expect(Object.values(PriorityBand)).toEqual(['P0', 'P1', 'P2', 'P3']);
    expect(Object.values(UserRole)).toEqual([
      'CITIZEN',
      'VOLUNTEER',
      'RESPONDER',
      'COORDINATOR',
      'ADMIN',
    ]);
    expect(Object.values(VerificationOutcome)).toEqual(['CONFIRMED', 'REJECTED', 'INCONCLUSIVE']);
    expect(Object.values(AssignmentStatus)).toEqual([
      'PROPOSED',
      'ASSIGNED',
      'ACCEPTED',
      'EN_ROUTE',
      'ON_SCENE',
      'COMPLETED',
      'CANCELLED',
    ]);
    expect(Object.values(DuplicateLinkType)).toEqual(['STRONG', 'SUGGESTED']);
    expect(Object.values(AlertChannel)).toEqual(['SMS', 'EMAIL', 'PUSH']);
    expect(Object.values(AlertDeliveryStatus)).toEqual(['PENDING', 'SENT', 'DELIVERED', 'FAILED']);
    expect(Object.values(ReportEventType)).toEqual([
      'SUBMITTED',
      'STATUS_CHANGED',
      'CLASSIFIED',
      'PRIORITY_SCORED',
      'VERIFICATION_RECORDED',
      'ASSIGNED',
      'WORK_UPDATED',
      'DUPLICATE_LINKED',
      'ALERT_DISPATCHED',
    ]);
  });

  it('every enum value is a valid GraphQL/DynamoDB enum name (UPPER_SNAKE_CASE)', () => {
    const enums = [
      ReportStatus,
      Category,
      Urgency,
      PriorityBand,
      UserRole,
      VerificationOutcome,
      AssignmentStatus,
      DuplicateLinkType,
      AlertChannel,
      AlertDeliveryStatus,
      ReportEventType,
    ];
    for (const e of enums) {
      for (const value of Object.values(e)) {
        expect(value).toMatch(/^[A-Z][A-Z0-9_]*$/);
        // Keys mirror values so the `as const` object is a true enum.
        expect((e as Record<string, string>)[value]).toBe(value);
      }
    }
  });
});
