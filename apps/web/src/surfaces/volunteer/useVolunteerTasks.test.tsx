import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicReport } from '@crisismap/shared';

import { useVolunteerTasks } from './useVolunteerTasks';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  listVolunteerTasks: vi.fn(),
  subscriptionOptions: null as {
    enabled: boolean;
    onUpdate: (report: PublicReport) => void | Promise<void>;
    onReconnect: () => void | Promise<void>;
  } | null,
}));

vi.mock('aws-amplify/auth', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('../../lib/amplify', () => ({
  client: {
    queries: {
      listVolunteerTasks: mocks.listVolunteerTasks,
    },
  },
}));
vi.mock('../../lib/report-updates', () => ({
  useReportUpdates: (options: NonNullable<typeof mocks.subscriptionOptions>) => {
    mocks.subscriptionOptions = options;
    return options.enabled ? 'connected' : 'idle';
  },
}));

describe('useVolunteerTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.subscriptionOptions = null;
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
    expect(result.current.realtime).toBe('connected');
  });

  it('reconciles a redacted report event without re-reading the joined projection', async () => {
    const { result } = renderHook(() => useVolunteerTasks());
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    await act(async () => {
      await mocks.subscriptionOptions?.onUpdate({
        reportId: 'report-1',
        status: 'NEEDS_VERIFICATION',
        category: 'MEDICAL',
        urgency: 'CRITICAL',
        priorityScore: 9,
        priorityBand: 'P0',
        summary: 'Verify urgent medical need',
        lat: null,
        lng: null,
        geohash: null,
        geohashPrefix: null,
        regionId: 'north',
        createdAt: null,
        updatedAt: null,
      });
    });

    expect(mocks.listVolunteerTasks).toHaveBeenCalledOnce();
    expect(result.current.state).toMatchObject({
      status: 'ready',
      tasks: [
        {
          reportId: 'report-1',
          summary: 'Verify urgent medical need',
          column: 'VERIFICATION_NEEDED',
          teamName: 'North volunteers',
        },
      ],
    });
  });

  it('does not issue model reads without an authenticated session', async () => {
    mocks.getCurrentUser.mockRejectedValue(new Error('not signed in'));
    const { result } = renderHook(() => useVolunteerTasks());

    await waitFor(() => expect(result.current.state.status).toBe('unauthenticated'));
    expect(mocks.listVolunteerTasks).not.toHaveBeenCalled();
    expect(result.current.realtime).toBe('idle');
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
