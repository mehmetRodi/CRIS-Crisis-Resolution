import { describe, expect, it } from 'vitest';

import { Category, Urgency } from './domain';
import type { ReportSubmission } from './report-form';
import {
  IDEMPOTENCY_STALENESS_WARNING_MS,
  RETRY_BACKOFF_SCHEDULE_MS,
  ReportSubmitError,
  enqueuePendingReport,
  hasStalePendingReport,
  isRetryDue,
  nextRetryDelayMs,
  recordAttemptFailure,
  removePendingReport,
  type PendingReport,
} from './offline-queue';

const NOW = '2026-08-04T12:00:00.000Z';

function submission(overrides: Partial<ReportSubmission> = {}): ReportSubmission {
  return {
    text: 'Collapsed wall, two people trapped near the market.',
    category: Category.RESCUE,
    subcategory: null,
    urgency: Urgency.CRITICAL,
    anonymous: false,
    contact: null,
    mediaKeys: [],
    lat: null,
    lng: null,
    locationHint: null,
    ...overrides,
  };
}

function pending(overrides: Partial<PendingReport> = {}): PendingReport {
  return {
    clientRequestId: 'req-1',
    submission: submission(),
    queuedAt: NOW,
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
    ...overrides,
  };
}

describe('enqueuePendingReport', () => {
  it('adds a fresh entry with zero attempts', () => {
    const queue = enqueuePendingReport([], submission(), 'req-1', NOW);
    expect(queue).toEqual([
      {
        clientRequestId: 'req-1',
        submission: submission(),
        queuedAt: NOW,
        attempts: 0,
        lastError: null,
        lastAttemptAt: null,
      },
    ]);
  });

  it('replaces rather than duplicates an existing entry for the same clientRequestId', () => {
    const first = enqueuePendingReport([], submission({ text: 'first' }), 'req-1', NOW);
    const second = enqueuePendingReport(
      first,
      submission({ text: 'second' }),
      'req-1',
      '2026-08-04T12:05:00.000Z',
    );
    expect(second).toHaveLength(1);
    expect(second[0]!.submission.text).toBe('second');
  });

  it('appends alongside other queued reports', () => {
    const queue = enqueuePendingReport(
      enqueuePendingReport([], submission(), 'req-1', NOW),
      submission(),
      'req-2',
      NOW,
    );
    expect(queue.map((p) => p.clientRequestId)).toEqual(['req-1', 'req-2']);
  });
});

describe('removePendingReport', () => {
  it('removes only the matching entry', () => {
    const queue = [pending({ clientRequestId: 'req-1' }), pending({ clientRequestId: 'req-2' })];
    expect(removePendingReport(queue, 'req-1').map((p) => p.clientRequestId)).toEqual(['req-2']);
  });

  it('is a no-op when the id is not present', () => {
    const queue = [pending()];
    expect(removePendingReport(queue, 'missing')).toEqual(queue);
  });
});

describe('recordAttemptFailure', () => {
  it('increments attempts and records the error/time on the matching entry only', () => {
    const queue = [pending({ clientRequestId: 'req-1' }), pending({ clientRequestId: 'req-2' })];
    const result = recordAttemptFailure(queue, 'req-1', 'network down', '2026-08-04T12:01:00.000Z');
    expect(result[0]).toMatchObject({
      attempts: 1,
      lastError: 'network down',
      lastAttemptAt: '2026-08-04T12:01:00.000Z',
    });
    expect(result[1]).toEqual(queue[1]);
  });

  it('accumulates across repeated failures', () => {
    let queue = [pending()];
    queue = recordAttemptFailure(queue, 'req-1', 'err1', '2026-08-04T12:01:00.000Z');
    queue = recordAttemptFailure(queue, 'req-1', 'err2', '2026-08-04T12:02:00.000Z');
    expect(queue[0]!.attempts).toBe(2);
    expect(queue[0]!.lastError).toBe('err2');
  });
});

describe('nextRetryDelayMs', () => {
  it('returns 0 for a report that has never failed', () => {
    expect(nextRetryDelayMs(0)).toBe(0);
  });

  it('follows the backoff schedule for each attempt count', () => {
    RETRY_BACKOFF_SCHEDULE_MS.forEach((delay, i) => {
      expect(nextRetryDelayMs(i + 1)).toBe(delay);
    });
  });

  it('caps at the last schedule entry beyond its length', () => {
    const max = RETRY_BACKOFF_SCHEDULE_MS[RETRY_BACKOFF_SCHEDULE_MS.length - 1];
    expect(nextRetryDelayMs(RETRY_BACKOFF_SCHEDULE_MS.length + 5)).toBe(max);
  });
});

describe('isRetryDue', () => {
  it('is due immediately for a report that has never been attempted', () => {
    expect(isRetryDue(pending({ attempts: 0, lastAttemptAt: null }), NOW)).toBe(true);
  });

  it('is not due before its backoff window elapses', () => {
    const report = pending({ attempts: 1, lastAttemptAt: '2026-08-04T12:00:00.000Z' });
    // First backoff entry is 30s; only 10s have passed.
    expect(isRetryDue(report, '2026-08-04T12:00:10.000Z')).toBe(false);
  });

  it('is due once its backoff window elapses', () => {
    const report = pending({ attempts: 1, lastAttemptAt: '2026-08-04T12:00:00.000Z' });
    expect(isRetryDue(report, '2026-08-04T12:00:30.000Z')).toBe(true);
  });
});

describe('hasStalePendingReport', () => {
  it('is false for an empty queue', () => {
    expect(hasStalePendingReport([], NOW)).toBe(false);
  });

  it('is false just under the staleness threshold', () => {
    const justUnder = new Date(
      new Date(NOW).getTime() - (IDEMPOTENCY_STALENESS_WARNING_MS - 1000),
    ).toISOString();
    expect(hasStalePendingReport([pending({ queuedAt: justUnder })], NOW)).toBe(false);
  });

  it('is true at or past the staleness threshold', () => {
    const atThreshold = new Date(
      new Date(NOW).getTime() - IDEMPOTENCY_STALENESS_WARNING_MS,
    ).toISOString();
    expect(hasStalePendingReport([pending({ queuedAt: atThreshold })], NOW)).toBe(true);
  });
});

describe('ReportSubmitError', () => {
  it('carries the retryable flag and behaves like a normal Error', () => {
    const err = new ReportSubmitError('offline', true);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ReportSubmitError');
    expect(err.message).toBe('offline');
    expect(err.retryable).toBe(true);
  });

  it('supports a non-retryable classification', () => {
    expect(new ReportSubmitError('rejected', false).retryable).toBe(false);
  });
});
