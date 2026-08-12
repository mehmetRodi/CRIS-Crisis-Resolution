import { useState } from 'react';
import { Category, Urgency, UserRole } from '@crisismap/shared';

import {
  EMPTY_VOLUNTEER_TASK_FILTERS,
  VOLUNTEER_BOARD_COLUMNS,
  VOLUNTEER_BOARD_LABELS,
  VolunteerBoardColumn,
  filterVolunteerTasks,
  taskFilterOptions,
  tasksByColumn,
  type VolunteerTask,
  type VolunteerTaskFeedState,
  type VolunteerTaskFilters,
} from './tasks';

export interface VolunteerTaskBoardProps {
  onExit: () => void;
  feed?: VolunteerTaskFeedState;
  onRefresh?: () => void;
}

const COLUMN_STYLES: Readonly<Record<VolunteerBoardColumn, string>> = {
  NEW: 'border-blue-300 bg-blue-50 text-blue-800',
  ASSIGNED: 'border-orange-300 bg-orange-50 text-orange-800',
  IN_PROGRESS: 'border-violet-300 bg-violet-50 text-violet-800',
  VERIFICATION_NEEDED: 'border-amber-300 bg-amber-50 text-amber-800',
  COMPLETED: 'border-emerald-300 bg-emerald-50 text-emerald-800',
};

