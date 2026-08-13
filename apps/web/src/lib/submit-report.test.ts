import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Category, ReportSubmitError, Urgency, type ReportSubmission } from '@crisismap/shared';

// Mock the shared Amplify client so the wrapper is tested against a
// controllable mutation stub (and without importing real `amplify_outputs.json`).
const submitReportMutation = vi.fn();
vi.mock('./amplify', () => ({
  client: {
    mutations: { submitReport: (...args: unknown[]) => submitReportMutation(...args) },
  },
}));

const { submitReport } = await import('./submit-report');

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

beforeEach(() => {
  submitReportMutation.mockReset();
});

describe('submitReport', () => {
  it('returns the report id and status on success', async () => {
    submitReportMutation.mockResolvedValue({
      data: { id: 'r1', status: 'NEW' },
      errors: null,
    });

    const result = await submitReport(submission(), 'req-1');

    expect(result).toEqual({ reportId: 'r1', status: 'NEW' });
  });

  it('throws a retryable ReportSubmitError when the mutation call itself rejects (offline/DNS/timeout)', async () => {
    submitReportMutation.mockRejectedValue(new Error('Network request failed'));

    await expect(submitReport(submission(), 'req-1')).rejects.toMatchObject({
      name: 'ReportSubmitError',
      retryable: true,
      message: 'Network request failed',
    });
  });

  it('throws a non-retryable ReportSubmitError for an explicit validation error', async () => {
    submitReportMutation.mockResolvedValue({
      data: null,
      errors: [{ message: 'VALIDATION: Report text failed validation.' }],
    });

    let caught: unknown;
    try {
      await submitReport(submission(), 'req-1');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ReportSubmitError);
    expect((caught as ReportSubmitError).retryable).toBe(false);
    expect((caught as ReportSubmitError).message).toBe('Report text failed validation.');
  });

  it('keeps operational GraphQL errors retryable', async () => {
    submitReportMutation.mockResolvedValue({
      data: null,
      errors: [{ message: 'DynamoDB is temporarily unavailable.' }],
    });

    await expect(submitReport(submission(), 'req-1')).rejects.toMatchObject({
      retryable: true,
      message: 'DynamoDB is temporarily unavailable.',
    });
  });

  it('treats a response with no data and no explicit validation error as retryable', async () => {
    submitReportMutation.mockResolvedValue({ data: null, errors: null });

    await expect(submitReport(submission(), 'req-1')).rejects.toMatchObject({
      retryable: true,
      message: 'The report could not be submitted.',
    });
  });
});
