import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useVolunteerTasks } from './useVolunteerTasks';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  reportList: vi.fn(),
  assignmentList: vi.fn(),
  teamList: vi.fn(),
}));

vi.mock('aws-amplify/auth', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('../../lib/amplify', () => ({
  client: {
    models: {
      Report: { list: mocks.reportList },
      Assignment: { list: mocks.assignmentList },
      Team: { list: mocks.teamList },
    },
  },
}));

describe('useVolunteerTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ userId: 'volunteer-1' });
    mocks.reportList.mockResolvedValue({
      data: [
        {
          id: 'report-1',
          status: 'AI_CLASSIFIED',
          category: 'MEDICAL',
          urgency: 'HIGH',
          priorityScore: 8,
          summary: 'Deliver first-aid kits',
          regionId: 'north',
          assignedTeamId: 'team-1',
        },
      ],
    });
    mocks.assignmentList.mockResolvedValue({
      data: [
        {
          id: 'assignment-1',
          reportId: 'report-1',
          teamId: 'team-1',
          status: 'ASSIGNED',
        },
      ],
    });
    mocks.teamList.mockResolvedValue({
      data: [{ id: 'team-1', name: 'North volunteers', regionId: 'north' }],
    });
  });

  it('authenticates, reads all three models, and exposes the joined task projection', async () => {
    const { result } = renderHook(() => useVolunteerTasks());

    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(mocks.reportList).toHaveBeenCalledOnce();
    expect(mocks.assignmentList).toHaveBeenCalledOnce();
    expect(mocks.teamList).toHaveBeenCalledOnce();
    expect(result.current.state).toMatchObject({
      tasks: [
        {
          reportId: 'report-1',
          summary: 'Deliver first-aid kits',
          teamName: 'North volunteers',
          column: 'ASSIGNED',
        },
      ],
    });
  });

  it('does not issue model reads without an authenticated session', async () => {
    mocks.getCurrentUser.mockRejectedValue(new Error('not signed in'));
    const { result } = renderHook(() => useVolunteerTasks());

    await waitFor(() => expect(result.current.state.status).toBe('unauthenticated'));
    expect(mocks.reportList).not.toHaveBeenCalled();
    expect(mocks.assignmentList).not.toHaveBeenCalled();
    expect(mocks.teamList).not.toHaveBeenCalled();
  });

  it('surfaces GraphQL failures instead of rendering a partial board', async () => {
    mocks.assignmentList.mockResolvedValue({
      data: [],
      errors: [{ message: 'Assignment read denied' }],
    });
    const { result } = renderHook(() => useVolunteerTasks());

    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state).toEqual({ status: 'error', message: 'Assignment read denied' });
  });
});
