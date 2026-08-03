import { describe, expect, it } from 'vitest';
import { AssignmentStatus, Category, ReportStatus, Urgency } from '@crisismap/shared';

import {
  VolunteerBoardColumn,
  buildVolunteerTasks,
  filterVolunteerTasks,
  tasksByColumn,
  type VolunteerAssignmentRecord,
  type VolunteerReportRecord,
} from './tasks';

const report = (
  id: string,
  overrides: Partial<VolunteerReportRecord> = {},
): VolunteerReportRecord => ({
  id,
  status: ReportStatus.AI_CLASSIFIED,
  category: Category.MEDICAL,
  urgency: Urgency.HIGH,
  priorityScore: 7,
  regionId: 'north',
  createdAt: '2026-08-01T10:00:00Z',
  ...overrides,
});

const assignment = (
  id: string,
  reportId: string,
  status: AssignmentStatus,
  overrides: Partial<VolunteerAssignmentRecord> = {},
): VolunteerAssignmentRecord => ({
  id,
  reportId,
  teamId: 'team-a',
  status,
  createdAt: '2026-08-01T11:00:00Z',
  ...overrides,
});

describe('volunteer task projection', () => {
  it('maps report and assignment state into the five board columns', () => {
    const reports = [
      report('new'),
      report('assigned'),
      report('active'),
      report('verify', { status: ReportStatus.NEEDS_VERIFICATION }),
      report('done', { status: ReportStatus.RESOLVED }),
    ];
    const assignments = [
      assignment('a-1', 'assigned', AssignmentStatus.ASSIGNED),
      assignment('a-2', 'active', AssignmentStatus.ON_SCENE),
      assignment('a-3', 'verify', AssignmentStatus.EN_ROUTE),
      assignment('a-4', 'done', AssignmentStatus.COMPLETED),
    ];

    const grouped = tasksByColumn(buildVolunteerTasks(reports, assignments, []));

    expect(grouped.NEW.map((task) => task.reportId)).toEqual(['new']);
    expect(grouped.ASSIGNED.map((task) => task.reportId)).toEqual(['assigned']);
    expect(grouped.IN_PROGRESS.map((task) => task.reportId)).toEqual(['active']);
    expect(grouped.VERIFICATION_NEEDED.map((task) => task.reportId)).toEqual(['verify']);
    expect(grouped.COMPLETED.map((task) => task.reportId)).toEqual(['done']);
  });

  it('uses the newest assignment and omits cancelled and rejected work', () => {
    const tasks = buildVolunteerTasks(
      [report('cancelled'), report('rejected', { status: ReportStatus.REJECTED })],
      [
        assignment('old', 'cancelled', AssignmentStatus.ASSIGNED),
        assignment('new', 'cancelled', AssignmentStatus.CANCELLED, {
          createdAt: '2026-08-01T12:00:00Z',
        }),
      ],
      [],
    );

    expect(tasks).toEqual([]);
  });

  it('joins the team name and falls back to the team region', () => {
    const [task] = buildVolunteerTasks(
      [report('one', { regionId: null })],
      [assignment('a-1', 'one', AssignmentStatus.ACCEPTED)],
      [{ id: 'team-a', name: 'North medical volunteers', regionId: 'north' }],
    );

    expect(task).toMatchObject({
      teamName: 'North medical volunteers',
      regionId: 'north',
      column: VolunteerBoardColumn.ASSIGNED,
    });
  });

  it('filters across region, category, and urgency', () => {
    const tasks = buildVolunteerTasks(
      [
        report('match'),
        report('other-region', { regionId: 'south' }),
        report('other-category', { category: Category.FIRE }),
      ],
      [],
      [],
    );

    expect(
      filterVolunteerTasks(tasks, {
        regionId: 'north',
        category: Category.MEDICAL,
        urgency: Urgency.HIGH,
      }).map((task) => task.reportId),
    ).toEqual(['match']);
  });

  it('sorts cards by priority without mutating the source reads', () => {
    const reports = [report('low', { priorityScore: 2 }), report('high', { priorityScore: 9 })];
    const tasks = buildVolunteerTasks(reports, [], []);

    expect(tasks.map((task) => task.reportId)).toEqual(['high', 'low']);
    expect(reports.map((item) => item.id)).toEqual(['low', 'high']);
  });
});
