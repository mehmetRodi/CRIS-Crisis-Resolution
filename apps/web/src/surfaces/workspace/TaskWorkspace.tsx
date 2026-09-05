import { useMyReportWork } from '../volunteer/useMyReportWork';
import { useRef, useState } from 'react';
import { Category, Urgency, UserRole, VolunteerBoardColumn } from '@crisismap/shared';
import { ClipboardList, Search, SlidersHorizontal, TriangleAlert, X } from 'lucide-react';
import { EmptyState } from '../../components/domain/EmptyState';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, SheetContent } from '../../components/ui/dialog';
import { Skeleton } from '../../components/ui/skeleton';
import { cn } from '../../lib/cn';
import { categoryMeta, urgencyLabel } from '../../lib/domain-display';
import {
  EMPTY_VOLUNTEER_TASK_FILTERS,
  filterVolunteerTasks,
  taskFilterOptions,
  type VolunteerTask,
  type VolunteerTaskFeedState,
  type VolunteerTaskFilters,
} from '../volunteer/tasks';
import { TaskCard } from './TaskCard';
import { TaskDetail } from './TaskDetail';

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-fg-muted">
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 min-w-0 rounded-lg border border-border bg-surface px-3 text-sm text-fg"
      >
        <option value="">
          All{' '}
          {label === 'Category'
            ? 'categories'
            : label === 'Urgency'
              ? 'urgencies'
              : `${label.toLowerCase()}s`}
        </option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TaskWorkspace({
  feed,
  callerRole = UserRole.VOLUNTEER,
}: {
  feed: VolunteerTaskFeedState;
  callerRole?: UserRole;
}) {
  const [filters, setFilters] = useState<VolunteerTaskFilters>(EMPTY_VOLUNTEER_TASK_FILTERS);
  const [teamId, setTeamId] = useState('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'mine' | 'active' | 'completed' | 'all'>('active');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const myWork = useMyReportWork();
  const tasks = feed.status === 'ready' ? feed.tasks : [];
  const options = taskFilterOptions(tasks);
  const teams = [
    ...new Map(
      tasks
        .filter((task) => task.teamId)
        .map((task) => [task.teamId!, task.teamName ?? task.teamId!]),
    ).entries(),
  ];
  const matching = filterVolunteerTasks(tasks, filters).filter(
    (task) =>
      (!teamId || task.teamId === teamId) &&
      (!search.trim() ||
        [task.summary, task.regionId, task.teamName].some((value) =>
          value?.toLowerCase().includes(search.trim().toLowerCase()),
        )),
  );
  const completed = matching.filter(
    (task) => task.column === VolunteerBoardColumn.COMPLETED,
  ).length;
  const visible = matching.filter(
    (task) =>
      view === 'all' ||
      (view === 'mine'
        ? myWork.ids.includes(task.reportId)
        : view === 'completed'
          ? task.column === VolunteerBoardColumn.COMPLETED
          : task.column !== VolunteerBoardColumn.COMPLETED),
  );
  const selected = tasks.find((task) => task.reportId === selectedId);
  const filtered = Boolean(
    filters.regionId || filters.category || filters.urgency || teamId || search,
  );
  function clear() {
    setFilters(EMPTY_VOLUNTEER_TASK_FILTERS);
    setTeamId('');
    setSearch('');
    setView('active');
  }
  function openTask(task: VolunteerTask, trigger: HTMLButtonElement) {
    triggerRef.current = trigger;
    setSelectedId(task.reportId);
  }

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-2xl border border-border bg-bg p-4 sm:p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-accent">
            Volunteer workspace
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Find where you can help.
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-fg-muted">
            Focus on your region and team. Open a task for details and its available map location.
          </p>
        </div>
        <span className="hidden rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-fg-muted sm:block">
          Regional task board
        </span>
      </div>
      {feed.status === 'ready' ? (
        <>
          <div className="mb-6 grid grid-cols-3 gap-2 sm:gap-4" aria-label="Task overview">
            {[
              [matching.length - completed, 'Active tasks'],
              [
                matching.filter((task) => task.column === VolunteerBoardColumn.IN_PROGRESS).length,
                'In progress',
              ],
              [completed, 'Completed'],
            ].map(([count, label], index) => (
              <div
                key={label}
                className={cn(
                  'rounded-2xl border p-4 sm:p-5',
                  index === 0
                    ? 'border-accent-border bg-accent-subtle'
                    : 'border-border bg-surface',
                )}
              >
                <p className="text-xs font-medium text-fg-muted">{label}</p>
                <p className="tabular mt-3 text-3xl font-semibold tracking-tight">{count}</p>
                <p className="mt-2 hidden text-xs text-fg-muted sm:block">In your selected view</p>
              </div>
            ))}
          </div>
          <details
            aria-label="Task filters"
            className="mb-6 rounded-2xl border border-border bg-surface p-4"
          >
            <summary className="cursor-pointer rounded-lg text-sm font-semibold text-fg">
              <span className="ml-2 inline-flex items-center gap-2">
                <SlidersHorizontal className="size-4 text-accent" aria-hidden="true" />
                Your focus
              </span>
              <span className="ml-2 text-xs font-normal text-fg-muted">
                {filtered ? 'Filters applied' : 'Filter by region, team, or category'}
              </span>
            </summary>
            <div className="mb-4 mt-4 flex flex-wrap items-center gap-3">
              <SlidersHorizontal className="size-4 text-fg-muted" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Your focus</h2>
              <p className="text-xs text-fg-muted">Choose the work relevant to you.</p>
              {filtered ? (
                <Button className="ml-auto" variant="ghost" size="sm" onClick={clear}>
                  <X aria-hidden="true" />
                  Reset filters
                </Button>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <FilterSelect
                label="Region"
                value={filters.regionId}
                options={options.regions.map((region) => ({ value: region, label: region }))}
                onChange={(regionId) => setFilters((value) => ({ ...value, regionId }))}
              />
              <FilterSelect
                label="Team"
                value={teamId}
                options={teams.map(([value, label]) => ({ value, label }))}
                onChange={setTeamId}
              />
              <FilterSelect
                label="Category"
                value={filters.category}
                options={options.categories.map((category) => ({
                  value: category,
                  label: categoryMeta(category).label,
                }))}
                onChange={(category) =>
                  setFilters((value) => ({ ...value, category: category as Category | '' }))
                }
              />
              <FilterSelect
                label="Urgency"
                value={filters.urgency}
                options={options.urgencies.map((urgency) => ({
                  value: urgency,
                  label: urgencyLabel(urgency),
                }))}
                onChange={(urgency) =>
                  setFilters((value) => ({ ...value, urgency: urgency as Urgency | '' }))
                }
              />
            </div>
          </details>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div
              role="group"
              aria-label="Task view"
              className="flex rounded-xl border border-border bg-surface p-1"
            >
              {(['mine', 'active', 'completed', 'all'] as const).map((item) => (
                <Button
                  key={item}
                  size="sm"
                  variant="ghost"
                  aria-pressed={view === item}
                  onClick={() => setView(item)}
                  className={cn(view === item && 'bg-accent-subtle text-accent-subtle-fg')}
                >
                  {item === 'mine'
                    ? 'My tasks'
                    : item === 'active'
                      ? 'Active tasks'
                      : item === 'completed'
                        ? 'Completed'
                        : 'All tasks'}
                </Button>
              ))}
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-3 size-4 text-fg-muted" aria-hidden="true" />
              <Input
                aria-label="Search tasks"
                placeholder="Search tasks…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-10 bg-surface pl-9"
              />
            </div>
          </div>
          <p role="status" className="mb-4 text-xs text-fg-muted">
            {visible.length} of {tasks.length} tasks shown
          </p>
          {view === 'mine' && myWork.status !== 'ready' ? (
            <EmptyState
              title={
                myWork.status === 'loading' ? 'Loading your tasks…' : 'Could not load your tasks'
              }
              description={myWork.message}
              action={
                myWork.status === 'error' ? (
                  <Button onClick={myWork.refresh} variant="secondary">
                    Retry my tasks
                  </Button>
                ) : undefined
              }
            />
          ) : visible.length ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {visible.map((task) => (
                <TaskCard key={task.reportId} task={task} onSelect={openTask} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={ClipboardList}
              title={tasks.length === 0 ? 'No tasks available yet' : 'No tasks in this view'}
              description={
                tasks.length === 0
                  ? 'Tasks will appear as incidents are reviewed and response work is organised.'
                  : 'Try a different region, team, or task view.'
              }
              action={
                tasks.length > 0 ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      clear();
                      setView('all');
                    }}
                  >
                    Show all tasks
                  </Button>
                ) : undefined
              }
            />
          )}
        </>
      ) : feed.status === 'loading' ? (
        <>
          <p role="status" className="sr-only">
            Loading volunteer tasks.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
          <Skeleton className="mt-6 h-64" />
        </>
      ) : (
        <EmptyState
          icon={feed.status === 'error' ? TriangleAlert : ClipboardList}
          tone={feed.status === 'error' ? 'error' : undefined}
          title={feed.status === 'error' ? "Couldn't load tasks" : 'Sign in to view tasks'}
          description={
            feed.status === 'error'
              ? feed.message
              : 'Sign in with your operational account to browse the task board.'
          }
        />
      )}
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        {selected ? (
          <SheetContent
            className="max-w-xl"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (triggerRef.current?.isConnected) triggerRef.current.focus();
              else document.getElementById('workspace-main')?.focus();
            }}
          >
            <TaskDetail key={selected.reportId} task={selected} callerRole={callerRole} />
          </SheetContent>
        ) : null}
      </Dialog>
    </div>
  );
}
