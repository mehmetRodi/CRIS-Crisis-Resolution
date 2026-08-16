import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the shared Amplify client so the wrapper is tested against a controllable
// mutation stub (and without importing real `amplify_outputs.json`).
const assignTeamMutation = vi.fn();
vi.mock('./amplify', () => ({
  client: {
    mutations: { assignTeam: (...args: unknown[]) => assignTeamMutation(...args) },
  },
}));

const { assignTeam, classifyAssignError, AssignError } = await import('./assign-team');

beforeEach(() => {
  assignTeamMutation.mockReset();
});

describe('classifyAssignError', () => {
  it('maps each resolver code prefix to a typed error', () => {
    expect(classifyAssignError('CONFLICT: modified concurrently').code).toBe('CONFLICT');
    expect(classifyAssignError('NOT_FOUND: team x').code).toBe('NOT_FOUND');
    expect(classifyAssignError('ILLEGAL: report is terminal').code).toBe('ILLEGAL');
  });

  it('strips the code prefix from the human message', () => {
    expect(classifyAssignError('CONFLICT: refetch and retry.').message).toBe('refetch and retry.');
  });

  it('falls back to UNKNOWN for unrecognized or missing messages', () => {
    expect(classifyAssignError('some network blip').code).toBe('UNKNOWN');
    expect(classifyAssignError(undefined).code).toBe('UNKNOWN');
  });
});

describe('assignTeam', () => {
  it('forwards the command and returns the assigned team + version on success', async () => {
    assignTeamMutation.mockResolvedValue({
      data: { id: 'r1', assignedTeamId: 't1', version: 4 },
      errors: null,
    });

    const result = await assignTeam({
      reportId: 'r1',
      teamId: 't1',
      expectedVersion: 3,
      note: 'nearest available team',
    });

    expect(assignTeamMutation).toHaveBeenCalledWith({
      reportId: 'r1',
      teamId: 't1',
      expectedVersion: 3,
      note: 'nearest available team',
    });
    expect(result).toEqual({ reportId: 'r1', assignedTeamId: 't1', version: 4 });
  });

  it('throws a typed CONFLICT error when the version is stale', async () => {
    assignTeamMutation.mockResolvedValue({
      data: null,
      errors: [{ message: 'CONFLICT: report was modified concurrently; refetch and retry.' }],
    });

    await expect(
      assignTeam({ reportId: 'r1', teamId: 't1', expectedVersion: 1 }),
    ).rejects.toMatchObject({ name: 'AssignError', code: 'CONFLICT' });
  });

  it('throws a typed NOT_FOUND error for a bogus team', async () => {
    assignTeamMutation.mockResolvedValue({
      data: null,
      errors: [{ message: 'NOT_FOUND: team t1 does not exist.' }],
    });

    await expect(
      assignTeam({ reportId: 'r1', teamId: 't1', expectedVersion: 2 }),
    ).rejects.toBeInstanceOf(AssignError);
  });

  it('treats a null data payload with no errors as an UNKNOWN failure', async () => {
    assignTeamMutation.mockResolvedValue({ data: null, errors: null });

    await expect(
      assignTeam({ reportId: 'r1', teamId: 't1', expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'UNKNOWN' });
  });
});