function formatDate(value: string | null): string {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function TaskCard({ task }: { task: VolunteerTask }) {
  const title = task.summary ?? `${task.category ?? 'Unclassified'} incident`;
  return (
    <article
      aria-label={`${title}, ${task.priorityBand ?? 'unscored'}`}
      className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-5 text-slate-900">{title}</h3>
        {task.priorityBand ? (
          <span className="rounded bg-slate-900 px-1.5 py-0.5 text-xs font-bold text-white">
            {task.priorityBand}
          </span>
        ) : null}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
        <div>
          <dt className="text-slate-500">Category</dt>
          <dd className="font-medium text-slate-700">{task.category ?? 'Pending'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Urgency</dt>
          <dd className="font-medium text-slate-700">{task.urgency ?? 'Pending'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Region</dt>
          <dd className="font-medium text-slate-700">{task.regionId ?? 'Unassigned'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Team</dt>
          <dd className="font-medium text-slate-700">{task.teamName ?? 'Unassigned'}</dd>
        </div>
      </dl>
      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-500">
        <span>{task.assignmentStatus ?? task.status}</span>
        <time dateTime={task.createdAt ?? undefined}>{formatDate(task.createdAt)}</time>
      </div>
    </article>
  );
}

function FilterBar({
  filters,
  onChange,
  tasks,
}: {
  filters: VolunteerTaskFilters;
  onChange: (filters: VolunteerTaskFilters) => void;
  tasks: readonly VolunteerTask[];
}) {
  const options = taskFilterOptions(tasks);
  const active = Boolean(filters.regionId || filters.category || filters.urgency);
  return (
    <section
      aria-labelledby="volunteer-filters-heading"
      className="rounded-xl bg-white p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h2 id="volunteer-filters-heading" className="font-semibold text-slate-900">
            Task filters
          </h2>
          <p className="text-sm text-slate-500">Narrow the regional working set.</p>
        </div>
        <label className="text-sm font-medium text-slate-700">
          Region
          <select
            value={filters.regionId}
            onChange={(event) => onChange({ ...filters, regionId: event.target.value })}
            className="mt-1 block min-w-40 rounded-md border border-slate-300 bg-white px-3 py-2"
          >
            <option value="">All regions</option>
            {options.regions.map((region) => (
              <option key={region} value={region}>
                {region}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          Category
          <select
            value={filters.category}
            onChange={(event) =>
              onChange({ ...filters, category: event.target.value as Category | '' })
            }
            className="mt-1 block min-w-40 rounded-md border border-slate-300 bg-white px-3 py-2"
          >
            <option value="">All categories</option>
            {options.categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          Urgency
          <select
            value={filters.urgency}
            onChange={(event) =>
              onChange({ ...filters, urgency: event.target.value as Urgency | '' })
            }
            className="mt-1 block min-w-40 rounded-md border border-slate-300 bg-white px-3 py-2"
          >
            <option value="">All urgencies</option>
            {options.urgencies.map((urgency) => (
              <option key={urgency} value={urgency}>
                {urgency}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => onChange(EMPTY_VOLUNTEER_TASK_FILTERS)}
          disabled={!active}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear filters
        </button>
      </div>
    </section>
  );
}

function Board({ tasks }: { tasks: readonly VolunteerTask[] }) {
  const columns = tasksByColumn(tasks);
  return (
    <section aria-labelledby="task-board-heading" className="mt-5">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 id="task-board-heading" className="text-lg font-semibold text-slate-900">
          Regional task board
        </h2>
        <p className="text-sm text-slate-500">
          {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} shown
        </p>
      </div>
      <div className="grid min-w-[1100px] grid-cols-5 gap-3" aria-label="Task workflow columns">
        {VOLUNTEER_BOARD_COLUMNS.map((column) => (
          <section
            key={column}
            aria-labelledby={`volunteer-column-${column.toLowerCase()}`}
            className="min-h-64 rounded-xl bg-slate-100 p-3"
          >
            <div
              className={`mb-3 flex items-center justify-between rounded-md border px-2 py-1 ${COLUMN_STYLES[column]}`}
            >
              <h3 id={`volunteer-column-${column.toLowerCase()}`} className="text-sm font-semibold">
                {VOLUNTEER_BOARD_LABELS[column]}
              </h3>
              <span aria-label={`${columns[column].length} tasks`} className="text-xs font-bold">
                {columns[column].length}
              </span>
            </div>
            <div className="space-y-3">
              {columns[column].length > 0 ? (
                columns[column].map((task) => <TaskCard key={task.reportId} task={task} />)
              ) : (
                <p className="rounded-lg border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500">
                  No tasks in this stage
                </p>
              )}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

/** Read-only volunteer workflow board; task mutations remain behind a future guarded API. */
export function VolunteerTaskBoard({ onExit, feed, onRefresh }: VolunteerTaskBoardProps) {
  const resolvedFeed = feed ?? { status: 'loading' };
  const [filters, setFilters] = useState<VolunteerTaskFilters>(EMPTY_VOLUNTEER_TASK_FILTERS);
  const allTasks = resolvedFeed.status === 'ready' ? resolvedFeed.tasks : [];
  const filteredTasks = filterVolunteerTasks(allTasks, filters);
  const activeCount = allTasks.filter(
    (task) => task.column !== VolunteerBoardColumn.COMPLETED,
  ).length;
  const completedCount = allTasks.length - activeCount;

  const statusMessage =
    resolvedFeed.status === 'loading'
      ? 'Loading volunteer tasks.'
      : resolvedFeed.status === 'error'
        ? resolvedFeed.message
        : resolvedFeed.status === 'unauthenticated'
          ? 'Sign in as a volunteer to view regional tasks.'
          : '';

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={onExit}
              className="mb-2 text-sm font-medium text-blue-700 hover:text-blue-900"
            >
              ← Overview
            </button>
            <h1 className="text-2xl font-bold tracking-tight">Volunteer task board</h1>
            <p className="mt-1 text-sm text-slate-600">
              Track regional assignments without exposing reporter details or incident media.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">
              {UserRole.VOLUNTEER}
            </span>
            <button
              type="button"
              onClick={onRefresh}
              disabled={!onRefresh || resolvedFeed.status === 'loading'}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        </header>

        <div
          role={resolvedFeed.status === 'error' ? 'alert' : 'status'}
          className={statusMessage ? 'mb-4 rounded-md bg-white p-3 text-sm shadow-sm' : 'sr-only'}
        >
          {statusMessage}
        </div>

        {resolvedFeed.status === 'ready' ? (
          <>
            <section aria-label="Task metrics" className="mb-5 grid gap-3 sm:grid-cols-3">
              {[
                ['Active tasks', activeCount],
                ['Completed', completedCount],
                ['Regions', taskFilterOptions(allTasks).regions.length],
              ].map(([label, count]) => (
                <div key={label} className="rounded-xl bg-white p-4 shadow-sm">
                  <p className="text-sm text-slate-500">{label}</p>
                  <p className="mt-1 text-2xl font-bold">{count}</p>
                </div>
              ))}
            </section>
            <FilterBar filters={filters} onChange={setFilters} tasks={allTasks} />
            <div className="overflow-x-auto pb-4">
              <Board tasks={filteredTasks} />
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
