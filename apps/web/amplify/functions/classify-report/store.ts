import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ReportEventType, ReportStatus, type ClassificationResult } from '@crisismap/shared';

/**
 * Durable persistence for the classification worker.
 *
 * Per design doc §5.3 the worker writes to DynamoDB **directly** (keeping the
 * durable write independent of AppSync availability) and, separately, calls the
 * IAM-only `publishReportUpdate` mutation to fan out to subscribers — that
 * notify step is owned by CRIS-9 and left as a seam in the handler. IAM for
 * these table writes is granted in `backend.ts` via `grantReadWriteData`; table
 * names arrive as environment variables. See ADR-0007.
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
  rawText: string;
  lastProcessedEventId?: string | null;
}

export interface LocationResult {
  latitude?: number;
  longitude?: number;
  geohash?: string;
  geohashPrefix?: string;
  locationPrecision: string;
}

export interface PersistClassificationInput {
  reportId: string;
  /** Version the row is expected to be at (the post-claim version). */
  claimedVersion: number;
  classification: ClassificationResult;
  priorityScore: number;
  priorityBand: string;
  scoreVersion: number;
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
  publicReport: string;
  reportEvent: string;
}

/** True when a DynamoDB error is a failed conditional (optimistic-lock) write. */
function isConditionalCheckFailed(err: unknown): boolean {
  return (err as { name?: string })?.name === 'ConditionalCheckFailedException';
}

/**
 * Real DynamoDB-backed {@link ReportStore}. The document client is built lazily
 * so importing this module in tests needs no AWS credentials.
 */
export function createDynamoStore(
  tables: DynamoStoreTables,
  client?: DynamoDBDocumentClient,
): ReportStore {
  const doc = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));

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
        rawText: Item.rawText as string,
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
      const { classification, location } = input;

      // 1. Conditional result write-back (still at the claimed version).
      await doc.send(
        new UpdateCommand({
          TableName: tables.report,
          Key: { id: input.reportId },
          UpdateExpression: [
            'SET #s = :classified',
            '#cat = :cat',
            'urgency = :urg',
            'classificationConfidence = :conf',
            'priorityScore = :score',
            'priorityBand = :band',
            'scoreVersion = :sv',
            'locationPrecision = :lp',
            'statusUpdatedAt = :now',
            'lastProcessedEventId = :eid',
            '#v = :next',
          ].join(', '),
          ConditionExpression: '#v = :claimed',
          ExpressionAttributeNames: { '#s': 'status', '#v': 'version', '#cat': 'category' },
          ExpressionAttributeValues: {
            ':classified': ReportStatus.AI_CLASSIFIED,
            ':cat': classification.category,
            ':urg': classification.urgency,
            ':conf': classification.confidence,
            ':score': input.priorityScore,
            ':band': input.priorityBand,
            ':sv': input.scoreVersion,
            ':lp': location.locationPrecision,
            ':now': now,
            ':eid': input.streamEventId,
            ':claimed': input.claimedVersion,
            ':next': input.claimedVersion + 1,
          },
        }),
      );

      // 2. Immutable audit event (§5.1).
      await doc.send(
        new PutCommand({
          TableName: tables.reportEvent,
          Item: {
            id: randomUUID(),
            reportId: input.reportId,
            eventType: ReportEventType.CLASSIFIED,
            fromStatus: ReportStatus.PROCESSING,
            toStatus: ReportStatus.AI_CLASSIFIED,
            payload: {
              category: classification.category,
              urgency: classification.urgency,
              confidence: classification.confidence,
              priorityScore: input.priorityScore,
              priorityBand: input.priorityBand,
            },
            occurredAt: now,
          },
        }),
      );

      // 3. Redacted public projection mirror (§5.3, §5.6 — non-sensitive only).
      await doc.send(
        new PutCommand({
          TableName: tables.publicReport,
          Item: {
            id: input.reportId,
            category: classification.category,
            urgency: classification.urgency,
            priorityScore: input.priorityScore,
            priorityBand: input.priorityBand,
            status: ReportStatus.AI_CLASSIFIED,
            latitude: location.latitude,
            longitude: location.longitude,
            geohash: location.geohash,
            geohashPrefix: location.geohashPrefix,
          },
        }),
      );
    },

    async markNeedsVerification(input) {
      const now = new Date().toISOString();
      await doc.send(
        new UpdateCommand({
          TableName: tables.report,
          Key: { id: input.reportId },
          UpdateExpression:
            'SET #s = :nv, statusUpdatedAt = :now, lastProcessedEventId = :eid, #v = :next',
          ConditionExpression: '#v = :claimed',
          ExpressionAttributeNames: { '#s': 'status', '#v': 'version' },
          ExpressionAttributeValues: {
            ':nv': ReportStatus.NEEDS_VERIFICATION,
            ':now': now,
            ':eid': input.streamEventId,
            ':claimed': input.claimedVersion,
            ':next': input.claimedVersion + 1,
          },
        }),
      );
    },
  };
}
