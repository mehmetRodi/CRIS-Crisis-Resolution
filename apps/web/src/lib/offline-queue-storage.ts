import { withoutPendingReportContact, type PendingReport } from '@crisismap/shared';

/**
 * `localStorage` persistence for the offline report queue (CRIS-26). The pure
 * queue logic lives in `@crisismap/shared`; this file is the thin browser
 * adapter.
 */

const STORAGE_KEY = 'crisismap.offlineQueue.v1';

/** Loads the persisted queue. Never throws — a corrupt/missing value is an empty queue. */
export function loadQueue(): PendingReport[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? (parsed as PendingReport[]).map(withoutPendingReportContact)
      : [];
  } catch {
    return [];
  }
}

/** Persists the queue, throwing when the browser cannot make the save durable. */
export function saveQueue(queue: readonly PendingReport[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue.map(withoutPendingReportContact)));
}
