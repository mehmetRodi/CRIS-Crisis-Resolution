import { ScanCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  buildVolunteerTasks,
  type VolunteerAssignmentRecord,
  type VolunteerReportRecord,
  type VolunteerTask,
  type VolunteerTeamRecord,
} from '@crisismap/shared';

/** Matches the deliberately bounded MVP working set documented by ADR-0040/0042. */
export const VOLUNTEER_TASK_READ_LIMIT = 250;

export interface VolunteerTaskTableNames {
  report: string;
  assignment: string;
  team: string;
}

// These DynamoDB ProjectionExpressions are the server-side redaction boundary.
// Never add reporter identity/contact, raw text, media, notes, or exact location.
export const REPORT_PROJECTION =
  'id, #status, category, urgency, priorityScore, priorityBand, summary, regionId, assignedTeamId, createdAt';
export const ASSIGNMENT_PROJECTION = 'id, reportId, teamId, #status, createdAt';
export const TEAM_PROJECTION = 'id, #name, regionId';

export interface VolunteerTaskReader {
  list(): Promise<VolunteerTask[]>;
}

export function createVolunteerTaskReader(
  tables: VolunteerTaskTableNames,
  client: DynamoDBDocumentClient,
): VolunteerTaskReader {
  return {
    async list() {
      const [reports, assignments, teams] = await Promise.all([
        client.send(
          new ScanCommand({
            TableName: tables.report,
            Limit: VOLUNTEER_TASK_READ_LIMIT,
            ProjectionExpression: REPORT_PROJECTION,
            ExpressionAttributeNames: { '#status': 'status' },
          }),
        ),
        client.send(
          new ScanCommand({
            TableName: tables.assignment,
            Limit: VOLUNTEER_TASK_READ_LIMIT,
            ProjectionExpression: ASSIGNMENT_PROJECTION,
            ExpressionAttributeNames: { '#status': 'status' },
          }),
        ),
        client.send(
          new ScanCommand({
            TableName: tables.team,
            Limit: VOLUNTEER_TASK_READ_LIMIT,
            ProjectionExpression: TEAM_PROJECTION,
            ExpressionAttributeNames: { '#name': 'name' },
          }),
        ),
      ]);

      return buildVolunteerTasks(
        (reports.Items ?? []) as VolunteerReportRecord[],
        (assignments.Items ?? []) as VolunteerAssignmentRecord[],
        (teams.Items ?? []) as VolunteerTeamRecord[],
      );
    },
  };
}
