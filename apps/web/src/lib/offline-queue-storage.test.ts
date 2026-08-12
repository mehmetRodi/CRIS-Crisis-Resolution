import { beforeEach, describe, expect, it } from 'vitest';
import { Category, Urgency, type PendingReport } from '@crisismap/shared';

import { loadQueue, saveQueue } from './offline-queue-storage';

const STORAGE_KEY = 'crisismap.offlineQueue.v1';

function pending(): PendingReport {
  return {
    clientRequestId: 'req-1',
    submission: {
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
    },
    queuedAt: '2026-08-04T12:00:00.000Z',
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('loadQueue', () => {
  it('returns an empty array when nothing is stored', () => {
    expect(loadQueue()).toEqual([]);
  });

  it('returns an empty array for corrupt JSON rather than throwing', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json');
    expect(loadQueue()).toEqual([]);
  });

  it('returns an empty array when the stored value is not an array', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ unexpected: 'shape' }));
    expect(loadQueue()).toEqual([]);
  });

  it('round-trips a saved queue', () => {
    const queue = [pending()];
    saveQueue(queue);
    expect(loadQueue()).toEqual(queue);
  });
});
