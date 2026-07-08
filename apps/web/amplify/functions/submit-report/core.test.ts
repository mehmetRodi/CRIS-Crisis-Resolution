import { describe, expect, it } from 'vitest';
import { ReportEventType, ReportStatus } from '@crisismap/shared';
import {
  buildInitialReport,
  buildSubmitEvent,
  buildSubmitPlan,
  forDynamoItem,
  IDEMPOTENCY_TTL_SECONDS,
  MAX_TEXT_LENGTH,
  SubmitValidationError,
  validateSubmitInput,
  type SubmitContext,
  type SubmitReportInput,
} from './core';

const ctx: SubmitContext = {
  reportId: '01J000000000000000000RPT',
  eventId: '01J000000000000000000EVT',
  now: '2026-07-06T12:00:00.000Z',
};

const base: SubmitReportInput = {
  text: 'Building collapse on Main St, people trapped',
  clientRequestId: 'req-123',
};

describe('validateSubmitInput', () => {
  it('accepts a minimal valid report', () => {
    expect(() => validateSubmitInput(base)).not.toThrow();
  });

  it('requires non-empty text and a client request id', () => {
    expect(() => validateSubmitInput({ ...base, text: '   ' })).toThrow(SubmitValidationError);
    expect(() => validateSubmitInput({ ...base, clientRequestId: '' })).toThrow(
      SubmitValidationError,
    );
  });

  it('rejects over-long text', () => {
    expect(() => validateSubmitInput({ ...base, text: 'x'.repeat(MAX_TEXT_LENGTH + 1) })).toThrow(
      SubmitValidationError,
    );
  });

  it('requires lat and lng together and in range', () => {
    expect(() => validateSubmitInput({ ...base, lat: 40 })).toThrow(/together/);
    expect(() => validateSubmitInput({ ...base, lat: 200, lng: 10 })).toThrow(/lat/);
    expect(() => validateSubmitInput({ ...base, lat: 40, lng: 999 })).toThrow(/lng/);
    expect(() => validateSubmitInput({ ...base, lat: 40.1, lng: -73.9 })).not.toThrow();
  });
});

describe('buildInitialReport', () => {
  it('starts every report at NEW / version 1', () => {
    const report = buildInitialReport(base, ctx);
    expect(report.status).toBe(ReportStatus.NEW);
    expect(report.version).toBe(1);
    expect(report.id).toBe(ctx.reportId);
    expect(report.createdAt).toBe(ctx.now);
  });

  it('drops reporter identity and contact for anonymous submissions (§2.1, §5.6)', () => {
    const report = buildInitialReport(
      { ...base, isAnonymous: true, reporterId: 'user-1', reporterContact: 'a@b.co' },
      ctx,
    );
    expect(report.isAnonymous).toBe(true);
    expect(report.reporterId).toBeNull();
    expect(report.reporterContact).toBeNull();
  });

  it('retains contact for identified submissions', () => {
    const report = buildInitialReport(
      { ...base, reporterId: 'user-1', reporterContact: 'a@b.co' },
      ctx,
    );
    expect(report.reporterId).toBe('user-1');
    expect(report.reporterContact).toBe('a@b.co');
  });
});

describe('buildSubmitEvent', () => {
  it('opens the audit trail with a SUBMITTED event at version 1', () => {
    const report = buildInitialReport(base, ctx);
    const event = buildSubmitEvent(report, ctx);
    expect(event.type).toBe(ReportEventType.SUBMITTED);
    expect(event.toStatus).toBe(ReportStatus.NEW);
    expect(event.version).toBe(1);
    expect(event.eventId).toBe(ctx.eventId);
  });

  it('attributes anonymous reports to ANONYMOUS with no role', () => {
    const report = buildInitialReport({ ...base, isAnonymous: true }, ctx);
    const event = buildSubmitEvent(report, ctx);
    expect(event.actorId).toBe('ANONYMOUS');
    expect(event.actorRole).toBeNull();
  });
});

describe('buildSubmitPlan', () => {
  it('keys idempotency on the client request id and points it at the report', () => {
    const plan = buildSubmitPlan(base, ctx);
    expect(plan.idempotency.idempotencyKey).toBe('req-123');
    expect(plan.idempotency.reportId).toBe(ctx.reportId);
    expect(plan.idempotency.expiresAt).toBe(
      Math.floor(Date.parse(ctx.now) / 1000) + IDEMPOTENCY_TTL_SECONDS,
    );
  });

  it('validates before building', () => {
    expect(() => buildSubmitPlan({ ...base, text: '' }, ctx)).toThrow(SubmitValidationError);
  });
});

describe('forDynamoItem', () => {
  it('drops null and undefined attributes (DynamoDB rejects NULL on index keys)', () => {
    const report = buildInitialReport({ ...base, lat: 40.1, lng: -73.9 }, ctx);
    const item = forDynamoItem(report);
    // Unset indexed attributes must be absent, not null.
    expect('regionId' in item).toBe(false);
    expect('reporterContact' in item).toBe(false);
    // Set attributes survive, including falsy-but-valid ones.
    expect(item.id).toBe(ctx.reportId);
    expect(item.version).toBe(1);
    expect(item.isAnonymous).toBe(false);
    expect(item.lat).toBe(40.1);
    expect(item.mediaKeys).toEqual([]);
  });

  it('keeps empty strings and zeroes — only null/undefined are dropped', () => {
    expect(forDynamoItem({ a: '', b: 0, c: false, d: null, e: undefined })).toEqual({
      a: '',
      b: 0,
      c: false,
    });
  });
});
