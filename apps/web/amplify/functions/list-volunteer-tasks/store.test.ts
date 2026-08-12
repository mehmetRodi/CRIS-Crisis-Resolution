import { describe, expect, it, vi } from 'vitest';
import { ScanCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { AssignmentStatus, ReportStatus, VolunteerBoardColumn } from '@crisismap/shared';
import {
  ASSIGNMENT_PROJECTION,
  REPORT_PROJECTION,
  TEAM_PROJECTION,
  VOLUNTEER_TASK_READ_LIMIT,
  createVolunteerTaskReader,
} from './store';

const TABLES = { report: 'Report-test', assignment: 'Assignment-test', team: 'Team-test' };

function fakeClient(responses: unknown[]) {
  const sent: unknown[] = [];
  const send = vi.fn(async (command: unknown) => {
    sent.push(command);
    return responses.shift() ?? {};
  });
  return { client: { send } as unknown as DynamoDBDocumentClient, send, sent };
}

describe('listVolunteerTasks store', () => {
  it('uses server-side allow-list projections that exclude sensitive and precise-location fields', async () => {
    const { client, send, sent } = fakeClient([{ Items: [] }, { Items: [] }, { Items: [] }]);

    await createVolunteerTaskReader(TABLES, client).list();

    expect(send).toHaveBeenCalledTimes(3);
    const commands = sent.map((command) => command as ScanCommand);
    expect(commands.map((command) => command.input)).toEqual([
      expect.objectContaining({
        TableName: TABLES.report,
        Limit: VOLUNTEER_TASK_READ_LIMIT,
        ProjectionExpression: REPORT_PROJECTION,
      }),
      expect.objectContaining({
        TableName: TABLES.assignment,
        Limit: VOLUNTEER_TASK_READ_LIMIT,
        ProjectionExpression: ASSIGNMENT_PROJECTION,
      }),
      expect.objectContaining({
        TableName: TABLES.team,
        Limit: VOLUNTEER_TASK_READ_LIMIT,
        ProjectionExpression: TEAM_PROJECTION,
      }),
    ]);

    expect(REPORT_PROJECTION).not.toMatch(
      /\b(text|reporterId|reporterContact|mediaKeys|lat|lng|geohash|geohashPrefix)\b/,
    );
  });

  it('joins the projected records into the narrow task response', async () => {
    const { client } = fakeClient([
      {
        Items: [
          {
            id: 'report-1',
            status: ReportStatus.AI_CLASSIFIED,
            category: 'MEDICAL',
            urgency: 'HIGH',
            priorityScore: 8,
            summary: 'Deliver first-aid kits',
            assignedTeamId: 'team-1',
            regionId: 'north',
          },
        ],
      },
      {
        Items: [
          {
            id: 'assignment-1',
            reportId: 'report-1',
            teamId: 'team-1',
            status: AssignmentStatus.ASSIGNED,
          },
        ],
      },
      { Items: [{ id: 'team-1', name: 'North volunteers', regionId: 'north' }] },
    ]);

    await expect(createVolunteerTaskReader(TABLES, client).list()).resolves.toEqual([
      expect.objectContaining({
        reportId: 'report-1',
        summary: 'Deliver first-aid kits',
        teamName: 'North volunteers',
        column: VolunteerBoardColumn.ASSIGNED,
      }),
    ]);
  });
});
