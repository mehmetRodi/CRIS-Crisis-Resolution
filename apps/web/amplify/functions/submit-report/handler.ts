/**
 * submitReport resolver (design doc §3, §5.3, §5.4.4) — CRIS-9.
 *
 * Durably persists a new citizen/field report as `NEW` and returns it
 * immediately (target p95 < 800 ms); AI classification runs later off the
 * DynamoDB stream. The idempotency guard, the report, and its opening audit
 * event are written in a single DynamoDB transaction so a retried
 * `clientRequestId` can never create a duplicate report.
 *
 * All business logic lives in `core.ts` (unit-tested); this file is the thin
 * AWS adapter. Table names are injected as env vars by `backend.ts`.
 */
import { randomUUID } from 'node:crypto';
import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import {
  buildSubmitPlan,
  forDynamoItem,
  SubmitValidationError,
  type ReportRecord,
  type SubmitReportInput,
} from './core';
import type { FunctionResolverEvent, FunctionResolverHandler } from '../appsync-event';
import { ResolverOperation, withResolverErrorMetrics } from '../resolver-metrics';

const REPORT_TABLE = requireEnv('REPORT_TABLE_NAME');
const REPORT_EVENT_TABLE = requireEnv('REPORT_EVENT_TABLE_NAME');
const IDEMPOTENCY_TABLE = requireEnv('IDEMPOTENCY_TABLE_NAME');

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/** GraphQL arguments (identity is resolved server-side, never from the client). */
type SubmitReportArgs = Omit<SubmitReportInput, 'reporterId'>;

async function resolveSubmitReport(
  event: FunctionResolverEvent<SubmitReportArgs>,
): Promise<ReportRecord> {
  const reporterId = cognitoSub(event.identity);
  const input: SubmitReportInput = { ...event.arguments, reporterId };

  const plan = buildSubmitPlan(input, {
    reportId: ulid(),
    eventId: ulid(),
    now: new Date().toISOString(),
  });

  try {
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: IDEMPOTENCY_TABLE,
              Item: forDynamoItem(plan.idempotency),
              ConditionExpression: 'attribute_not_exists(idempotencyKey)',
            },
          },
          {
            Put: {
              TableName: REPORT_TABLE,
              Item: forDynamoItem(plan.report),
              ConditionExpression: 'attribute_not_exists(id)',
            },
          },
          {
            Put: {
              TableName: REPORT_EVENT_TABLE,
              Item: forDynamoItem(plan.event),
              ConditionExpression: 'attribute_not_exists(id)',
            },
          },
        ],
        // Correlate the transaction's writes in logs without echoing PII.
        ClientRequestToken: safeToken(input.clientRequestId),
      }),
    );
    return plan.report;
  } catch (err) {
    if (isIdempotentReplay(err)) {
      const existing = await loadExistingReport(plan.idempotency.idempotencyKey);
      if (existing) return existing;
    }
    throw err;
  }
}

export const handler: FunctionResolverHandler<SubmitReportArgs, ReportRecord> =
  withResolverErrorMetrics(
    ResolverOperation.SUBMIT_REPORT,
    (error) => error instanceof SubmitValidationError,
    resolveSubmitReport,
  );

/**
 * A retried submission (same `clientRequestId`) surfaces one of two ways:
 *   - `TransactionCanceledException` — the `attribute_not_exists` idempotency
 *     guard rejected the duplicate write (the general case, and the only case
 *     once DynamoDB's transaction idempotency window has elapsed);
 *   - `IdempotentParameterMismatchException` — within that window, the reused
 *     `ClientRequestToken` (= clientRequestId) clashes with the freshly
 *     generated reportId/timestamps of this invocation.
 * Both mean "this request was already processed" → return the original report.
 */
function isIdempotentReplay(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('name' in err)) return false;
  const name = (err as { name: string }).name;
  return name === 'TransactionCanceledException' || name === 'IdempotentParameterMismatchException';
}

/** Resolve the report a prior submission with this key already created. */
async function loadExistingReport(idempotencyKey: string): Promise<ReportRecord | null> {
  // The IdempotencyRecord table's primary key is `id`, which is set to the client
  // request id (== idempotencyKey) at write time — so look it up by `id`, not by
  // the (GSI-only) `idempotencyKey` attribute.
  const record = await docClient.send(
    new GetCommand({ TableName: IDEMPOTENCY_TABLE, Key: { id: idempotencyKey } }),
  );
  const reportId = record.Item?.reportId as string | undefined;
  if (!reportId) return null;
  const report = await docClient.send(
    new GetCommand({ TableName: REPORT_TABLE, Key: { id: reportId } }),
  );
  return (report.Item as ReportRecord | undefined) ?? null;
}

function cognitoSub(identity: unknown): string | null {
  if (identity && typeof identity === 'object' && 'sub' in identity) {
    return (identity as AppSyncIdentityCognito).sub ?? null;
  }
  return null;
}

/** DynamoDB requires the token be ≤ 36 chars; hash-free fallback to a UUID. */
function safeToken(clientRequestId: string): string {
  return clientRequestId.length <= 36 ? clientRequestId : randomUUID();
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
