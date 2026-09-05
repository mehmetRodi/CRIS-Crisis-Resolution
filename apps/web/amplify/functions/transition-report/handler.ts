/**
 * updateReportStatus resolver (design doc §5.1, §5.3) — CRIS-18.
 *
 * The single guarded engine behind every human-driven report state change. It
 * loads the report, validates the transition (legality + role + optimistic
 * lock) via the pure `core.ts`, then atomically applies the version-checked
 * update and appends the immutable `STATUS_CHANGED` audit event. A stale
 * `expectedVersion` surfaces as a machine-readable `CONFLICT` (§5.3).
 *
 * This is human-only: the pipeline's NEW→PROCESSING and classification
 * transitions run on the internal (IAM) path, not through this mutation.
 */
import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { highestRole, type ReportStatus, type TransitionActor } from '@crisismap/shared';
import {
  buildTransitionPlan,
  IllegalTransitionError,
  TransitionForbiddenError,
  VersionConflictError,
  type CurrentReport,
} from './core';
import type { FunctionResolverEvent, FunctionResolverHandler } from '../appsync-event';
import { publishTransitionUpdate } from './publish';
import {
  ResolverOperation,
  hasExpectedErrorCode,
  withResolverErrorMetrics,
} from '../resolver-metrics';

const REPORT_TABLE = requireEnv('REPORT_TABLE_NAME');
const REPORT_EVENT_TABLE = requireEnv('REPORT_EVENT_TABLE_NAME');

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

interface UpdateReportStatusArgs {
  reportId: string;
  toStatus: ReportStatus;
  expectedVersion: number;
  note?: string | null;
}

async function resolveReportTransition(
  event: FunctionResolverEvent<UpdateReportStatusArgs>,
): Promise<Record<string, unknown>> {
  const identity = event.identity as AppSyncIdentityCognito | undefined;
  const actorRole: TransitionActor | null = highestRole(identity?.groups ?? undefined);
  if (!actorRole) {
    throw new Error('FORBIDDEN: caller has no role permitted to change report status.');
  }
  const actorId = identity?.sub ?? 'UNKNOWN';

  const existing = await docClient.send(
    new GetCommand({ TableName: REPORT_TABLE, Key: { id: event.arguments.reportId } }),
  );
  if (!existing.Item) {
    throw new Error(`NOT_FOUND: report ${event.arguments.reportId} does not exist.`);
  }
  const current: CurrentReport = {
    id: existing.Item.id as string,
    status: existing.Item.status as ReportStatus,
    version: existing.Item.version as number,
  };

  let plan;
  try {
    plan = buildTransitionPlan(
      current,
      {
        toStatus: event.arguments.toStatus,
        expectedVersion: event.arguments.expectedVersion,
        actorId,
        actorRole,
        note: event.arguments.note,
      },
      { eventId: ulid(), now: new Date().toISOString() },
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
              UpdateExpression: 'SET #status = :to, #version = :next, #updatedAt = :now',
              ConditionExpression: '#version = :expected',
              ExpressionAttributeNames: {
                '#status': 'status',
                '#version': 'version',
                '#updatedAt': 'updatedAt',
              },
              ExpressionAttributeValues: {
                ':to': plan.update.toStatus,
                ':next': plan.update.nextVersion,
                ':now': plan.update.updatedAt,
                ':expected': plan.update.expectedVersion,
              },
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

  const updated = {
    ...existing.Item,
    status: plan.update.toStatus,
    version: plan.update.nextVersion,
    updatedAt: plan.update.updatedAt,
  };

  // The report + audit event are already durable. Fan the redacted projection
  // out best-effort so other operational clients converge without making their
  // availability part of the transition transaction (CRIS-28, ADR-0048).
  await publishTransitionUpdate({
    ...updated,
    id: current.id,
    status: plan.update.toStatus,
  });

  return updated;
}

export const handler: FunctionResolverHandler<
  UpdateReportStatusArgs,
  Record<string, unknown>
> = withResolverErrorMetrics(
  ResolverOperation.UPDATE_REPORT_STATUS,
  (error) =>
    hasExpectedErrorCode(error, ['FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'ILLEGAL_TRANSITION']),
  resolveReportTransition,
);

function mapDomainError(err: unknown): Error {
  if (err instanceof VersionConflictError) {
    return new Error('CONFLICT: report was modified concurrently; refetch and retry.');
  }
  if (err instanceof TransitionForbiddenError) {
    return new Error(`FORBIDDEN: ${err.message}`);
  }
  if (err instanceof IllegalTransitionError) {
    return new Error(`ILLEGAL_TRANSITION: ${err.message}`);
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
