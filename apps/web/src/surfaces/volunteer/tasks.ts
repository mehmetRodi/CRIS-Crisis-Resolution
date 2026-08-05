import { Category, Urgency, VolunteerBoardColumn, type VolunteerTask } from '@crisismap/shared';

export {
  VolunteerBoardColumn,
  buildVolunteerTasks,
  sortVolunteerTasks,
  type VolunteerAssignmentRecord,
  type VolunteerReportRecord,
  type VolunteerTask,
  type VolunteerTeamRecord,
} from '@crisismap/shared';

export const VOLUNTEER_BOARD_COLUMNS: readonly VolunteerBoardColumn[] = [
  VolunteerBoardColumn.NEW,
  VolunteerBoardColumn.ASSIGNED,
  VolunteerBoardColumn.IN_PROGRESS,
  VolunteerBoardColumn.VERIFICATION_NEEDED,
  VolunteerBoardColumn.COMPLETED,
];

export const VOLUNTEER_BOARD_LABELS: Readonly<Record<VolunteerBoardColumn, string>> = {
  NEW: 'New',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  VERIFICATION_NEEDED: 'Verification needed',
  COMPLETED: 'Completed',
};

export type VolunteerTaskFeedState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'error'; message: string }
  | { status: 'ready'; tasks: VolunteerTask[] };

export interface VolunteerTaskFilters {
  regionId: string;
  category: Category | '';
  urgency: Urgency | '';
}

export const EMPTY_VOLUNTEER_TASK_FILTERS: VolunteerTaskFilters = {
  regionId: '',
  category: '',
  urgency: '',
};

export function filterVolunteerTasks(
  tasks: readonly VolunteerTask[],
  filters: VolunteerTaskFilters,
): VolunteerTask[] {
  return tasks.filter(
    (task) =>
      (!filters.regionId || task.regionId === filters.regionId) &&
      (!filters.category || task.category === filters.category) &&
      (!filters.urgency || task.urgency === filters.urgency),
  );
}

export function taskFilterOptions(tasks: readonly VolunteerTask[]): {
  regions: string[];
  categories: Category[];
  urgencies: Urgency[];
} {
  const regions = new Set<string>();
  const categories = new Set<Category>();
  const urgencies = new Set<Urgency>();
  for (const task of tasks) {
    if (task.regionId) regions.add(task.regionId);
    if (task.category) categories.add(task.category);
    if (task.urgency) urgencies.add(task.urgency);
  }
  return {
    regions: [...regions].sort(),
    categories: [...categories].sort(),
    urgencies: [...urgencies].sort(),
  };
}

export function tasksByColumn(
  tasks: readonly VolunteerTask[],
): Record<VolunteerBoardColumn, VolunteerTask[]> {
  const grouped: Record<VolunteerBoardColumn, VolunteerTask[]> = {
    NEW: [],
    ASSIGNED: [],
    IN_PROGRESS: [],
    VERIFICATION_NEEDED: [],
    COMPLETED: [],
  };
  for (const task of tasks) grouped[task.column].push(task);
  return grouped;
}
