import { ChevronRight } from 'lucide-react';

import { CategoryTag } from '../../components/domain/CategoryTag';
import { PriorityBadge } from '../../components/domain/PriorityBadge';
import { StatusBadge } from '../../components/domain/StatusBadge';
import { cn } from '../../lib/cn';
import { relativeTime } from '../../lib/format';
import { bandOf, type CoordinatorIncident } from '../coordinator/incidents';

/**
 * One incident in the queue (CRIS-54).
 *
 * A `<button>`, not a table row. The queue moved from a table to a list because
 * the workspace gives it a ~22rem column beside the map, where seven columns of
 * a table become unreadably narrow. A list row also gives each incident ONE
 * focus stop with one obvious action ("open this incident"), instead of the
 * previous `tabIndex` + `onKeyDown` handling on a `<tr>` — which announced as a
 * table row and left the user to guess that Enter did anything.
 *
 * Renders only redacted fields; the AI `summary` is the headline, never the
 * untrusted raw report text (§5.6).
 */
export function IncidentRow({
  incident,
  selected,
  onSelect,
}: {
  incident: CoordinatorIncident;
  selected: boolean;
  onSelect: () => void;
}) {
  const band = bandOf(incident);
  const title = incident.summary ?? 'Awaiting AI summary';

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        // `aria-current` rather than `aria-selected`: the row is a button in a
        // list, not an option in a listbox, and `aria-selected` is ignored (or
        // reported as broken) on a button role.
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'group flex w-full items-start gap-3 border-l-3 px-3.5 py-3 text-left transition-all duration-150',
          selected
            ? 'border-l-accent bg-accent/10 shadow-2xs'
            : 'border-l-transparent hover:bg-surface-hover/80 active:bg-surface-hover',
        )}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex items-center gap-2">
            <PriorityBadge band={band} score={incident.priorityScore} />
            <span className="tabular ml-auto shrink-0 text-[11px] font-medium text-fg-subtle">
              {relativeTime(incident.createdAt)}
            </span>
          </span>

          <span
            className={cn(
              'line-clamp-2 text-xs font-medium leading-relaxed',
              incident.summary ? 'text-fg' : 'italic text-fg-subtle',
            )}
          >
            {title}
          </span>

          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
            <CategoryTag category={incident.category} className="text-xs" />
            {incident.regionId ? (
              <>
                <span aria-hidden="true" className="text-fg-subtle text-xs">
                  ·
                </span>
                <span className="truncate text-[11px] font-medium text-fg-muted">
                  {incident.regionId}
                </span>
              </>
            ) : null}
            <StatusBadge status={incident.status} className="ml-auto text-[11px]" />
          </span>
        </span>

        <ChevronRight
          aria-hidden="true"
          className={cn(
            'mt-1 size-4 shrink-0 transition-transform duration-150',
            selected
              ? 'text-accent translate-x-0.5'
              : 'text-fg-subtle group-hover:text-fg-muted group-hover:translate-x-0.5',
          )}
        />
      </button>
    </li>
  );
}
