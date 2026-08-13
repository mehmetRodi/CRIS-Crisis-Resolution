import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useVolunteerTasks } from './useVolunteerTasks';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  listVolunteerTasks: vi.fn(),
}));

vi.mock('aws-amplify/auth', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('../../lib/amplify', () => ({
  client: {
    queries: {
      listVolunteerTasks: mocks.listVolunteerTasks,
    },
  },
}));

describe('useVolunteerTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ userId: 'volunteer-1' });
    mocks.listVolunteerTasks.mockResolvedValue({
      data: [
        {
          reportId: 'report-1',
          status: 'AI_CLASSIFIED',
          category: 'MEDICAL',
          urgency: 'HIGH',
          priorityScore: 8,
          summary: 'Deliver first-aid kits',
          regionId: 'north',
          assignmentId: 'assignment-1',
          assignmentStatus: 'ASSIGNED',
          teamId: 'team-1',
          teamName: 'North volunteers',
          column: 'ASSIGNED',
        },
      ],
    });
  });

  it('authenticates and exposes the server-redacted task projection', async () => {
    const { result } = renderHook(() => useVolunteerTasks());

    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(mocks.listVolunteerTasks).toHaveBeenCalledOnce();
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
    expect(mocks.listVolunteerTasks).not.toHaveBeenCalled();
  });

  it('surfaces GraphQL failures instead of rendering a partial board', async () => {
    mocks.listVolunteerTasks.mockResolvedValue({
      data: null,
      errors: [{ message: 'Volunteer task read denied' }],
    });
    const { result } = renderHook(() => useVolunteerTasks());

    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state).toEqual({
      status: 'error',
      message: 'Volunteer task read denied',
    });
  });
});
