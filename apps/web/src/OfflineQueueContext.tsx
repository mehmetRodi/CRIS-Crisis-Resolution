import { createContext, useContext, useEffect, useRef, useState } from 'react';
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

import { getIsOnline, subscribeOnlineStatus } from './lib/connectivity';
import { loadQueue, saveQueue } from './lib/offline-queue-storage';
import { submitReport } from './lib/submit-report';

/**
 * Offline report queue (CRIS-26, ADR-0044). Owns the single shared instance of
 * the "reports waiting to send" queue — deliberately a context (mirroring
 * `AuthContext`/`useAuth`), not a bare hook called from multiple places, so the
 * banner and the report form share one flush loop and one persisted count
 * instead of two independent copies racing each other.
 *
 * Recovery: loads the persisted queue on mount and attempts an immediate flush.
 * Retry: flushes again on every connectivity-regained event, plus a bounded
 * poll while the queue is non-empty (catches a flush that fails while the
 * device is genuinely online — a transient 5xx/throttle that no connectivity
 * event would ever re-trigger).
 */

interface OfflineQueueContextType {
  /** Number of reports currently waiting to send. */
  pendingCount: number;
  isOnline: boolean;
  /** True once any queued report is old enough to risk the 24h idempotency TTL. */
  isStale: boolean;
  /** Persists `submission` for later sending. Resolves once durably saved. */
  enqueue: (submission: ReportSubmission, clientRequestId: string) => Promise<void>;
}

const OfflineQueueContext = createContext<OfflineQueueContextType | undefined>(undefined);

/** How often to check for a due retry while the queue is non-empty (§ backoff). */
const BACKOFF_POLL_INTERVAL_MS = 15_000;

export function OfflineQueueProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<PendingReport[]>(() => loadQueue());
  const [isOnline, setIsOnline] = useState(getIsOnline());
  // Mirrors `queue` for synchronous reads inside the flush loop, which spans
  // multiple `await`s and must always act on the latest state — `queue` itself
  // is stale inside a closure captured before those awaits resolve.
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const flushInFlight = useRef(false);
  const flushAgainRequested = useRef(false);

  function persist(next: PendingReport[]) {
    // Save before acknowledging the state change. A quota/private-mode failure
    // must reach enqueue's caller instead of producing a false "saved" result.
    saveQueue(next);
    queueRef.current = next;
    setQueue(next);
  }

  async function flush() {
    if (flushInFlight.current) {
      flushAgainRequested.current = true;
      return;
    }
    flushInFlight.current = true;
    try {
      // Sequential (FIFO), not `Promise.all` — one report's send should not
      // race another's, and this gives a stable order to reason about.
      for (const item of queueRef.current) {
        if (!getIsOnline()) break;
        const now = new Date().toISOString();
        if (!isRetryDue(item, now)) continue;
        try {
          await submitReport(item.submission, item.clientRequestId);
        } catch (err) {
          const retryable = err instanceof ReportSubmitError ? err.retryable : true;
          try {
            if (!retryable) {
              // A deterministic server-side rejection on a queued report can
              // never succeed by repeating it — drop it rather than retry
              // forever and let the banner keep lying about "waiting to send".
              persist(removePendingReport(queueRef.current, item.clientRequestId));
            } else {
              const message = err instanceof Error ? err.message : 'Unknown error';
              persist(recordAttemptFailure(queueRef.current, item.clientRequestId, message, now));
            }
          } catch {
            return;
          }
          continue;
        }
        try {
          persist(removePendingReport(queueRef.current, item.clientRequestId));
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

  // Recovery: load already happened in useState's initializer; attempt a flush
  // once on mount in case reports were queued from a previous session.
  useEffect(() => {
    void flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return subscribeOnlineStatus((online) => {
      setIsOnline(online);
      if (online) void flush();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bounded backoff poll — only runs while there is something to send.
  useEffect(() => {
    if (queue.length === 0) return;
    const id = setInterval(() => {
      if (getIsOnline()) void flush();
    }, BACKOFF_POLL_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.length]);

  async function enqueue(submission: ReportSubmission, clientRequestId: string): Promise<void> {
    persist(
      enqueuePendingReport(queueRef.current, submission, clientRequestId, new Date().toISOString()),
    );
    // Best-effort immediate attempt in case connectivity was misdetected —
    // NOT awaited: the caller only needs the durable save above to complete
    // before showing its "saved" confirmation, not a full send.
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
