import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PendingReport } from '@crisismap/shared';

/**
 * `AsyncStorage` persistence for the offline report queue (CRIS-26). Mobile
 * twin of `apps/web/src/lib/offline-queue-storage.ts` (`localStorage` there) —
 * same shape, async here since `AsyncStorage` itself is async.
 */

const STORAGE_KEY = 'crisismap.offlineQueue.v1';

/** Loads the persisted queue. Never throws — a corrupt/missing value is an empty queue. */
export async function loadQueue(): Promise<PendingReport[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingReport[]) : [];
  } catch {
    return [];
  }
}

/** Persists the queue. Never throws — storage failures just no-op for this session. */
export async function saveQueue(queue: readonly PendingReport[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // Storage unavailable/full — the queue still works in-memory for this
    // session, it just won't survive the app being killed.
  }
}
