import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const useOfflineQueueMock = vi.fn();
vi.mock('../OfflineQueueContext', () => ({
  useOfflineQueue: () => useOfflineQueueMock(),
}));

const { OfflineQueueBanner } = await import('./OfflineQueueBanner');

describe('OfflineQueueBanner', () => {
  it('renders no visible text when the queue is empty', () => {
    useOfflineQueueMock.mockReturnValue({ pendingCount: 0, isStale: false });
    render(<OfflineQueueBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('uses singular copy for exactly one pending report', () => {
    useOfflineQueueMock.mockReturnValue({ pendingCount: 1, isStale: false });
    render(<OfflineQueueBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('1 report waiting to send');
  });

  it('uses plural copy for more than one pending report', () => {
    useOfflineQueueMock.mockReturnValue({ pendingCount: 3, isStale: false });
    render(<OfflineQueueBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('3 reports waiting to send');
  });

  it('adds a staleness warning once a queued report has waited too long', () => {
    useOfflineQueueMock.mockReturnValue({ pendingCount: 1, isStale: true });
    render(<OfflineQueueBanner />);
    expect(screen.getByRole('status')).toHaveTextContent(/waiting a long time/);
  });
});
