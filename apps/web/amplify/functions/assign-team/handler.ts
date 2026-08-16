/**
 * assignTeam resolver (design doc §5.1) — CRIS-32.
 *
 * Mirrors `transition-report/handler.ts`: loads the report (and the team, to
 * reject a bogus/deleted `teamId` up front), validates the assignment
 * (legality + optimistic lock) via the pure `core.ts`, then atomically applies
 * the version-checked `Report.assignedTeamId` update, creates a new
 * `Assignment` record, and appends the immutable `ASSIGNED` audit event. A
 * stale `expectedVersion` surfaces as a machine-readable `CONFLICT` (§5.3).
 *
 * The mutation itself is COORDINATOR/ADMIN-only at the schema level
 * (`data/resource.ts`), so unlike `updateReportStatus` there is no per-actor
 * authority matrix to check here — AppSync rejects any other caller before
 * this handler ever runs.
 */
import type { AppSyncIdentityCognito, AppSyncResolverHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { highestRole, type ReportStatus, type TransitionActor } from '@crisismap/shared';
import {
  AssignmentIllegalError,
  buildAssignmentPlan,
  VersionConflictError,
  type CurrentReport,
} from './core';

const REPORT_TABLE = requireEnv('REPORT_TABLE_NAME');
const ASSIGNMENT_TABLE = requireEnv('ASSIGNMENT_TABLE_NAME');
const TEAM_TABLE = requireEnv('TEAM_TABLE_NAME');
const REPORT_EVENT_TABLE = requireEnv('REPORT_EVENT_TABLE_NAME');

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

interface AssignTeamArgs {
  reportId: string;
  teamId: string;
  expectedVersion: number;
  note?: string | null;
}

export const handler: AppSyncResolverHandler<AssignTeamArgs, Record<string, unknown>> = async (
  event,
) => {
  const identity = event.identity as AppSyncIdentityCognito | undefined;
  const actorRole: TransitionActor | null = highestRole(identity?.groups ?? undefined);
  if (!actorRole) {
    throw new Error('FORBIDDEN: caller has no role permitted to assign a team.');
  }
  const actorId = identity?.sub ?? 'UNKNOWN';

  const [existingReport, existingTeam] = await Promise.all([
    docClient.send(
      new GetCommand({ TableName: REPORT_TABLE, Key: { id: event.arguments.reportId } }),
    ),
    docClient.send(new GetCommand({ TableName: TEAM_TABLE, Key: { id: event.arguments.teamId } })),
  ]);
  if (!existingReport.Item) {
    throw new Error(`NOT_FOUND: report ${event.arguments.reportId} does not exist.`);
  }
  if (!existingTeam.Item) {
    throw new Error(`NOT_FOUND: team ${event.arguments.teamId} does not exist.`);
  }
  const current: CurrentReport = {
    id: existingReport.Item.id as string,
    status: existingReport.Item.status as ReportStatus,
    version: existingReport.Item.version as number,
  };

  let plan;
  try {
    plan = buildAssignmentPlan(
      current,
      {
        teamId: event.arguments.teamId,
        expectedVersion: event.arguments.expectedVersion,
        actorId,
        actorRole,
        note: event.arguments.note,
      },
      { eventId: ulid(), assignmentId: ulid(), now: new Date().toISOString() },
    );
  } catch (err) {
    throw mapDomainError(err);
  }

  try {
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: REPORT_TABLE,
              Key: { id: plan.update.id },
              UpdateExpression:
                'SET #assignedTeamId = :teamId, #version = :next, #updatedAt = :now',
              ConditionExpression: '#version = :expected',
              ExpressionAttributeNames: {
                '#assignedTeamId': 'assignedTeamId',
                '#version': 'version',
                '#updatedAt': 'updatedAt',
              },
              ExpressionAttributeValues: {
                ':teamId': plan.update.teamId,
                ':next': plan.update.nextVersion,
                ':now': plan.update.updatedAt,
                ':expected': plan.update.expectedVersion,
              },
            },
          },
          {
            Put: {
              TableName: ASSIGNMENT_TABLE,
              Item: plan.assignment,
              ConditionExpression: 'attribute_not_exists(id)',
            },
          },
          {
            Put: {
              TableName: REPORT_EVENT_TABLE,
              Item: plan.event,
              ConditionExpression: 'attribute_not_exists(id)',
            },
          },
        ],
      }),
    );
  } catch (err) {
    // A concurrent writer moved the version between our read and write.
    if (isConditionalFailure(err)) {
      throw new Error('CONFLICT: report was modified concurrently; refetch and retry.');
    }
    throw err;
  }

  return {
    ...existingReport.Item,
    assignedTeamId: plan.update.teamId,
    version: plan.update.nextVersion,
    updatedAt: plan.update.updatedAt,
  };
};

function mapDomainError(err: unknown): Error {
  if (err instanceof VersionConflictError) {
    return new Error('CONFLICT: report was modified concurrently; refetch and retry.');
  }
  if (err instanceof AssignmentIllegalError) {
    return new Error(`ILLEGAL: ${err.message}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

function isConditionalFailure(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('name' in err)) return false;
  const name = (err as { name: string }).name;
  return name === 'TransactionCanceledException' || name === 'ConditionalCheckFailedException';
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
