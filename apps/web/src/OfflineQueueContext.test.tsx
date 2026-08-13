import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Category, ReportSubmitError, Urgency, type ReportSubmission } from '@crisismap/shared';

const submitReportMock = vi.fn();
vi.mock('./lib/submit-report', () => ({
  submitReport: (...args: unknown[]) => submitReportMock(...args),
}));

const { getIsOnlineMock, subscribeOnlineStatusMock, onlineListeners } = vi.hoisted(() => ({
  getIsOnlineMock: vi.fn(() => true),
  subscribeOnlineStatusMock: vi.fn(),
  onlineListeners: [] as Array<(online: boolean) => void>,
}));
vi.mock('./lib/connectivity', () => ({
  getIsOnline: getIsOnlineMock,
  subscribeOnlineStatus: (cb: (online: boolean) => void) => {
    subscribeOnlineStatusMock(cb);
    onlineListeners.push(cb);
    return () => {};
  },
}));

const { OfflineQueueProvider, useOfflineQueue } = await import('./OfflineQueueContext');

const STORAGE_KEY = 'crisismap.offlineQueue.v1';

const SUBMISSION: ReportSubmission = {
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
};

function Probe() {
  const { pendingCount, isOnline, isStale, enqueue } = useOfflineQueue();
  return (
    <div>
      <span data-testid="count">{pendingCount}</span>
      <span data-testid="online">{isOnline ? 'online' : 'offline'}</span>
      <span data-testid="stale">{isStale ? 'stale' : 'fresh'}</span>
      <button onClick={() => void enqueue(SUBMISSION, 'req-new')}>enqueue</button>
    </div>
  );
}

function renderProbe() {
  render(
    <OfflineQueueProvider>
      <Probe />
    </OfflineQueueProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  submitReportMock.mockReset();
  getIsOnlineMock.mockReset().mockReturnValue(true);
  subscribeOnlineStatusMock.mockReset();
  onlineListeners.length = 0;
});

describe('OfflineQueueProvider', () => {
  it('starts empty when nothing is persisted', async () => {
    renderProbe();
    expect(await screen.findByTestId('count')).toHaveTextContent('0');
  });

  it('recovers a persisted queue on mount and flushes it successfully', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          clientRequestId: 'req-old',
          submission: SUBMISSION,
          queuedAt: '2026-08-04T10:00:00.000Z',
          attempts: 0,
          lastError: null,
          lastAttemptAt: null,
        },
      ]),
    );
    submitReportMock.mockResolvedValue({ reportId: 'r1', status: 'NEW' });

    renderProbe();

    await waitFor(() => expect(submitReportMock).toHaveBeenCalledWith(SUBMISSION, 'req-old'));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('0'));
  });

  it('enqueue persists immediately and is durable across a remount', async () => {
    submitReportMock.mockRejectedValue(new ReportSubmitError('offline', true));
    renderProbe();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'enqueue' }));
    });

    expect(await screen.findByTestId('count')).toHaveTextContent('1');
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0].clientRequestId).toBe('req-new');
  });

  it('keeps a retryable failure in the queue with an incremented attempt count', async () => {
    submitReportMock.mockRejectedValue(new ReportSubmitError('network down', true));
    renderProbe();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'enqueue' }));
    });

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    expect(stored[0].attempts).toBeGreaterThanOrEqual(1);
    expect(stored[0].lastError).toBe('network down');
  });

  it('drops a non-retryable failure from the queue instead of retrying forever', async () => {
    submitReportMock.mockRejectedValue(new ReportSubmitError('validation failed', false));
    renderProbe();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'enqueue' }));
    });

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('0'));
  });

  it('flushes the queue again when connectivity is regained', async () => {
    getIsOnlineMock.mockReturnValue(false);
    submitReportMock.mockResolvedValue({ reportId: 'r1', status: 'NEW' });
    renderProbe();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'enqueue' }));
    });
    // Offline: enqueue's best-effort flush attempt should not have sent anything.
    expect(submitReportMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('count')).toHaveTextContent('1');

    getIsOnlineMock.mockReturnValue(true);
    await act(async () => {
      onlineListeners.forEach((cb) => cb(true));
    });

    await waitFor(() => expect(submitReportMock).toHaveBeenCalledWith(SUBMISSION, 'req-new'));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('0'));
  });
});
