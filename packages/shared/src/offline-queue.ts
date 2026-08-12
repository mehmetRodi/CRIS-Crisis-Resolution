/**
 * CrisisMap AI — offline report queue core (CRIS-26, design doc §2.1/§4).
 *
 * Platform-agnostic queue/backoff/staleness logic behind "offline save, retry,
 * and recovery" for citizen report submission. No I/O here — persistence
 * (`AsyncStorage` on mobile, `localStorage` on web) and connectivity detection
 * (`NetInfo` vs. `navigator.onLine`) are platform adapters in each app's
 * `lib/`; this module only computes what the queue should look like next,
 * mirroring the `report-form.ts` / backend `core.ts` split used elsewhere in
 * this codebase (pure logic, unit-tested directly; I/O adapters thin and
 * untested-in-isolation).
 *
 * `submitReport` is already idempotent on `clientRequestId` (`IdempotencyRecord`,
 * 24h TTL — `apps/web/amplify/functions/submit-report/core.ts`), so resubmitting
 * a queued report is safe — that's WHY a queue is viable at all. The one
 * residual risk this module tracks is the TTL itself: if a report stays queued
 * long enough, a later retry is no longer deduped server-side. There is no fix
 * for that here (it would need a longer-lived idempotency record, a backend
 * change out of scope for this ticket) — only a staleness signal so the UI can
 * say so rather than silently risking a duplicate.
 */

import type { ReportSubmission } from './report-form';

/* -------------------------------------------------------------------------- */
/* Submission error classification                                            */
/* -------------------------------------------------------------------------- */

/**
 * Thrown by each platform's `submitReport()` wrapper in place of a bare `Error`.
 * `retryable` is the load-bearing distinction the whole queue depends on:
 *
 *   - `true`  — the mutation call itself never got a response (offline, DNS
 *     failure, timeout — the same class of failure already called out in
 *     `media-upload.ts`'s fetch try/catch). Safe to queue and retry later.
 *   - `false` — the call completed and the server actively rejected it
 *     (`errors`/no `data`). Retrying an identical rejection converges on
 *     nothing, so this must never be queued — it stays a same-session, visible
 *     error the citizen can act on.
 */
export class ReportSubmitError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'ReportSubmitError';
    this.retryable = retryable;
  }
}

/* -------------------------------------------------------------------------- */
/* Queue shape                                                                 */
/* -------------------------------------------------------------------------- */

/** One report waiting to (re)send. */
export interface PendingReport {
  /** Stable across every retry of this report — the idempotency key itself. */
  clientRequestId: string;
  submission: ReportSubmission;
  /** ISO timestamp of when this report first entered the queue. */
  queuedAt: string;
  /** Failed attempts so far. 0 means it has never been tried yet. */
  attempts: number;
  lastError: string | null;
  /** ISO timestamp of the most recent attempt, or `null` if never attempted. */
  lastAttemptAt: string | null;
}

/**
 * Adds `submission` to the queue under `clientRequestId`. De-dupes by
 * replacing any existing entry with the same key — defensive only; a caller
 * should never enqueue the same `clientRequestId` twice; this just guarantees
 * the queue can never grow duplicate entries for one report.
 */
export function enqueuePendingReport(
  queue: readonly PendingReport[],
  submission: ReportSubmission,
  clientRequestId: string,
  now: string,
): PendingReport[] {
  const withoutExisting = queue.filter((p) => p.clientRequestId !== clientRequestId);
  const entry: PendingReport = {
    clientRequestId,
    submission,
    queuedAt: now,
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
  };
  return [...withoutExisting, entry];
}

/** Removes a report from the queue — a successful send, or a dropped one. */
export function removePendingReport(
  queue: readonly PendingReport[],
  clientRequestId: string,
): PendingReport[] {
  return queue.filter((p) => p.clientRequestId !== clientRequestId);
}

/** Records a failed retry attempt against the matching queued report. */
export function recordAttemptFailure(
  queue: readonly PendingReport[],
  clientRequestId: string,
  error: string,
  now: string,
): PendingReport[] {
  return queue.map((p) =>
    p.clientRequestId === clientRequestId
      ? { ...p, attempts: p.attempts + 1, lastError: error, lastAttemptAt: now }
      : p,
  );
}

/* -------------------------------------------------------------------------- */
/* Retry backoff                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Backoff schedule for a queued report that keeps failing while the device
 * otherwise appears online (a transient 5xx/throttle — connectivity-change
 * events alone would never retry this, since connectivity never actually
 * dropped). Indexed by `attempts - 1`; the last entry repeats for any further
 * attempts, capping the wait at 5 minutes rather than growing unbounded.
 */
export const RETRY_BACKOFF_SCHEDULE_MS = [30_000, 60_000, 120_000, 240_000, 300_000] as const;

/** How long to wait before the next retry, given how many attempts have failed so far. */
export function nextRetryDelayMs(attempts: number): number {
  if (attempts <= 0) return 0;
  // `index` is always within [0, length - 1] by construction (Math.min), so this
  // is never actually undefined — `noUncheckedIndexedAccess` can't see that a
  // runtime-clamped index into a fixed, non-empty array is provably in range.
  const index = Math.min(attempts - 1, RETRY_BACKOFF_SCHEDULE_MS.length - 1);
  return RETRY_BACKOFF_SCHEDULE_MS[index]!;
}

/** True when `pending` is due for another attempt as of `now`. */
export function isRetryDue(pending: PendingReport, now: string): boolean {
  if (pending.attempts === 0 || pending.lastAttemptAt === null) return true;
  const elapsedMs = new Date(now).getTime() - new Date(pending.lastAttemptAt).getTime();
  return elapsedMs >= nextRetryDelayMs(pending.attempts);
}

/* -------------------------------------------------------------------------- */
/* Idempotency-TTL staleness                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Warn once a queued report is within 4 hours of the server's 24h
 * `IdempotencyRecord` TTL — the point past which a retry is no longer
 * guaranteed deduped. This is a UI signal only (the banner's copy changes);
 * there is no automatic action to take here without a backend change.
 */
export const IDEMPOTENCY_STALENESS_WARNING_MS = 20 * 60 * 60 * 1000;

/** True when any queued report is old enough to warn about (see above). */
export function hasStalePendingReport(queue: readonly PendingReport[], now: string): boolean {
  const nowMs = new Date(now).getTime();
  return queue.some(
    (p) => nowMs - new Date(p.queuedAt).getTime() >= IDEMPOTENCY_STALENESS_WARNING_MS,
  );
}
