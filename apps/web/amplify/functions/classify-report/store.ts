import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  ReportEventType,
  ReportStatus,
  SYSTEM_ACTOR,
  type ClassificationResult,
  type ScoreBreakdown,
} from '@crisismap/shared';

/**
 * Durable persistence for the classification worker.
 *
 * Per design doc §5.3 the worker writes to DynamoDB **directly** (keeping the
 * durable write independent of AppSync availability) and, separately, fans the
 * redacted update out to subscribers via the IAM-only `publishReportUpdate`
 * mutation — that notify step is owned by CRIS-19 and left as a seam in the
 * handler. IAM for these table writes is granted in `backend.ts` via
 * `grantReadWriteData`; table names arrive as environment variables. There is no
 * separate `PublicReport` projection table in the current schema (it is a
 * customType returned by `publishReportUpdate`), so the worker writes only the
 * `Report` and its audit `ReportEvent`. See ADR-0013.
 *
 * Every mutation is version-checked (optimistic lock, §5.1/§5.2): a claim only
 * succeeds from `NEW` at the expected version, and the result write only lands
 * if the row is still at the claimed version. A lost race is surfaced as a
 * boolean, not an exception.
 */

/** The subset of a Report the worker reads. */
export interface ReportRecord {
  id: string;
  version: number;
  status: string;
  text: string;
  lastProcessedEventId?: string | null;
}

/** Resolved location, all optional — populated by the CRIS-13 geocode seam. */
export interface LocationResult {
  lat?: number;
  lng?: number;
  geohash?: string;
  geohashPrefix?: string;
}

export interface PersistClassificationInput {
  reportId: string;
  /** Version the row is expected to be at (the post-claim version). */
  claimedVersion: number;
  /** Terminal status for this pass: AI_CLASSIFIED, or NEEDS_VERIFICATION on escalation (§2.6). */
  status: string;
  classification: ClassificationResult;
  priorityScore: number;
  priorityBand: string;
  scoreVersion: number;
  scoreBreakdown: ScoreBreakdown;
  location: LocationResult;
  streamEventId: string;
}

export interface MarkNeedsVerificationInput {
  reportId: string;
  claimedVersion: number;
  reason: string;
  streamEventId: string;
}

export interface ReportStore {
  getReport(reportId: string): Promise<ReportRecord | null>;
  /** NEW → PROCESSING via a version conditional write. False = lost race / already claimed. */
  claimProcessing(reportId: string, expectedVersion: number): Promise<boolean>;
  persistClassification(input: PersistClassificationInput): Promise<void>;
  markNeedsVerification(input: MarkNeedsVerificationInput): Promise<void>;
}

export interface DynamoStoreTables {
  report: string;
  reportEvent: string;
}

/** True when a DynamoDB error is a failed conditional (optimistic-lock) write. */
function isConditionalCheckFailed(err: unknown): boolean {
  return (err as { name?: string })?.name === 'ConditionalCheckFailedException';
}

/**
 * Real DynamoDB-backed {@link ReportStore}. The document client is built lazily
 * so importing this module in tests needs no AWS credentials. Undefined values
 * are stripped so the optional location fields can be omitted cleanly.
 */
