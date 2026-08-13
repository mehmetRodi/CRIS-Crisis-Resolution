import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import {
  ReportSubmitError,
  enqueuePendingReport,
  hasStalePendingReport,
  isRetryDue,
  recordAttemptFailure,
  removePendingReport,
  type PendingReport,
  type ReportSubmission,
} from '@crisismap/shared';

import { subscribeAppState, subscribeOnlineStatus } from './connectivity';
import { loadQueue, saveQueue } from './offline-queue-storage';
import { submitReport } from './submit-report';

/**
 * Offline report queue (CRIS-26, ADR-0044). Mobile twin of the web
 * `OfflineQueueContext` (`apps/web/src/OfflineQueueContext.tsx`) — same shared
 * queue/backoff/staleness logic from `@crisismap/shared`, same single-shared-
 * instance-via-context design (not a bare hook, so the banner and the report
 * form never own independent copies of the queue). What differs is purely
 * platform I/O: `AsyncStorage` instead of `localStorage` (async, so recovery
 * happens in an effect rather than `useState`'s initializer), `NetInfo`
 * instead of `navigator.onLine` (no synchronous "online right now" accessor,
 * only a subscription), and an `AppState` subscription that pauses the
 * backoff poll while backgrounded and flushes immediately on foreground.
 */

interface OfflineQueueContextType {
  pendingCount: number;
  isOnline: boolean;
  isStale: boolean;
  enqueue: (submission: ReportSubmission, clientRequestId: string) => Promise<void>;
}

const OfflineQueueContext = createContext<OfflineQueueContextType | undefined>(undefined);

const BACKOFF_POLL_INTERVAL_MS = 15_000;

export function OfflineQueueProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<PendingReport[]>([]);
  // Optimistic default (assume online) until NetInfo's first report lands —
  // matches the "false positive is cheap, false negative silently stalls
  // retries" reasoning used throughout this feature.
  const [isOnline, setIsOnline] = useState(true);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;
  const appActiveRef = useRef(AppState.currentState === 'active');
  const flushInFlight = useRef(false);
  const flushAgainRequested = useRef(false);
  const hydrationPromiseRef = useRef<Promise<void> | null>(null);
  const resolveHydrationRef = useRef<(() => void) | null>(null);
  const queueMutationChain = useRef(Promise.resolve());

  if (hydrationPromiseRef.current === null) {
    hydrationPromiseRef.current = new Promise<void>((resolve) => {
      resolveHydrationRef.current = resolve;
    });
  }

  async function updateQueue(update: (current: readonly PendingReport[]) => PendingReport[]) {
    const mutation = queueMutationChain.current.then(async () => {
      const next = update(queueRef.current);
      // Persist before exposing the new state so callers never receive a false
      // durable-save acknowledgement.
      await saveQueue(next);
      queueRef.current = next;
      setQueue(next);
    });
    queueMutationChain.current = mutation.catch(() => undefined);
    await mutation;
  }

  async function flush() {
    if (flushInFlight.current) {
      flushAgainRequested.current = true;
      return;
    }
    flushInFlight.current = true;
    try {
      for (const item of queueRef.current) {
        if (!isOnlineRef.current) break;
        const now = new Date().toISOString();
        if (!isRetryDue(item, now)) continue;
        try {
          await submitReport(item.submission, item.clientRequestId);
        } catch (err) {
          const retryable = err instanceof ReportSubmitError ? err.retryable : true;
          try {
            if (!retryable) {
              // A deterministic server-side rejection can never succeed by
              // repeating it — drop rather than retry forever.
              await updateQueue((current) => removePendingReport(current, item.clientRequestId));
            } else {
              const message = err instanceof Error ? err.message : 'Unknown error';
              await updateQueue((current) =>
                recordAttemptFailure(current, item.clientRequestId, message, now),
              );
            }
          } catch {
            return;
          }
          continue;
        }
        try {
          await updateQueue((current) => removePendingReport(current, item.clientRequestId));
        } catch {
          // The server accepted the idempotent report, but the local removal
          // could not be saved. Keep it queued and safely retry later.
          return;
        }
      }
    } finally {
      flushInFlight.current = false;
      if (flushAgainRequested.current) {
        flushAgainRequested.current = false;
        void flush();
      }
    }
  }

  // Recovery: AsyncStorage is async, so — unlike web's `localStorage` — the
  // initial load can't happen synchronously in `useState`'s initializer.
  useEffect(() => {
    void (async () => {
      const loaded = await loadQueue();
      queueRef.current = loaded;
      setQueue(loaded);
      resolveHydrationRef.current?.();
      void flush();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return subscribeOnlineStatus((online) => {
      isOnlineRef.current = online;
      setIsOnline(online);
      if (online) void flush();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return subscribeAppState((status) => {
      const active = status === 'active';
      appActiveRef.current = active;
      if (active) void flush();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bounded backoff poll — only runs while there is something to send, and
  // only actually attempts a flush while foregrounded and online.
  useEffect(() => {
    if (queue.length === 0) return;
    const id = setInterval(() => {
      if (appActiveRef.current && isOnlineRef.current) void flush();
    }, BACKOFF_POLL_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.length]);

  async function enqueue(submission: ReportSubmission, clientRequestId: string): Promise<void> {
    // Awaited: `AsyncStorage.setItem` is async, so if the OS kills the app
    // moments after the citizen taps submit, an un-awaited write might not
    // have landed. The caller shows its "saved" confirmation only after this
    // resolves.
    await hydrationPromiseRef.current;
    await updateQueue((current) =>
      enqueuePendingReport(current, submission, clientRequestId, new Date().toISOString()),
    );
    // Best-effort immediate attempt in case connectivity was misdetected —
    // NOT awaited, since only the durable save above needs to finish first.
    void flush();
  }

  const value: OfflineQueueContextType = {
    pendingCount: queue.length,
    isOnline,
    isStale: hasStalePendingReport(queue, new Date().toISOString()),
    enqueue,
  };

  return <OfflineQueueContext.Provider value={value}>{children}</OfflineQueueContext.Provider>;
}

export function useOfflineQueue(): OfflineQueueContextType {
  const context = useContext(OfflineQueueContext);
  if (context === undefined) {
    throw new Error('useOfflineQueue must be used within an OfflineQueueProvider');
  }
  return context;
}
