import type { PriorityBand } from '@crisismap/shared';

import { CategoryTag } from '../../components/domain/CategoryTag';
import { PriorityBadge } from '../../components/domain/PriorityBadge';
import { Badge } from '../../components/ui/badge';
import { ASSIGNMENT_STATUS_META, urgencyLabel } from '../../lib/domain-display';
import { relativeTime } from '../../lib/format';
import type { AssignmentStatus, Category, Urgency } from '@crisismap/shared';
import type { VolunteerTask } from '../volunteer/tasks';

/**
 * One task on the volunteer board (CRIS-33 → CRIS-54).
 *
 * Read-only by design (ADR-0040): the volunteer projection is a server-enforced
 * redaction with no mutating API behind it, so this deliberately renders no
 * action controls. A card with disabled buttons would promise an interaction
 * that does not exist anywhere in the system.
 *
 * An `<article>`, not a button — nothing opens. Its accessible name leads with
 * the summary so a screen-reader user scanning the column hears what each task
 * IS before its metadata.
 */
export function TaskCard({ task }: { task: VolunteerTask }) {
  const title = task.summary ?? 'Awaiting AI summary';
  const band = (task.priorityBand as PriorityBand | null) ?? null;
  const assignment = task.assignmentStatus
    ? ASSIGNMENT_STATUS_META[task.assignmentStatus as AssignmentStatus]
    : null;

  return (
    <article
      aria-label={`${title}. Priority ${band ?? 'unscored'}.`}
      className="rounded-xl border border-border/80 bg-surface p-3 shadow-2xs transition-all duration-150 hover:border-accent/40 hover:shadow-xs"
    >
      <div className="flex items-start justify-between gap-2">
        <PriorityBadge band={band} />
        <span className="tabular shrink-0 text-[11px] font-medium text-fg-subtle">
          {relativeTime(task.createdAt)}
        </span>
      </div>

      <p
        className={
          task.summary
            ? 'mt-2 line-clamp-3 text-xs font-semibold leading-relaxed text-fg'
            : 'mt-2 text-xs italic text-fg-subtle'
        }
      >
        {title}
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <CategoryTag category={(task.category as Category | null) ?? null} className="text-xs" />
        {task.urgency ? (
          <span className="text-[11px] font-medium text-fg-subtle">· {urgencyLabel(task.urgency as Urgency)}</span>
        ) : null}
      </div>

      <dl className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-2 text-[11px]">
        <div className="flex items-center gap-1">
          <dt className="text-fg-subtle">Region</dt>
          <dd className="font-semibold text-fg-muted">{task.regionId ?? 'Unassigned'}</dd>
        </div>
        <div className="flex items-center gap-1">
          <dt className="text-fg-subtle">Team</dt>
          <dd className="font-semibold text-fg-muted">{task.teamName ?? 'Unassigned'}</dd>
        </div>
      </dl>

      {assignment ? (
        <Badge variant={assignment.badge} size="sm" className="mt-2 text-[11px]">
          {assignment.label}
        </Badge>
      ) : null}
    </article>
  );
}
