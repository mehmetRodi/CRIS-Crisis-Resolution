import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the shared Amplify client so the wrapper is tested against a controllable
// mutation stub (and without importing real `amplify_outputs.json`).
const updateReportStatus = vi.fn();
vi.mock('./amplify', () => ({
  client: {
    mutations: { updateReportStatus: (...args: unknown[]) => updateReportStatus(...args) },
  },
}));

const { classifyTransitionError, transitionReportStatus, TransitionError } =
  await import('./transition-report');

beforeEach(() => {
  updateReportStatus.mockReset();
});

describe('classifyTransitionError', () => {
  it('maps each resolver code prefix to a typed error', () => {
    expect(classifyTransitionError('CONFLICT: modified concurrently').code).toBe('CONFLICT');
    expect(classifyTransitionError('FORBIDDEN: not permitted').code).toBe('FORBIDDEN');
    expect(classifyTransitionError('ILLEGAL_TRANSITION: NEW → RESOLVED').code).toBe(
      'ILLEGAL_TRANSITION',
    );
    expect(classifyTransitionError('NOT_FOUND: report x').code).toBe('NOT_FOUND');
  });

  it('strips the code prefix from the human message', () => {
    expect(classifyTransitionError('CONFLICT: refetch and retry.').message).toBe(
      'refetch and retry.',
    );
  });

  it('falls back to UNKNOWN for unrecognized or missing messages', () => {
    expect(classifyTransitionError('some network blip').code).toBe('UNKNOWN');
    expect(classifyTransitionError(undefined).code).toBe('UNKNOWN');
  });
});

describe('transitionReportStatus', () => {
  it('forwards the command and returns the new status + version on success', async () => {
    updateReportStatus.mockResolvedValue({
      data: { id: 'r1', status: 'VERIFIED', version: 4 },
      errors: null,
    });

    const result = await transitionReportStatus({
      reportId: 'r1',
      toStatus: 'VERIFIED',
      expectedVersion: 3,
      note: 'looks legit',
    });

    expect(updateReportStatus).toHaveBeenCalledWith({
      reportId: 'r1',
      toStatus: 'VERIFIED',
      expectedVersion: 3,
      note: 'looks legit',
    });
    expect(result).toEqual({ reportId: 'r1', status: 'VERIFIED', version: 4 });
  });

  it('throws a typed CONFLICT error when the version is stale', async () => {
    updateReportStatus.mockResolvedValue({
      data: null,
      errors: [{ message: 'CONFLICT: report was modified concurrently; refetch and retry.' }],
    });

    await expect(
      transitionReportStatus({ reportId: 'r1', toStatus: 'VERIFIED', expectedVersion: 1 }),
    ).rejects.toMatchObject({ name: 'TransitionError', code: 'CONFLICT' });
  });

  it('throws a typed FORBIDDEN error when the role is not permitted', async () => {
    updateReportStatus.mockResolvedValue({
      data: null,
      errors: [
        { message: 'FORBIDDEN: RESPONDER is not permitted to perform AI_CLASSIFIED → REJECTED.' },
      ],
    });

    await expect(
      transitionReportStatus({ reportId: 'r1', toStatus: 'REJECTED', expectedVersion: 2 }),
    ).rejects.toBeInstanceOf(TransitionError);
  });

  it('treats a null data payload with no errors as an UNKNOWN failure', async () => {
    updateReportStatus.mockResolvedValue({ data: null, errors: null });

    await expect(
      transitionReportStatus({ reportId: 'r1', toStatus: 'VERIFIED', expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'UNKNOWN' });
  });
});
