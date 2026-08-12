import type { PendingReport } from '@crisismap/shared';

/**
 * `localStorage` persistence for the offline report queue (CRIS-26). The pure
 * queue logic lives in `@crisismap/shared`; this file is the thin, untested
 * (per repo convention — see `media-upload.ts`/`amplify.ts`) browser adapter.
 */

const STORAGE_KEY = 'crisismap.offlineQueue.v1';

/** Loads the persisted queue. Never throws — a corrupt/missing value is an empty queue. */
export function loadQueue(): PendingReport[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingReport[]) : [];
  } catch {
    return [];
  }
}

/** Persists the queue. Never throws — a full/unavailable store (private browsing) just no-ops. */
export function saveQueue(queue: readonly PendingReport[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // Quota exceeded or storage disabled — the queue still works for this
    // session (in-memory React state), it just won't survive a reload.
  }
}
