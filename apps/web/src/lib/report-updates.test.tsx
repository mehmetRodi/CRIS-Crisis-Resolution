import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseReportUpdate, useReportUpdates } from './report-updates';

type SubscriptionObserver = {
  next: (value: unknown) => void;
  error: (error: unknown) => void;
  complete: () => void;
};
type HubCapsule = {
  source: string;
  payload: { event: string; data?: { connectionState?: string } };
};

const mocks = vi.hoisted(() => ({
  observer: null as SubscriptionObserver | null,
  hubCallback: null as ((capsule: HubCapsule) => void) | null,
  unsubscribe: vi.fn(),
  cancelHubListener: vi.fn(),
  subscribe: vi.fn(),
  onReportUpdate: vi.fn(),
  listen: vi.fn(),
}));

vi.mock('./amplify', () => ({
  client: {
    subscriptions: {
      onReportUpdate: mocks.onReportUpdate,
    },
  },
}));
vi.mock('aws-amplify/utils', () => ({ Hub: { listen: mocks.listen } }));
vi.mock('aws-amplify/api', () => ({
  CONNECTION_STATE_CHANGE: 'ConnectionStateChange',
  ConnectionState: {
    Connected: 'Connected',
    ConnectedPendingKeepAlive: 'ConnectedPendingKeepAlive',
    Connecting: 'Connecting',
    ConnectionDisrupted: 'ConnectionDisrupted',
    ConnectionDisruptedPendingNetwork: 'ConnectionDisruptedPendingNetwork',
    ConnectedPendingNetwork: 'ConnectedPendingNetwork',
    ConnectedPendingDisconnect: 'ConnectedPendingDisconnect',
    Disconnected: 'Disconnected',
  },
}));

const event = {
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

describe('parseReportUpdate', () => {
  it('accepts a valid redacted event and rejects invalid lifecycle values', () => {
    expect(parseReportUpdate(event)).toMatchObject({
      reportId: 'report-1',
      status: 'AI_CLASSIFIED',
      priorityBand: 'P0',
    });
    expect(parseReportUpdate({ ...event, status: 'INVENTED' })).toBeNull();
    expect(parseReportUpdate({ ...event, reportId: null })).toBeNull();
  });
});

describe('useReportUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.observer = null;
    mocks.hubCallback = null;
    mocks.subscribe.mockImplementation((observer: SubscriptionObserver) => {
      mocks.observer = observer;
      return { unsubscribe: mocks.unsubscribe };
    });
    mocks.onReportUpdate.mockReturnValue({ subscribe: mocks.subscribe });
    mocks.listen.mockImplementation((_channel: string, callback: (capsule: HubCapsule) => void) => {
      mocks.hubCallback = callback;
      return mocks.cancelHubListener;
    });
  });

  it('subscribes only when enabled and delivers validated updates', async () => {
    const onUpdate = vi.fn();
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useReportUpdates({ enabled, onUpdate, onReconnect: () => Promise.resolve() }),
      { initialProps: { enabled: false } },
    );

    expect(result.current).toBe('idle');
    expect(mocks.onReportUpdate).not.toHaveBeenCalled();

    rerender({ enabled: true });
    expect(result.current).toBe('connecting');
    expect(mocks.onReportUpdate).toHaveBeenCalledOnce();

    await act(async () => {
      mocks.observer?.next(event);
      await Promise.resolve();
    });
    expect(result.current).toBe('connected');
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ reportId: 'report-1' }));
  });

  it('reloads the durable snapshot after a disrupted connection recovers', async () => {
    const onReconnect = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useReportUpdates({ enabled: true, onUpdate: () => undefined, onReconnect }),
    );

    act(() => {
      mocks.hubCallback?.({
        source: 'PubSub',
        payload: { event: 'ConnectionStateChange', data: { connectionState: 'Connected' } },
      });
      mocks.hubCallback?.({
        source: 'PubSub',
        payload: {
          event: 'ConnectionStateChange',
          data: { connectionState: 'ConnectionDisrupted' },
        },
      });
    });
    expect(result.current).toBe('disconnected');

    act(() => {
      mocks.hubCallback?.({
        source: 'PubSub',
        payload: { event: 'ConnectionStateChange', data: { connectionState: 'Connected' } },
      });
    });
    await waitFor(() => expect(onReconnect).toHaveBeenCalledOnce());
    expect(result.current).toBe('connected');
  });

  it('unsubscribes and removes the Hub listener on unmount', () => {
    const { unmount } = renderHook(() =>
      useReportUpdates({
        enabled: true,
        onUpdate: () => undefined,
        onReconnect: () => undefined,
      }),
    );

    unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    expect(mocks.cancelHubListener).toHaveBeenCalledOnce();
  });
});
