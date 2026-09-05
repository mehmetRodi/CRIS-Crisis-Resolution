import type { AppSyncIdentityCognito, AppSyncResolverEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { ulid } from 'ulid';
import {
  canClaimReport,
  canCoordinateWork,
  highestRole,
  isWorkReadOnly,
  ReportEventType,
  UserRole,
  WorkAction,
  type RedactableReport,
  type ReportStatus,
  type ReportWorkView,
} from '@crisismap/shared';
import { buildWorkUpdate, type WorkActor, type WorkRecord } from './core';
import {
  hasExpectedErrorCode,
  withResolverErrorMetrics,
  ResolverOperation,
} from '../resolver-metrics';
import { publishAssignmentUpdate } from '../assign-team/publish';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const cognito = new CognitoIdentityProviderClient({});
function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
interface Args {
  reportId?: string;
  action?: string;
  expectedVersion?: number;
  note?: string | null;
  targetUsername?: string | null;
}
function actorOf(event: AppSyncResolverEvent<Args>): WorkActor {
  const identity = event.identity as AppSyncIdentityCognito | undefined;
  const role = highestRole(identity?.groups ?? []);
  if (!identity?.sub || !role || role === UserRole.CITIZEN)
    throw new Error('FORBIDDEN: An operational account is required.');
  const name = identity.claims?.name;
  return {
    id: identity.sub,
    role,
    label:
      typeof name === 'string' && name.trim()
        ? name.trim().slice(0, 100)
        : `${role === UserRole.VOLUNTEER ? 'Volunteer' : 'Team member'} ${identity.sub.slice(0, 8)}`,
  };
}
function view(record: WorkRecord, status: ReportStatus, actor: WorkActor): ReportWorkView {
  const isMine = record.assigneeId === actor.id;
  const mayRead = isMine || canCoordinateWork(actor.role);
  return {
    reportId: record.id,
    version: record.version,
    assigneeLabel: record.assigneeLabel ?? null,
    isMine,
    canClaim: !record.assigneeId && canClaimReport(status),
    canEdit: mayRead && !isWorkReadOnly(status),
    updates: mayRead ? record.updates : [],
  };
}
async function targetPerson(username: string) {
  if (!username.trim() || username.length > 256)
    throw new Error('VALIDATION: Enter the person’s sign-in email.');
  try {
    const person = await cognito.send(
      new AdminGetUserCommand({ UserPoolId: env('USER_POOL_ID'), Username: username.trim() }),
    );
    const groups = await cognito.send(
      new AdminListGroupsForUserCommand({
        UserPoolId: env('USER_POOL_ID'),
        Username: person.Username!,
      }),
    );
    const eligible = groups.Groups?.some(
      (group) => group.GroupName === UserRole.VOLUNTEER || group.GroupName === UserRole.RESPONDER,
    );
    const id = person.UserAttributes?.find((attribute) => attribute.Name === 'sub')?.Value;
    if (!person.Enabled || !eligible || !id)
      throw new Error('VALIDATION: Choose an enabled volunteer or responder account.');
    return {
      id,
      label:
        person.UserAttributes?.find((attribute) => attribute.Name === 'name')?.Value?.slice(
          0,
          100,
        ) || `Team member ${id.slice(0, 8)}`,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'UserNotFoundException')
      throw new Error('NOT_FOUND: No eligible account was found.');
    throw error;
  }
}
async function resolve(event: AppSyncResolverEvent<Args>): Promise<ReportWorkView | string[]> {
  const actor = actorOf(event);
  const workTable = env('REPORT_WORK_TABLE_NAME');
  if (event.info.fieldName === 'listMyReportWork') {
    const ids: string[] = [];
    let key: Record<string, unknown> | undefined;
    // Bounded MVP read, explicit failure instead of silently incomplete "my tasks".
    for (let page = 0; page < 20; page++) {
      const result = await db.send(
        new ScanCommand({
          TableName: workTable,
          Limit: 250,
          ConsistentRead: true,
          ProjectionExpression: 'id',
          FilterExpression: 'assigneeId = :actor',
          ExpressionAttributeValues: { ':actor': actor.id },
          ExclusiveStartKey: key,
        }),
      );
      for (const item of result.Items ?? []) ids.push(item.id as string);
      key = result.LastEvaluatedKey;
      if (!key) return ids;
    }
    throw new Error('UNAVAILABLE: Your task list could not be fully loaded. Please try again.');
  }
  if (!event.arguments.reportId || event.arguments.reportId.length > 200)
    throw new Error('VALIDATION: A report ID is required.');
  const reportId = event.arguments.reportId;
  const reportTable = env('REPORT_TABLE_NAME');
  const [reportResult, workResult] = await Promise.all([
    db.send(
      new GetCommand({
        TableName: reportTable,
        Key: { id: reportId },
        ConsistentRead: true,
        ProjectionExpression: 'id, #status, #version',
        ExpressionAttributeNames: { '#status': 'status', '#version': 'version' },
      }),
    ),
    db.send(new GetCommand({ TableName: workTable, Key: { id: reportId }, ConsistentRead: true })),
  ]);
  const report = reportResult.Item;
  if (!report || report.status === 'REJECTED')
    throw new Error('NOT_FOUND: This report is unavailable.');
  const now = new Date().toISOString();
  const current: WorkRecord = workResult.Item
    ? ({
        id: reportId,
        version: Number(workResult.Item.version),
        assigneeId: workResult.Item.assigneeId as string | undefined,
        assigneeLabel: workResult.Item.assigneeLabel as string | undefined,
        createdAt: workResult.Item.createdAt as string,
        updatedAt: workResult.Item.updatedAt as string,
        updates: JSON.parse((workResult.Item.updatesJson as string) || '[]'),
      } as WorkRecord)
    : { id: reportId, version: 0, updates: [], createdAt: now, updatedAt: now };
  const status = report.status as ReportStatus;
  if (event.info.fieldName === 'getReportWork') return view(current, status, actor);
  if (event.info.fieldName !== 'updateReportWork')
    throw new Error('VALIDATION: Unknown operation.');
  const action = event.arguments.action as WorkAction;
  if (action === WorkAction.ASSIGN && !canCoordinateWork(actor.role))
    throw new Error('FORBIDDEN: Only coordinators can assign a person.');
  const target =
    action === WorkAction.ASSIGN
      ? await targetPerson(event.arguments.targetUsername ?? '')
      : undefined;
  const eventId = ulid();
  const next = buildWorkUpdate(
    current,
    status,
    actor,
    {
      action,
      expectedVersion: event.arguments.expectedVersion!,
      note: event.arguments.note,
      target,
    },
    { now, eventId },
  );
  const { updates, ...fields } = next;
  const workItem = { ...fields, updatesJson: JSON.stringify(updates) };
  // Never preserve fields parsed from a prior storage record outside the allow-list.
  delete (workItem as Record<string, unknown>).updates;
  const reportVersion = Number(report.version);
  if (!Number.isInteger(reportVersion))
    throw new Error('CONFLICT: This report has no valid version.');
  try {
    await db.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: reportTable,
              Key: { id: reportId },
              UpdateExpression: 'SET #version = :next, updatedAt = :now',
              ConditionExpression: '#version = :expected AND #status = :status',
              ExpressionAttributeNames: { '#version': 'version', '#status': 'status' },
              ExpressionAttributeValues: {
                ':expected': reportVersion,
                ':next': reportVersion + 1,
                ':now': now,
                ':status': status,
              },
            },
          },
          {
            Put: {
              TableName: workTable,
              Item: workItem,
              ConditionExpression:
                current.version === 0 ? 'attribute_not_exists(id)' : '#version = :expected',
              ...(current.version === 0
                ? {}
                : {
                    ExpressionAttributeNames: { '#version': 'version' },
                    ExpressionAttributeValues: { ':expected': current.version },
                  }),
            },
          },
          {
            Put: {
              TableName: env('REPORT_EVENT_TABLE_NAME'),
              Item: {
                id: eventId,
                reportId,
                eventId,
                type: ReportEventType.WORK_UPDATED,
                actorId: actor.id,
                actorRole: actor.role,
                version: reportVersion + 1,
                detail: {
                  action,
                  workVersion: next.version,
                  ...(action === WorkAction.NOTE ? { note: event.arguments.note!.trim() } : {}),
                  ...(next.assigneeId ? { assigneeId: next.assigneeId } : {}),
                },
                createdAt: now,
                updatedAt: now,
              },
              ConditionExpression: 'attribute_not_exists(id)',
            },
          },
        ],
      }),
    );
  } catch (error) {
    if (
      error instanceof Error &&
      ['TransactionCanceledException', 'ConditionalCheckFailedException'].includes(error.name)
    )
      throw new Error('CONFLICT: This report changed. Refresh before trying again.');
    throw error;
  }
  // Read the full record only after commit for the existing redacted publisher.
  // Never send the work notes or assignee identity through public subscriptions.
  try {
    const updated = await db.send(
      new GetCommand({ TableName: reportTable, Key: { id: reportId }, ConsistentRead: true }),
    );
    if (updated.Item) await publishAssignmentUpdate(updated.Item as unknown as RedactableReport);
  } catch {
    /* Commit succeeded; the next refresh reconciles a missed publish. */
  }
  return view(next, status, actor);
}
export const handler = withResolverErrorMetrics(
  ResolverOperation.REPORT_WORK,
  (error) =>
    hasExpectedErrorCode(error, ['FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'ILLEGAL', 'VALIDATION']),
  resolve,
);
