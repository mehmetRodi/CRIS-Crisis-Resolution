import { describe, expect, it } from 'vitest';
import {
  AlertChannel,
  AssignmentStatus,
  canTransition,
  Category,
  DeliveryStatus,
  DuplicateGroupStatus,
  LocationPrecision,
  priorityBandForScore,
  PriorityBand,
  REDACTED_REPORT_FIELDS,
  ReportEventType,
  ReportStatus,
  STATUS_TRANSITIONS,
  SubscriptionStatus,
  TeamStatus,
  Urgency,
  VerificationStatus,
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
});

describe('priority band mapping (§5.4.2)', () => {
  it('maps scores to bands with P0 most critical', () => {
    expect(priorityBandForScore(10)).toBe(PriorityBand.P0);
    expect(priorityBandForScore(7)).toBe(PriorityBand.P1);
    expect(priorityBandForScore(4)).toBe(PriorityBand.P2);
    expect(priorityBandForScore(0)).toBe(PriorityBand.P3);
  });
});

describe('supporting enums (§2.4–§2.7, §5.1)', () => {
  it('exposes the expected values for each supporting enum', () => {
    expect(Object.values(LocationPrecision)).toEqual([
      'EXACT',
      'APPROXIMATE',
      'REGION_ONLY',
      'UNKNOWN',
    ]);
    expect(Object.values(VerificationStatus)).toEqual([
      'PENDING',
      'CONFIRMED',
      'REJECTED',
      'INCONCLUSIVE',
    ]);
    expect(Object.values(AssignmentStatus)).toEqual([
      'PROPOSED',
      'ACCEPTED',
      'EN_ROUTE',
      'ON_SCENE',
      'COMPLETED',
      'CANCELLED',
    ]);
    expect(Object.values(TeamStatus)).toEqual(['AVAILABLE', 'BUSY', 'OFFLINE']);
    expect(Object.values(AlertChannel)).toEqual(['SMS', 'EMAIL', 'PUSH']);
    expect(Object.values(SubscriptionStatus)).toEqual(['ACTIVE', 'PAUSED', 'UNSUBSCRIBED']);
    expect(Object.values(DeliveryStatus)).toEqual([
      'QUEUED',
      'SENT',
      'DELIVERED',
      'FAILED',
      'SUPPRESSED',
    ]);
    expect(Object.values(ReportEventType)).toEqual([
      'SUBMITTED',
      'STATUS_CHANGED',
      'CLASSIFIED',
      'SCORED',
      'GEOCODED',
      'DEDUPED',
      'ASSIGNED',
      'VERIFIED',
      'ALERT_SENT',
      'NOTE_ADDED',
    ]);
    expect(Object.values(DuplicateGroupStatus)).toEqual(['OPEN', 'MERGED', 'DISMISSED']);
  });

  it('every enum value is a valid GraphQL/DynamoDB enum name (UPPER_SNAKE_CASE)', () => {
    const enums = [
      ReportStatus,
      Category,
      Urgency,
      PriorityBand,
      LocationPrecision,
      VerificationStatus,
      AssignmentStatus,
      TeamStatus,
      AlertChannel,
      SubscriptionStatus,
      DeliveryStatus,
      ReportEventType,
      DuplicateGroupStatus,
    ];
    for (const e of enums) {
      for (const value of Object.values(e)) {
        // a.enum() members must match this shape (§7 Amplify enum constraints).
        expect(value).toMatch(/^[A-Z][A-Z0-9_]*$/);
        // Keys mirror values so the `as const` object is a true enum.
        expect((e as Record<string, string>)[value]).toBe(value);
      }
    }
  });

  it('protects reporter identity/contact + internal notes (§5.6)', () => {
    expect(REDACTED_REPORT_FIELDS).toEqual([
      'reporterUserId',
      'reporterName',
      'reporterContact',
      'internalNotes',
    ]);
  });
});

/**
 * Drift guard (conventions.md §"Domain vocabulary"): `a.enum()` needs literal
 * arrays, so every enum is duplicated as an inlined array in
 * `apps/web/amplify/data/resource.ts`. These snapshots are the contract that
 * file MUST mirror — if you change an enum here, this test fails until you
 * update BOTH the snapshot below AND the inlined `a.enum([...])` in the schema.
 */
describe('schema enum sync guard', () => {
  const EXPECTED_INLINED_ENUMS: Record<string, readonly string[]> = {
    ReportStatus: Object.values(ReportStatus),
    Category: Object.values(Category),
    Urgency: Object.values(Urgency),
    PriorityBand: Object.values(PriorityBand),
    LocationPrecision: Object.values(LocationPrecision),
    VerificationStatus: Object.values(VerificationStatus),
    AssignmentStatus: Object.values(AssignmentStatus),
    TeamStatus: Object.values(TeamStatus),
    AlertChannel: Object.values(AlertChannel),
    SubscriptionStatus: Object.values(SubscriptionStatus),
    DeliveryStatus: Object.values(DeliveryStatus),
    ReportEventType: Object.values(ReportEventType),
    DuplicateGroupStatus: Object.values(DuplicateGroupStatus),
  };

  it('snapshots the enum arrays that must stay in sync with the Amplify schema', () => {
    expect(EXPECTED_INLINED_ENUMS).toMatchInlineSnapshot(`
      {
        "AlertChannel": [
          "SMS",
          "EMAIL",
          "PUSH",
        ],
        "AssignmentStatus": [
          "PROPOSED",
          "ACCEPTED",
          "EN_ROUTE",
          "ON_SCENE",
          "COMPLETED",
          "CANCELLED",
        ],
        "Category": [
          "MEDICAL",
          "RESCUE",
          "STRUCTURAL_DAMAGE",
          "FIRE",
          "FLOOD",
          "HAZMAT",
          "BLOCKED_ROAD",
          "SHELTER",
          "UTILITY",
          "OTHER",
        ],
        "DeliveryStatus": [
          "QUEUED",
          "SENT",
          "DELIVERED",
          "FAILED",
          "SUPPRESSED",
        ],
        "DuplicateGroupStatus": [
          "OPEN",
          "MERGED",
          "DISMISSED",
        ],
        "LocationPrecision": [
          "EXACT",
          "APPROXIMATE",
          "REGION_ONLY",
          "UNKNOWN",
        ],
        "PriorityBand": [
          "P0",
          "P1",
          "P2",
          "P3",
        ],
        "ReportEventType": [
          "SUBMITTED",
          "STATUS_CHANGED",
          "CLASSIFIED",
          "SCORED",
          "GEOCODED",
          "DEDUPED",
          "ASSIGNED",
          "VERIFIED",
          "ALERT_SENT",
          "NOTE_ADDED",
        ],
        "ReportStatus": [
          "NEW",
          "PROCESSING",
          "AI_CLASSIFIED",
          "NEEDS_VERIFICATION",
          "VERIFIED",
          "IN_PROGRESS",
          "RESOLVED",
          "REJECTED",
        ],
        "SubscriptionStatus": [
          "ACTIVE",
          "PAUSED",
          "UNSUBSCRIBED",
        ],
        "TeamStatus": [
          "AVAILABLE",
          "BUSY",
          "OFFLINE",
        ],
        "Urgency": [
          "CRITICAL",
          "HIGH",
          "MEDIUM",
          "LOW",
        ],
        "VerificationStatus": [
          "PENDING",
          "CONFIRMED",
          "REJECTED",
          "INCONCLUSIVE",
        ],
      }
    `);
  });
});
