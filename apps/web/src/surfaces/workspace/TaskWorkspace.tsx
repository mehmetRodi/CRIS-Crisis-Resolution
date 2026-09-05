import { useState } from 'react';
import { Category, Urgency } from '@crisismap/shared';
import { ClipboardList, TriangleAlert, X } from 'lucide-react';

import { EmptyState } from '../../components/domain/EmptyState';
import { Button } from '../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Skeleton } from '../../components/ui/skeleton';
import { cn } from '../../lib/cn';
import { categoryMeta, urgencyLabel } from '../../lib/domain-display';
import { pluralize } from '../../lib/format';
import {
  EMPTY_VOLUNTEER_TASK_FILTERS,
  VOLUNTEER_BOARD_COLUMNS,
  VOLUNTEER_BOARD_LABELS,
  filterVolunteerTasks,
  taskFilterOptions,
  tasksByColumn,
  type VolunteerTask,
  type VolunteerTaskFeedState,
  type VolunteerTaskFilters,
} from '../volunteer/tasks';
import { TaskCard } from './TaskCard';

/**
 * The volunteer workspace (CRIS-33 → CRIS-54, ADR-0055).
 *
 * ── Why there is no map here ───────────────────────────────────────────────
 * This is the one operational role whose centre pane is NOT the map, and that
 * is a data-model consequence rather than a design preference. The
 * `VolunteerTask` projection is redacted server-side and carries no coordinates
 * at all (ADR-0042) — there is literally nothing to plot. Rendering an empty map
 * would read as "no incidents nearby" instead of "not shown to you", which is a
 * dangerous thing to imply during a crisis, so the stage board takes the centre
 * instead. Everything around it — shell, top bar, account menu, filter idiom —
 * is identical to the incident workspace, so the role change reads as a change
 * of contents, not a change of product.
 *
 * Read-only throughout: no mutating API exists behind this projection (ADR-0040).
 */

/** A sentinel `<Select>` value, since Radix reserves the empty string. */
const ALL = '__all__';

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
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-wider text-fg-subtle">
        {label}
      </span>
      <Select value={value || ALL} onValueChange={(next) => onChange(next === ALL ? '' : next)}>
        <SelectTrigger aria-label={label} className="w-40 min-w-[150px] text-xs h-8 rounded-lg border-border/80 bg-surface shadow-2xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="rounded-xl border-border/80 bg-surface/95 backdrop-blur-md shadow-lg">
          <SelectItem value={ALL} className="text-xs">All {label.toLowerCase()}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} className="text-xs">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function Column({ label, tasks }: { label: string; tasks: readonly VolunteerTask[] }) {
  const headingId = `task-column-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-h-0 w-72 shrink-0 flex-col rounded-2xl border border-border/80 bg-surface-sunken/60 shadow-2xs backdrop-blur-xs"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3.5 py-3">
        <h3 id={headingId} className="text-xs font-bold uppercase tracking-wider text-fg">
          {label}
        </h3>
        <span
          className="tabular rounded-full border border-border/60 bg-surface px-2 py-0.5 text-xs font-bold text-fg-muted shadow-2xs"
          aria-label={pluralize(tasks.length, 'task')}
        >
          {tasks.length}
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
        {tasks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 bg-surface/30 px-3 py-8 text-center text-xs font-medium text-fg-subtle">
            Nothing at this stage
          </div>
        ) : (
          tasks.map((task) => <TaskCard key={task.reportId} task={task} />)
        )}
      </div>
    </section>
  );
}

export function TaskWorkspace({ feed }: { feed: VolunteerTaskFeedState }) {
  const [filters, setFilters] = useState<VolunteerTaskFilters>(EMPTY_VOLUNTEER_TASK_FILTERS);

  const tasks = feed.status === 'ready' ? feed.tasks : [];
  const options = taskFilterOptions(tasks);
  const visible = filterVolunteerTasks(tasks, filters);
  const columns = tasksByColumn(visible);
  const active = Boolean(filters.regionId || filters.category || filters.urgency);

  if (feed.status !== 'ready') {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {feed.status === 'loading' ? (
          <>
            <p role="status" className="sr-only">
              Loading volunteer tasks.
            </p>
            <div className="flex gap-3">
              {VOLUNTEER_BOARD_COLUMNS.map((column) => (
                <Skeleton key={column} className="h-64 w-72 shrink-0" />
              ))}
            </div>
          </>
        ) : feed.status === 'unauthenticated' ? (
          <EmptyState
            icon={ClipboardList}
            title="Sign in to view tasks"
            description="The regional task board is available to volunteers, responders, coordinators, and administrators."
            className="mx-auto max-w-md"
          />
        ) : (
          <EmptyState
            tone="error"
            icon={TriangleAlert}
            title="Couldn't load tasks"
            description={feed.message}
            className="mx-auto max-w-md"
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-end gap-3 border-b border-border bg-surface px-4 py-3">
        <div className="mr-auto">
          <h2 className="text-sm font-semibold text-fg">Regional task board</h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            {active
              ? `${visible.length} of ${tasks.length} tasks shown`
              : pluralize(tasks.length, 'task')}
            {' · '}
            {/* Stated plainly rather than left to be discovered: a volunteer who
                expects to see a location and finds none should know it is a
                privacy boundary, not a data gap. */}
            reporter details and exact locations are never shared with this view
          </p>
        </div>

        <FilterSelect
          label="Region"
          value={filters.regionId}
          options={options.regions.map((region) => ({ value: region, label: region }))}
          onChange={(regionId) => setFilters((f) => ({ ...f, regionId }))}
        />
        <FilterSelect
          label="Category"
          value={filters.category}
          options={options.categories.map((category) => ({
            value: category,
            label: categoryMeta(category).label,
          }))}
          onChange={(category) =>
            setFilters((f) => ({ ...f, category: category as Category | '' }))
          }
        />
        <FilterSelect
          label="Urgency"
          value={filters.urgency}
          options={options.urgencies.map((urgency) => ({
            value: urgency,
            label: urgencyLabel(urgency),
          }))}
          onChange={(urgency) => setFilters((f) => ({ ...f, urgency: urgency as Urgency | '' }))}
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={!active}
          onClick={() => setFilters(EMPTY_VOLUNTEER_TASK_FILTERS)}
        >
          <X aria-hidden="true" />
          Clear
        </Button>
      </div>

      {tasks.length === 0 ? (
        <div className="flex-1 p-4">
          <EmptyState
            icon={ClipboardList}
            title="No tasks assigned yet"
            description="Tasks appear here as incidents are classified and assigned to your region."
            className="mx-auto max-w-md"
          />
        </div>
      ) : (
        // Horizontal scroll on the board, never on the page: the five stages do
        // not fit a laptop at a readable card width, and a horizontally
        // scrolling document breaks everything else on the screen.
        <div className={cn('min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-3')}>
          <div className="flex h-full gap-3">
            {VOLUNTEER_BOARD_COLUMNS.map((column) => (
              <Column key={column} label={VOLUNTEER_BOARD_LABELS[column]} tasks={columns[column]} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
