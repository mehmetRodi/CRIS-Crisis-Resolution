import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssignmentStatus, ReportStatus, VolunteerBoardColumn } from '@crisismap/shared';
import { appSyncEvent, invokeHandler } from '../testing/appsync';
import { fakeDocumentClient, fakeDynamo } from '../testing/fake-dynamo';
import {
  ASSIGNMENT_PROJECTION,
  REPORT_PROJECTION,
  TEAM_PROJECTION,
  VOLUNTEER_TASK_READ_LIMIT,
} from './store';

vi.hoisted(() => {
  process.env.REPORT_TABLE_NAME = 'Report-test';
  process.env.ASSIGNMENT_TABLE_NAME = 'Assignment-test';
  process.env.TEAM_TABLE_NAME = 'Team-test';
});

vi.mock('@aws-sdk/lib-dynamodb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/lib-dynamodb')>();
  return {
    ...actual,
    DynamoDBDocumentClient: { from: () => fakeDocumentClient },
  };
});

import { handler } from './handler';

describe('listVolunteerTasks handler integration', () => {
  beforeEach(() => fakeDynamo.reset());

  it('reads through allow-list projections and returns the joined redacted task shape', async () => {
    fakeDynamo.queue('ScanCommand', {
      Items: [
        {
          id: 'report-1',
          status: ReportStatus.AI_CLASSIFIED,
          priorityScore: 8,
          summary: 'Deliver water',
          regionId: 'north',
          assignedTeamId: 'team-1',
          createdAt: '2026-08-14T09:00:00.000Z',
        },
      ],
    });
    fakeDynamo.queue('ScanCommand', {
      Items: [
        {
          id: 'assignment-1',
          reportId: 'report-1',
          teamId: 'team-1',
          status: AssignmentStatus.ASSIGNED,
        },
      ],
    });
    fakeDynamo.queue('ScanCommand', {
      Items: [{ id: 'team-1', name: 'North volunteers', regionId: 'north' }],
    });

    const result = await invokeHandler(handler, appSyncEvent({}));

    expect(result).toEqual([
      expect.objectContaining({
        reportId: 'report-1',
        summary: 'Deliver water',
        teamName: 'North volunteers',
        column: VolunteerBoardColumn.ASSIGNED,
      }),
    ]);
    expect(result[0]).not.toHaveProperty('text');
    expect(result[0]).not.toHaveProperty('reporterContact');
    expect(fakeDynamo.sentOf('ScanCommand').map(({ input }) => input)).toEqual([
      {
        TableName: 'Report-test',
        Limit: VOLUNTEER_TASK_READ_LIMIT,
        ProjectionExpression: REPORT_PROJECTION,
        ExpressionAttributeNames: { '#status': 'status' },
      },
      {
        TableName: 'Assignment-test',
        Limit: VOLUNTEER_TASK_READ_LIMIT,
        ProjectionExpression: ASSIGNMENT_PROJECTION,
        ExpressionAttributeNames: { '#status': 'status' },
      },
      {
        TableName: 'Team-test',
        Limit: VOLUNTEER_TASK_READ_LIMIT,
        ProjectionExpression: TEAM_PROJECTION,
        ExpressionAttributeNames: { '#name': 'name' },
      },
    ]);
  });
});
