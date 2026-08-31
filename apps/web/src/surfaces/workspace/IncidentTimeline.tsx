import { ReportEventType } from '@crisismap/shared';
import { Loader2 } from 'lucide-react';

import { Skeleton } from '../../components/ui/skeleton';
import { absoluteTime } from '../../lib/format';
import { statusLabel } from '../../lib/domain-display';
import type { IncidentTimelineState, TimelineEvent } from '../coordinator/incidents';

/**
 * The incident's audit trail (CRIS-23, design doc §5.1).
 *
 * Timestamps here are ABSOLUTE, unlike the queue's relative "4m". An audit
 * record that only says "2 hours ago" cannot be cross-referenced against a
 * radio log or another operator's screen, which is most of what an audit trail
 * is for.
 */
function eventLabel(event: TimelineEvent): string {
  switch (event.type) {
    case ReportEventType.SUBMITTED:
      return 'Report submitted';
    case ReportEventType.CLASSIFIED:
      return 'Classified by AI';
    case ReportEventType.PRIORITY_SCORED:
      return 'Priority scored';
    case ReportEventType.VERIFICATION_RECORDED:
      return 'Verification recorded';
    case ReportEventType.ASSIGNED:
      return 'Team assigned';
    case ReportEventType.DUPLICATE_LINKED:
      return 'Linked as duplicate';
    case ReportEventType.ALERT_DISPATCHED:
      return 'Proximity alert dispatched';
    case ReportEventType.STATUS_CHANGED:
      return event.fromStatus && event.toStatus
        ? `${statusLabel(event.fromStatus)} → ${statusLabel(event.toStatus)}`
        : 'Status changed';
    default:
      return event.type;
  }
}

/** Pipeline events are attributed to the system, never to a person. */
function actorLabel(event: TimelineEvent): string {
  return event.isSystem ? 'System' : (event.actorRole ?? 'Unknown actor');
}

export function IncidentTimeline({ timeline }: { timeline: IncidentTimelineState }) {
  if (timeline.status === 'idle') {
    return <p className="text-xs text-fg-subtle">No timeline loaded.</p>;
  }

  if (timeline.status === 'loading') {
    return (
      <div className="space-y-2">
        <p role="status" className="sr-only">
          Loading incident timeline.
        </p>
        <Loader2 aria-hidden="true" className="size-4 animate-spin text-fg-subtle" />
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  if (timeline.status === 'error') {
    return (
      <p role="alert" className="text-xs font-medium text-danger">
        {timeline.message}
      </p>
    );
  }

  if (timeline.events.length === 0) {
    return <p className="text-xs text-fg-subtle">No audit events recorded yet.</p>;
  }

  return (
    <ol className="space-y-3">
      {timeline.events.map((event) => (
        <li key={event.eventId} className="relative pl-4">
          {/* The rail and node are drawn with borders rather than list markers
              so the vertical line connects entries of different heights. */}
          <span
            aria-hidden="true"
            className="absolute bottom-0 left-[3px] top-4 w-px bg-border last:hidden"
          />
          <span
            aria-hidden="true"
            className="absolute left-0 top-1.5 size-[7px] rounded-xl bg-border-strong ring-2 ring-surface"
          />
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-fg">{eventLabel(event)}</span>
            <time
              dateTime={event.createdAt ?? undefined}
              className="tabular shrink-0 text-[11px] text-fg-subtle"
            >
              {absoluteTime(event.createdAt)}
            </time>
          </div>
          <p className="text-[11px] text-fg-subtle">{actorLabel(event)}</p>
          {event.note ? (
            <p className="mt-1 border-l-2 border-border pl-2 text-xs italic text-fg-muted">
              {event.note}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