export function createDynamoStore(
  tables: DynamoStoreTables,
  client?: DynamoDBDocumentClient,
): ReportStore {
  const doc =
    client ??
    DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });

  return {
    async getReport(reportId) {
      const { Item } = await doc.send(
        new GetCommand({ TableName: tables.report, Key: { id: reportId } }),
      );
      if (!Item) return null;
      return {
        id: Item.id as string,
        version: Item.version as number,
        status: Item.status as string,
        text: Item.text as string,
        lastProcessedEventId: (Item.lastProcessedEventId as string | undefined) ?? null,
      };
    },

    async claimProcessing(reportId, expectedVersion) {
      try {
        await doc.send(
          new UpdateCommand({
            TableName: tables.report,
            Key: { id: reportId },
            UpdateExpression: 'SET #s = :processing, #v = :next',
            ConditionExpression: '#v = :expected AND #s = :new',
            ExpressionAttributeNames: { '#s': 'status', '#v': 'version' },
            ExpressionAttributeValues: {
              ':processing': ReportStatus.PROCESSING,
              ':new': ReportStatus.NEW,
              ':expected': expectedVersion,
              ':next': expectedVersion + 1,
            },
          }),
        );
        return true;
      } catch (err) {
        if (isConditionalCheckFailed(err)) return false;
        throw err;
      }
    },

    async persistClassification(input) {
      const now = new Date().toISOString();
      const nextVersion = input.claimedVersion + 1;
      const { classification, location } = input;

      // 1. Conditional result write-back (still at the claimed version). Only
      //    the location fields that were resolved are written (§5.2).
      const sets = [
        '#s = :status',
        '#cat = :cat',
        'urgency = :urg',
        'confidence = :conf',
        'entities = :entities',
        'priorityScore = :score',
        'priorityBand = :band',
        'scoreVersion = :sv',
        'scoreBreakdown = :breakdown',
        'lastProcessedEventId = :eid',
        '#v = :next',
      ];
      const values: Record<string, unknown> = {
        ':status': input.status,
        ':cat': classification.category,
        ':urg': classification.urgency,
        ':conf': classification.confidence,
        // Extracted entities (§2.2, CRIS-20) — coordinator-internal, never in PublicReport.
        ':entities': classification.entities,
        ':score': input.priorityScore,
        ':band': input.priorityBand,
        ':sv': input.scoreVersion,
        ':breakdown': input.scoreBreakdown,
        ':eid': input.streamEventId,
        ':next': nextVersion,
        ':claimed': input.claimedVersion,
      };
      const optionalLocation: Record<string, number | string | undefined> = {
        lat: location.lat,
        lng: location.lng,
        geohash: location.geohash,
        geohashPrefix: location.geohashPrefix,
      };
      for (const [field, value] of Object.entries(optionalLocation)) {
        if (value !== undefined) {
          sets.push(`${field} = :${field}`);
          values[`:${field}`] = value;
        }
      }

      await doc.send(
        new UpdateCommand({
          TableName: tables.report,
          Key: { id: input.reportId },
          UpdateExpression: `SET ${sets.join(', ')}`,
          ConditionExpression: '#v = :claimed',
          ExpressionAttributeNames: { '#s': 'status', '#v': 'version', '#cat': 'category' },
          ExpressionAttributeValues: values,
        }),
      );

      // 2. Immutable audit event (§5.1). `eventId` (the stream event id) makes
      //    a retried append idempotent (§5.4.4).
      await doc.send(
        new PutCommand({
          TableName: tables.reportEvent,
          Item: {
            id: randomUUID(),
            reportId: input.reportId,
            type: ReportEventType.CLASSIFIED,
            fromStatus: ReportStatus.PROCESSING,
            toStatus: input.status,
            actorId: SYSTEM_ACTOR,
            version: nextVersion,
            eventId: input.streamEventId,
            detail: {
              category: classification.category,
              urgency: classification.urgency,
              confidence: classification.confidence,
              entities: classification.entities,
              priorityScore: input.priorityScore,
              priorityBand: input.priorityBand,
              needsHumanReview: classification.needsHumanReview,
            },
            createdAt: now,
          },
        }),
      );
    },

    async markNeedsVerification(input) {
      await doc.send(
        new UpdateCommand({
          TableName: tables.report,
          Key: { id: input.reportId },
          UpdateExpression: 'SET #s = :nv, lastProcessedEventId = :eid, #v = :next',
          ConditionExpression: '#v = :claimed',
          ExpressionAttributeNames: { '#s': 'status', '#v': 'version' },
          ExpressionAttributeValues: {
            ':nv': ReportStatus.NEEDS_VERIFICATION,
            ':eid': input.streamEventId,
            ':claimed': input.claimedVersion,
            ':next': input.claimedVersion + 1,
          },
        }),
      );
    },
  };
}
