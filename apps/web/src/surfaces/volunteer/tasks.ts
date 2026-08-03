import {
  AssignmentStatus,
  Category,
  PriorityBand,
  ReportStatus,
  Urgency,
  priorityBandForScore,
  type PublicReport,
} from '@crisismap/shared';

/** The five workflow lanes in the design-document volunteer board (Figure 3). */
export const VolunteerBoardColumn = {
  NEW: 'NEW',
  ASSIGNED: 'ASSIGNED',
  IN_PROGRESS: 'IN_PROGRESS',
  VERIFICATION_NEEDED: 'VERIFICATION_NEEDED',
  COMPLETED: 'COMPLETED',
} as const;

export type VolunteerBoardColumn = (typeof VolunteerBoardColumn)[keyof typeof VolunteerBoardColumn];

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

/** PII-free task-card projection assembled from Report, Assignment, and Team reads. */
export interface VolunteerTask extends PublicReport {
  assignmentId: string | null;
  assignmentStatus: AssignmentStatus | null;
  teamId: string | null;
  teamName: string | null;
  column: VolunteerBoardColumn;
}

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

export interface VolunteerReportRecord {
  id: string;
  status?: string | null;
  category?: string | null;
  urgency?: string | null;
  priorityScore?: number | null;
  priorityBand?: string | null;
  summary?: string | null;
  lat?: number | null;
  lng?: number | null;
  geohash?: string | null;
  geohashPrefix?: string | null;
  regionId?: string | null;
  assignedTeamId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface VolunteerAssignmentRecord {
  id: string;
  reportId: string;
  teamId: string;
  status?: string | null;
  createdAt?: string | null;
}

export interface VolunteerTeamRecord {
  id: string;
  name: string;
  regionId?: string | null;
}

const REPORT_STATUSES = new Set<string>(Object.values(ReportStatus));
const CATEGORIES = new Set<string>(Object.values(Category));
const URGENCIES = new Set<string>(Object.values(Urgency));
const PRIORITY_BANDS = new Set<string>(Object.values(PriorityBand));
const ASSIGNMENT_STATUSES = new Set<string>(Object.values(AssignmentStatus));

function assignmentColumn(
  reportStatus: ReportStatus,
  assignmentStatus: AssignmentStatus | null,
): VolunteerBoardColumn | null {
  if (reportStatus === ReportStatus.NEEDS_VERIFICATION) {
    return VolunteerBoardColumn.VERIFICATION_NEEDED;
  }
  if (reportStatus === ReportStatus.RESOLVED || assignmentStatus === AssignmentStatus.COMPLETED) {
    return VolunteerBoardColumn.COMPLETED;
  }
  if (assignmentStatus === AssignmentStatus.CANCELLED) return null;
  if (
    assignmentStatus === AssignmentStatus.EN_ROUTE ||
    assignmentStatus === AssignmentStatus.ON_SCENE
  ) {
    return VolunteerBoardColumn.IN_PROGRESS;
  }
  if (
    assignmentStatus === AssignmentStatus.ASSIGNED ||
    assignmentStatus === AssignmentStatus.ACCEPTED
  ) {
    return VolunteerBoardColumn.ASSIGNED;
  }
  return VolunteerBoardColumn.NEW;
}

function newestAssignmentsByReport(
  assignments: readonly VolunteerAssignmentRecord[],
): Map<string, VolunteerAssignmentRecord> {
  const newest = new Map<string, VolunteerAssignmentRecord>();
  for (const assignment of assignments) {
    const current = newest.get(assignment.reportId);
    const currentTime = current?.createdAt ? Date.parse(current.createdAt) : 0;
    const candidateTime = assignment.createdAt ? Date.parse(assignment.createdAt) : 0;
    if (!current || candidateTime >= currentTime) newest.set(assignment.reportId, assignment);
  }
  return newest;
}

/**
 * Join bounded model reads into the board projection. Unknown enum values degrade safely and
 * cancelled assignments disappear; raw report text, contact, and media are never accepted here.
 */
export function buildVolunteerTasks(
  reports: readonly VolunteerReportRecord[],
  assignments: readonly VolunteerAssignmentRecord[],
  teams: readonly VolunteerTeamRecord[],
): VolunteerTask[] {
  const assignmentByReport = newestAssignmentsByReport(assignments);
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const tasks: VolunteerTask[] = [];

  for (const report of reports) {
    const status =
      report.status && REPORT_STATUSES.has(report.status)
        ? (report.status as ReportStatus)
        : ReportStatus.NEW;
    if (status === ReportStatus.REJECTED) continue;

    const assignment = assignmentByReport.get(report.id);
    const assignmentStatus =
      assignment?.status && ASSIGNMENT_STATUSES.has(assignment.status)
        ? (assignment.status as AssignmentStatus)
        : null;
    const column = assignmentColumn(status, assignmentStatus);
    if (!column) continue;

    const teamId = assignment?.teamId ?? report.assignedTeamId ?? null;
    const team = teamId ? teamById.get(teamId) : undefined;
    const priorityScore = report.priorityScore ?? null;
    const priorityBand =
      report.priorityBand && PRIORITY_BANDS.has(report.priorityBand)
        ? (report.priorityBand as PriorityBand)
        : priorityScore != null
          ? priorityBandForScore(priorityScore)
          : null;

    tasks.push({
      reportId: report.id,
      status,
      category:
        report.category && CATEGORIES.has(report.category) ? (report.category as Category) : null,
      urgency: report.urgency && URGENCIES.has(report.urgency) ? (report.urgency as Urgency) : null,
      priorityScore,
      priorityBand,
      summary: report.summary?.trim() || null,
      lat: report.lat ?? null,
      lng: report.lng ?? null,
      geohash: report.geohash ?? null,
      geohashPrefix: report.geohashPrefix ?? null,
      regionId: report.regionId ?? team?.regionId ?? null,
      createdAt: report.createdAt ?? null,
      updatedAt: report.updatedAt ?? null,
      assignmentId: assignment?.id ?? null,
      assignmentStatus,
      teamId,
      teamName: team?.name ?? null,
      column,
    });
  }

  return sortVolunteerTasks(tasks);
}

/** Highest priority first, then newest report. Never mutates the input. */
export function sortVolunteerTasks(tasks: readonly VolunteerTask[]): VolunteerTask[] {
  return [...tasks].sort((a, b) => {
    const scoreDifference = (b.priorityScore ?? -1) - (a.priorityScore ?? -1);
    if (scoreDifference !== 0) return scoreDifference;
    return Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? '');
  });
}

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
