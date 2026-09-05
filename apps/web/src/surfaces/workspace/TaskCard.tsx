import { ArrowUpRight, MapPin, Users } from 'lucide-react';
import { CategoryTag } from '../../components/domain/CategoryTag';
import { PriorityBadge } from '../../components/domain/PriorityBadge';
import { StatusBadge } from '../../components/domain/StatusBadge';
import { relativeTime } from '../../lib/format';
import type { VolunteerTask } from '../volunteer/tasks';

export function TaskCard({
  task,
  onSelect,
}: {
  task: VolunteerTask;
  onSelect: (task: VolunteerTask, trigger: HTMLButtonElement) => void;
}) {
  const title = task.summary ?? 'Awaiting incident summary';
  return (
    <button
      type="button"
      onClick={(event) => onSelect(task, event.currentTarget)}
      aria-label={`Open task: ${title}`}
      className="group flex h-full w-full flex-col rounded-2xl border border-border bg-surface p-5 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:border-accent-border hover:shadow-md"
    >
      <span className="flex w-full items-center justify-between gap-2">
        <PriorityBadge band={task.priorityBand ?? null} />
        <ArrowUpRight
          className="size-4 text-fg-muted transition-colors group-hover:text-accent"
          aria-hidden="true"
        />
      </span>
      <span className="mt-4 line-clamp-3 text-base font-semibold leading-relaxed tracking-tight">
        {title}
      </span>
      <span className="mb-5 mt-3">
        <CategoryTag category={task.category ?? null} />
      </span>
      <span className="mt-auto flex w-full flex-col gap-2 border-t border-border pt-4 text-xs text-fg-muted">
        <span className="flex items-center gap-2">
          <MapPin className="size-3.5" aria-hidden="true" />
          {task.regionId ?? 'Region pending'}
        </span>
        <span className="flex items-center gap-2">
          <Users className="size-3.5" aria-hidden="true" />
          {task.teamName ?? 'Team not yet assigned'}
        </span>
      </span>
      <span className="mt-4 flex w-full flex-wrap items-center justify-between gap-2">
        <StatusBadge status={task.status} />
        <span className="text-[11px] text-fg-muted">{relativeTime(task.createdAt)}</span>
      </span>
    </button>
  );
}
