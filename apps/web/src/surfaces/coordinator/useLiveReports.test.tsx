import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicReport } from '@crisismap/shared';

import { useLiveReports } from './useLiveReports';

type SubscriptionOptions = {
  enabled: boolean;
  onUpdate: (report: PublicReport) => void | Promise<void>;
  onReconnect: () => void | Promise<void>;
};

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  subscriptionOptions: null as SubscriptionOptions | null,
}));

vi.mock('aws-amplify/auth', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('../../lib/amplify', () => ({
  client: {
    models: {
      Report: { list: mocks.list, get: mocks.get },
    },
  },
}));
vi.mock('../../lib/report-updates', () => ({
  useReportUpdates: (options: SubscriptionOptions) => {
    mocks.subscriptionOptions = options;
    return options.enabled ? 'connected' : 'idle';
  },
}));

const initialReport = {
  id: 'report-1',
  status: 'PROCESSING',
  category: null,
  urgency: null,
  priorityScore: null,
  priorityBand: null,
  summary: null,
  lat: null,
  lng: null,
  geohash: null,
  geohashPrefix: null,
  regionId: 'north',
  createdAt: '2026-08-14T10:00:00.000Z',
  updatedAt: '2026-08-14T10:00:30.000Z',
  version: 1,
  confidence: null,
  scoreVersion: null,
  scoreBreakdown: null,
  entities: null,
};

const event: PublicReport = {
  reportId: 'report-1',
  status: 'AI_CLASSIFIED',
  category: 'MEDICAL',
  urgency: 'HIGH',
  priorityScore: 8,
  priorityBand: 'P0',
  summary: 'Medical assistance needed',
  lat: null,
  lng: null,
  geohash: null,
  geohashPrefix: null,
  regionId: 'north',
  createdAt: '2026-08-14T10:00:00.000Z',
  updatedAt: '2026-08-14T10:01:00.000Z',
};

describe('useLiveReports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.subscriptionOptions = null;
    mocks.getCurrentUser.mockResolvedValue({ userId: 'coordinator-1' });
    mocks.list.mockResolvedValue({ data: [initialReport] });
    mocks.get.mockResolvedValue({
      data: {
        ...initialReport,
        status: 'AI_CLASSIFIED',
        category: 'MEDICAL',
        urgency: 'HIGH',
        priorityScore: 8,
        priorityBand: 'P0',
        summary: 'Medical assistance needed',
        version: 2,
        updatedAt: '2026-08-14T10:01:00.000Z',
      },
    });
  });

  it('loads a snapshot, then reconciles a subscription signal through Report.get', async () => {
    const { result } = renderHook(() => useLiveReports());

    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(result.current.realtime).toBe('connected');
    expect(mocks.subscriptionOptions?.enabled).toBe(true);

    await act(async () => {
      await mocks.subscriptionOptions?.onUpdate(event);
    });

    expect(mocks.get).toHaveBeenCalledWith({ id: 'report-1' });
    expect(result.current.state).toMatchObject({
      status: 'ready',
      incidents: [
        {
          reportId: 'report-1',
          status: 'AI_CLASSIFIED',
          summary: 'Medical assistance needed',
          version: 2,
        },
      ],
    });
    expect(result.current.lastUpdate).toEqual({ sequence: 1, reportId: 'report-1' });
    expect(result.current.activity).toEqual([
      expect.objectContaining({
        sequence: 1,
        reportId: 'report-1',
        status: 'AI_CLASSIFIED',
        summary: 'Medical assistance needed',
      }),
    ]);
  });

  it('reloads the bounded snapshot after reconnect and signals timeline recovery', async () => {
    const { result } = renderHook(() => useLiveReports());
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    await act(async () => {
      await mocks.subscriptionOptions?.onReconnect();
    });

    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(result.current.lastUpdate).toEqual({ sequence: 1, reportId: null });
  });

  it('does not enable the User Pool subscription without a session', async () => {
    mocks.getCurrentUser.mockRejectedValue(new Error('not signed in'));
    const { result } = renderHook(() => useLiveReports());

    await waitFor(() => expect(result.current.state.status).toBe('unauthenticated'));
    expect(result.current.realtime).toBe('idle');
    expect(mocks.subscriptionOptions?.enabled).toBe(false);
  });
});
