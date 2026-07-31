import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  ReportEventType,
  ReportStatus,
  SYSTEM_ACTOR,
  type ClassificationResult,
  type ScoreBreakdown,
  type TriageEntities,
} from '@crisismap/shared';

/**
 * Durable persistence for the classification worker.
 *
 * Per design doc §5.3 the worker writes to DynamoDB **directly** (keeping the
 * durable write independent of AppSync availability), and only *then* fans the
 * redacted update out through `publishReportUpdate` (a best-effort call in the
 * handler, CRIS-19) — so a publish failure never rolls back the durable write.
 * IAM for these table writes is granted in `backend.ts` via
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
  /** Submit timestamp — copied verbatim into the published projection (CRIS-19). */
  createdAt?: string | null;
  /** Operational region — the projection/subscription filter key (CRIS-19). */
  regionId?: string | null;
}

/** Resolved location, all optional — populated by the CRIS-21 geocoder. */
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

/** A neighbouring report considered as a possible duplicate (§5.4.3, CRIS-31). */
export interface DuplicateCandidateRecord {
  reportId: string;
  category: string;
  lat?: number | null;
  lng?: number | null;
  createdAt: string;
  text?: string | null;
  entities?: TriageEntities | null;
  duplicateGroupId?: string | null;
  version: number;
}

export interface FindDuplicateCandidatesInput {
  /** Partition key of the map-viewport GSI — the ~4.9 km cell to search. */
  geohashPrefix: string;
  /** The report being classified; excluded from its own candidate set. */
  excludeReportId: string;
  /** ISO-8601 lower bound on `createdAt` (the §5.4.3 recency window). */
  since: string;
}

export interface LinkDuplicateGroupInput {
  reportId: string;
  /** Version the row is expected to be at — dedup is a version-checked write like any other. */
  expectedVersion: number;
  duplicateGroupId: string;
  /** Audit detail: the score and components that justified the link. */
  detail: Record<string, unknown>;
}

export interface ReportStore {
  getReport(reportId: string): Promise<ReportRecord | null>;
  /** NEW → PROCESSING via a version conditional write. False = lost race / already claimed. */
  claimProcessing(reportId: string, expectedVersion: number): Promise<boolean>;
  persistClassification(input: PersistClassificationInput): Promise<void>;
  markNeedsVerification(input: MarkNeedsVerificationInput): Promise<void>;
  /** Recent, nearby reports to score for duplication (§5.4.3, CRIS-31). */
  findDuplicateCandidates(input: FindDuplicateCandidatesInput): Promise<DuplicateCandidateRecord[]>;
  /**
   * Points a report at a duplicate group and appends the DUPLICATE_LINKED audit
   * event. Version-checked; false means the row moved under us (skip, don't retry
   * — a later report will re-link it).
   */
  linkDuplicateGroup(input: LinkDuplicateGroupInput): Promise<boolean>;
}

export interface DynamoStoreTables {
  report: string;
  reportEvent: string;
  /**
   * Name of the `geohashPrefix`/`geohash` GSI (data/resource.ts index #4), used
   * to gather duplicate candidates. Injected rather than hardcoded: the physical
   * index name is Amplify's to choose, and a wrong guess is invisible to unit
   * tests (ADR-0011) — it only fails in a deployed environment.
   */
  geoIndex: string;
}

/**
 * Safety cap on candidates read from one geohash cell. The GSI sorts by geohash
 * (spatial), not time, so the recency window can only be applied after reading —
 * meaning a dense cell is read in full. The cap bounds worst-case cost; hitting
 * it is logged rather than silently truncating the candidate set.
 */
export const DUPLICATE_CANDIDATE_LIMIT = 100;

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
        createdAt: (Item.createdAt as string | undefined) ?? null,
        regionId: (Item.regionId as string | undefined) ?? null,
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
        'summary = :summary',
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
        // Short, PII-free AI summary (§2.2). The one classification field safe to
        // surface publicly; persisted so the projection carries it (CRIS-19).
        ':summary': classification.summary,
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
              summary: classification.summary,
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

    async findDuplicateCandidates(input) {
      // Queries the map-viewport GSI (data/resource.ts index #4). The sort key is
      // `geohash`, not time, so recency is a filter rather than a key condition —
      // `Limit` therefore bounds *items read*, and the caller logs when it binds.
      const { Items = [] } = await doc.send(
        new QueryCommand({
          TableName: tables.report,
          IndexName: tables.geoIndex,
          KeyConditionExpression: 'geohashPrefix = :prefix',
          FilterExpression: 'createdAt >= :since AND id <> :self',
          ExpressionAttributeValues: {
            ':prefix': input.geohashPrefix,
            ':since': input.since,
            ':self': input.excludeReportId,
          },
          Limit: DUPLICATE_CANDIDATE_LIMIT,
        }),
      );

      return Items.map((item) => ({
        reportId: item.id as string,
        category: (item.category as string) ?? '',
        lat: (item.lat as number | undefined) ?? null,
        lng: (item.lng as number | undefined) ?? null,
        createdAt: (item.createdAt as string | undefined) ?? '',
        text: (item.text as string | undefined) ?? null,
        entities: (item.entities as TriageEntities | undefined) ?? null,
        duplicateGroupId: (item.duplicateGroupId as string | undefined) ?? null,
        version: (item.version as number | undefined) ?? 0,
      }));
    },

    async linkDuplicateGroup(input) {
      const now = new Date().toISOString();
      const nextVersion = input.expectedVersion + 1;

      try {
        await doc.send(
          new UpdateCommand({
            TableName: tables.report,
            Key: { id: input.reportId },
            UpdateExpression: 'SET duplicateGroupId = :group, #v = :next',
            ConditionExpression: '#v = :expected',
            ExpressionAttributeNames: { '#v': 'version' },
            ExpressionAttributeValues: {
              ':group': input.duplicateGroupId,
              ':expected': input.expectedVersion,
              ':next': nextVersion,
            },
          }),
        );
      } catch (err) {
        // Lost race: the report changed between scoring and linking. Not an error
        // — grouping is advisory, and the next report into this cell re-evaluates.
        if (isConditionalCheckFailed(err)) return false;
        throw err;
      }

      // Immutable audit trail (§5.1): every grouping is explainable after the fact.
      await doc.send(
        new PutCommand({
          TableName: tables.reportEvent,
          Item: {
            id: randomUUID(),
            reportId: input.reportId,
            type: ReportEventType.DUPLICATE_LINKED,
            actorId: SYSTEM_ACTOR,
            version: nextVersion,
            detail: { duplicateGroupId: input.duplicateGroupId, ...input.detail },
            createdAt: now,
          },
        }),
      );
      return true;
    },
  };
}
