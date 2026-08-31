import { cn } from '../../lib/cn';
import type { RealtimeConnectionState } from '../../lib/report-updates';

/**
 * The AppSync subscription lifecycle indicator (CRIS-28, ADR-0037).
 *
 * Two properties matter more than its appearance:
 *
 * 1. It is MOUNTED UNCONDITIONALLY, and only its text changes. A live region
 *    inserted at the same instant as its content is routinely missed, because
 *    assistive tech has to already be observing the node (ADR-0037).
 * 2. The connected state BREATHES rather than blinks. A blinking dot in
 *    peripheral vision reads as an alarm, and in an incident room a false alarm
 *    costs attention that belongs on an actual P0.
 */
const STATE_META: Readonly<
  Record<RealtimeConnectionState, { dot: string; label: string; detail: string; pulse: boolean }>
> = {
  idle: {
    dot: 'bg-severity-none',
    label: 'Live off',
    detail: 'Live updates start once an authenticated incident snapshot loads.',
    pulse: false,
  },
  connecting: {
    dot: 'bg-warning',
    label: 'Connecting',
    detail: 'Opening the real-time connection.',
    pulse: true,
  },
  connected: {
    dot: 'bg-success',
    label: 'Live',
    detail: 'Incident updates are arriving in real time.',
    pulse: true,
  },
  disconnected: {
    dot: 'bg-warning',
    label: 'Reconnecting',
    detail: 'Connection interrupted. A fresh snapshot reloads on reconnect.',
    pulse: true,
  },
  error: {
    dot: 'bg-danger',
    label: 'Live unavailable',
    detail: 'Use Refresh while real-time updates are unavailable.',
    pulse: false,
  },
};

export function ConnectionStatus({
  state,
  className,
}: {
  state: RealtimeConnectionState;
  className?: string;
}) {
  const meta = STATE_META[state];
  return (
    <span
      role="status"
      aria-label="Live update connection"
      title={meta.detail}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface px-2 py-1 text-xs font-medium text-fg-muted',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block size-2 shrink-0 rounded-xl',
          meta.dot,
          meta.pulse && 'animate-breathe',
        )}
      />
      {meta.label}
    </span>
  );
}
