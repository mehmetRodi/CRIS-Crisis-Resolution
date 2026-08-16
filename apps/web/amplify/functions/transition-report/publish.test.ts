import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Publisher } from '../publish-report-update/client';
import { publishTransitionUpdate } from './publish';

const report = {
  id: 'report-1',
  status: 'VERIFIED' as const,
  category: 'MEDICAL' as const,
  reporterId: 'citizen-1',
  reporterContact: 'secret@example.com',
  text: 'untrusted raw report',
  updatedAt: '2026-08-14T10:00:00.000Z',
};

describe('publishTransitionUpdate', () => {
  afterEach(() => vi.useRealTimers());

  it('publishes only the redacted projection after a committed transition', async () => {
    const publishUpdate = vi.fn<Publisher['publishUpdate']>().mockResolvedValue(undefined);
    const log = vi.fn();

    await publishTransitionUpdate(report, async () => ({ publishUpdate }), log);

    expect(publishUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        reportId: 'report-1',
        status: 'VERIFIED',
        category: 'MEDICAL',
      }),
    );
    expect(publishUpdate.mock.calls[0]?.[0]).not.toHaveProperty('reporterId');
    expect(publishUpdate.mock.calls[0]?.[0]).not.toHaveProperty('reporterContact');
    expect(publishUpdate.mock.calls[0]?.[0]).not.toHaveProperty('text');
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'transition.publish.done', reportId: 'report-1' }),
    );
  });

  it('keeps a publish failure best-effort after the durable write', async () => {
    const log = vi.fn();

    await expect(
      publishTransitionUpdate(
        report,
        async () => {
          throw new Error('AppSync unavailable');
        },
        log,
      ),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'transition.publish.failed',
        reportId: 'report-1',
        reason: 'AppSync unavailable',
      }),
    );
  });

  it('bounds a stalled publish so the committed mutation can still return', async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const pending = publishTransitionUpdate(
      report,
      async () => ({ publishUpdate: () => new Promise<void>(() => undefined) }),
      log,
    );

    await vi.advanceTimersByTimeAsync(8_000);
    await expect(pending).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'transition.publish.failed',
        reason: 'AppSync publish timed out',
      }),
    );
  });
});
