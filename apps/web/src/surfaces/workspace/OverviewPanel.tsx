import { Activity, MousePointerClick } from 'lucide-react';

import { CategoryTag } from '../../components/domain/CategoryTag';
import { EmptyState } from '../../components/domain/EmptyState';
import { StatusBadge } from '../../components/domain/StatusBadge';
import { cn } from '../../lib/cn';
import { relativeTime, shortId } from '../../lib/format';
import type { RealtimeConnectionState } from '../../lib/report-updates';
import {
  countByCategory,
  type CoordinatorIncident,
  type ReportActivity,
} from '../coordinator/incidents';

/**
 * What the detail rail shows when no incident is selected (CRIS-54).
 *
 * The previous dashboard gave live activity and the category breakdown their own
 * permanent panels, which competed with the incident detail for the same screen
 * space. Here they occupy the rail only while it is otherwise idle — situational
 * awareness when you are between incidents, and out of the way the moment you
 * are working one.
 */
export function OverviewPanel({
  incidents,
  activity,
  realtime,
  className,
}: {
  incidents: readonly CoordinatorIncident[];
  /** Redacted updates received during this browser session (CRIS-28). */
  activity: readonly ReportActivity[];
  realtime: RealtimeConnectionState;
  className?: string;
}) {
  const categories = countByCategory(incidents);

  return (
    <aside
      aria-label="Situation overview"
      className={cn('flex min-h-0 flex-col overflow-y-auto bg-surface', className)}
    >
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-fg">Overview</h2>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-fg-muted">
          <MousePointerClick aria-hidden="true" className="size-3.5 shrink-0" />
          Select an incident to see its detail and actions.
        </p>
      </div>

      <section aria-labelledby="overview-activity" className="px-4 py-3.5">
        <h3
          id="overview-activity"
          className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle"
        >
          Live activity
        </h3>
        {activity.length === 0 ? (
          <p className="text-xs text-fg-subtle">
            {realtime === 'connected'
              ? 'Waiting for updates. Changes appear here as they happen.'
              : 'Updates appear here once the live connection is established.'}
          </p>
        ) : (
          <ol className="space-y-2" aria-label="Live report activity">
            {activity.map((item) => (
              <li
                key={item.sequence}
                className="rounded border border-border bg-surface-sunken/60 px-2.5 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  {/* Redacted by construction: the subscription payload carries
                      the public projection only, so this shows an id and a
                      status, never reporter data (§5.6). */}
                  <span className="font-mono text-[11px] text-fg-subtle">
                    {shortId(item.reportId)}
                  </span>
                  <span className="tabular text-[11px] text-fg-subtle">
                    {relativeTime(item.occurredAt)}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <StatusBadge status={item.status} />
                </div>
                {item.summary ? (
                  <p className="mt-1.5 line-clamp-2 text-xs text-fg-muted">{item.summary}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="overview-categories" className="border-t border-border px-4 py-3.5">
        <h3
          id="overview-categories"
          className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle"
        >
          By category
        </h3>
        {categories.length === 0 ? (
          <EmptyState icon={Activity} title="Nothing to break down yet" />
        ) : (
          <ul className="space-y-1.5">
            {categories.map(({ category, count }) => {
              // Proportional bar against the largest category, not against the
              // total: with ten categories every bar would be a sliver and the
              // relative shape — the thing worth seeing — would be lost.
              const max = categories[0]?.count ?? 1;
              return (
                <li key={category} className="flex items-center gap-2">
                  <CategoryTag category={category} className="w-36 shrink-0 text-xs" />
                  <span
                    aria-hidden="true"
                    className="h-1.5 flex-1 overflow-hidden rounded-sm bg-surface-sunken"
                  >
                    <span
                      className="block h-full rounded-sm bg-accent/60"
                      style={{ width: `${Math.max(4, (count / max) * 100)}%` }}
                    />
                  </span>
                  <span className="tabular w-6 shrink-0 text-right text-xs font-medium text-fg">
                    {count}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </aside>
  );
}
