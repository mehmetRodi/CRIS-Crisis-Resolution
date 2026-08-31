import { CloudOff } from 'lucide-react';

import { useOfflineQueue } from '../OfflineQueueContext';

/**
 * Persistent status banner for the offline report queue (CRIS-26). Always
 * mounted — never conditionally rendered — so a screen reader's live region
 * announces state changes rather than missing them by appearing at the same
 * moment as its text (the same reasoning already used for `ReportForm.tsx`'s
 * photo-upload status region, ADR-0037). Renders no visible content when
 * there is nothing queued.
 */
export function OfflineQueueBanner() {
  const { pendingCount, isStale } = useOfflineQueue();

  // Named (ADR-0037's rationale for the photo-status region, above): the form
  // carries more than one live region, and this one must never collide with
  // the post-submit confirmation's bare `role="status"` in either markup or
  // in a `getByRole('status')` query.
  if (pendingCount === 0) {
    return <span role="status" aria-label="Offline queue status" className="sr-only" />;
  }

  const noun = pendingCount === 1 ? 'report' : 'reports';
  const message = isStale
    ? `${pendingCount} ${noun} waiting to send — one has been waiting a long time and may need to be resent once you're back online.`
    : `${pendingCount} ${noun} waiting to send. They'll go out automatically once you're back online.`;

  return (
    <div
      role="status"
      aria-label="Offline queue status"
      className="mb-6 flex items-start gap-2.5 rounded-lg border border-warning-border bg-warning-subtle px-4 py-3 text-sm text-fg"
    >
      <CloudOff aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
      <span>{message}</span>
    </div>
  );
}
