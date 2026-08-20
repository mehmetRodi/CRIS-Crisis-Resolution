// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RESOLVER_METRIC_NAMESPACE,
  UNEXPECTED_ERROR_METRIC,
  hasExpectedErrorCode,
  observeResolverErrors,
  withResolverErrorMetrics,
} from './resolver-metrics';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('observeResolverErrors', () => {
  it('preserves successful results without emitting a metric', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(
      observeResolverErrors(
        'testOperation',
        () => false,
        async () => 42,
      ),
    ).resolves.toBe(42);
    expect(log).not.toHaveBeenCalled();
  });

  it('preserves every decorated resolver argument', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const resolve = withResolverErrorMetrics(
      'testOperation',
      () => false,
      async (left: number, right: number) => left + right,
    );

    await expect(resolve(20, 22)).resolves.toBe(42);
    expect(log).not.toHaveBeenCalled();
  });

  it('rethrows expected errors without paging', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = new Error('CONFLICT: stale version');

    await expect(
      observeResolverErrors(
        'testOperation',
        (candidate) => hasExpectedErrorCode(candidate, ['CONFLICT']),
        async () => {
          throw error;
        },
      ),
    ).rejects.toBe(error);
    expect(log).not.toHaveBeenCalled();
  });

  it('emits one PII-free EMF metric and rethrows unexpected errors', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = new Error('database unavailable');

    await expect(
      observeResolverErrors(
        'testOperation',
        () => false,
        async () => {
          throw error;
        },
      ),
    ).rejects.toBe(error);

    expect(log).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({
      event: 'resolver.unexpected_error',
      Operation: 'testOperation',
      UnexpectedErrors: 1,
      errorType: 'Error',
      _aws: {
        CloudWatchMetrics: [
          {
            Namespace: RESOLVER_METRIC_NAMESPACE,
            Dimensions: [['Operation']],
            Metrics: [{ Name: UNEXPECTED_ERROR_METRIC, Unit: 'Count' }],
          },
        ],
      },
    });
    expect(JSON.stringify(entry)).not.toContain(error.message);
  });
});
