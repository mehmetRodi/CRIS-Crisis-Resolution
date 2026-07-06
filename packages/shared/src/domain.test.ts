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
