import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import {
  AlertDeliveryStatus,
  Category,
  Urgency,
  type AlertCandidate,
  type AlertChannel,
  type PriorityBand,
} from '@crisismap/shared';

/**
 * Durable persistence for the alert-dispatch worker (design doc §2.7, §5,
 * Fig 10; CRIS-34). Mirrors `classify-report/store.ts`'s shape: a typed
 * `AlertStore` interface backed by a lazily-constructed DynamoDB document
 * client, so importing this module in tests needs no AWS credentials.
 */

/** The subset of `AlertSubscription` fields the matcher/dispatcher needs. */
export interface AlertSubscriptionRecord {
  id: string;
  userId: string;
  categories: string[] | null;
  minUrgency: Urgency | null;
  channels: string[] | null;
  centerGeohash: string | null;
  radiusMeters: number | null;
  active: boolean | null;
}

export interface AlertDeliveryRecord {
  /** Deterministic: `${reportId}#${recipientId}#${channel}` (idempotency key). */
  id: string;
  reportId: string;
  recipientId: string;
  channel: AlertChannel;
  status: AlertDeliveryStatus;
  attempts: number;
  lastAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertStore {
  /** Reads only the PII-free report fields required for alert matching. */
  getAlertCandidate(reportId: string, priorityBand: PriorityBand): Promise<AlertCandidate | null>;
  /** Active subscriptions in a region — one of two independent candidate sets (§2.7). */
  queryActiveSubscriptions(regionId: string): Promise<AlertSubscriptionRecord[]>;
  /**
   * Subscriptions whose geofence center falls in this geohash prefix cell —
   * the other candidate set, for a subscription with no `regionId` (CRIS-34).
   * The caller merges both by `id` before matching.
   */
  queryActiveSubscriptionsByGeohashPrefix(
    geohashPrefix: string,
  ): Promise<AlertSubscriptionRecord[]>;
  /** Claims a new, failed, or expired delivery attempt; returns its attempt count. */
  claimDeliveryAttempt(input: {
    delivery: AlertDeliveryRecord;
    leaseExpiresBefore: string;
  }): Promise<number | null>;
  /** Records the outcome of a delivery attempt. */
  updateDeliveryStatus(input: {
    id: string;
    status: AlertDeliveryStatus;
    attempts: number;
    lastAttemptAt: string;
  }): Promise<void>;
}

export interface AlertStoreTables {
  report: string;
  alertSubscription: string;
  alertDelivery: string;
  /**
   * Physical name of the `AlertSubscription.regionId` GSI
   * (`data/resource.ts`'s `subscriptionsByRegion` query field). Injected
   * rather than hardcoded, following the same convention as
   * `REPORT_GEO_INDEX_NAME` (`backend.ts`) — the physical name the Amplify
   * transformer derives from field names is not the GraphQL `queryField`, and
   * a wrong guess is invisible to unit tests (ADR-0011); verify against the
   * deployed schema. Best-effort derivation: `alertSubscriptionsByRegionId`.
   */
  regionIndex: string;
  /**
   * Physical name of the `AlertSubscription.centerGeohashPrefix` GSI
   * (`subscriptionsByGeohashPrefix`). Same injection convention and caveat as
   * {@link AlertStoreTables.regionIndex}. Best-effort derivation:
   * `alertSubscriptionsByCenterGeohashPrefix`.
   */
  geohashPrefixIndex: string;
}

/** True when a DynamoDB error is a failed conditional (optimistic-lock) write. */
function isConditionalCheckFailed(err: unknown): boolean {
  return (err as { name?: string })?.name === 'ConditionalCheckFailedException';
}

function toSubscriptionRecord(item: Record<string, unknown>): AlertSubscriptionRecord {
  return {
    id: item.id as string,
    userId: item.userId as string,
    categories: (item.categories as string[] | undefined) ?? null,
    minUrgency: (item.minUrgency as Urgency | undefined) ?? null,
    channels: (item.channels as string[] | undefined) ?? null,
    centerGeohash: (item.centerGeohash as string | undefined) ?? null,
    radiusMeters: (item.radiusMeters as number | undefined) ?? null,
    active: (item.active as boolean | undefined) ?? null,
  };
}

async function queryAll(
  doc: DynamoDBDocumentClient,
  input: QueryCommandInput,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await doc.send(
      new QueryCommand({ ...input, ExclusiveStartKey: exclusiveStartKey }),
    );
    items.push(...((page.Items ?? []) as Record<string, unknown>[]));
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}

export function createDynamoAlertStore(
  tables: AlertStoreTables,
  client?: DynamoDBDocumentClient,
): AlertStore {
  const doc =
    client ??
    DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });

  return {
    async getAlertCandidate(reportId, priorityBand) {
      const { Item } = await doc.send(
        new GetCommand({
          TableName: tables.report,
          Key: { id: reportId },
          ProjectionExpression: '#id, category, urgency, regionId, lat, lng, geohashPrefix',
          ExpressionAttributeNames: { '#id': 'id' },
        }),
      );
      if (!Item) return null;
      return {
        reportId: Item.id as string,
        category: Object.values(Category).includes(Item.category as Category)
          ? (Item.category as Category)
          : null,
        urgency: Object.values(Urgency).includes(Item.urgency as Urgency)
          ? (Item.urgency as Urgency)
          : null,
        priorityBand,
        regionId: (Item.regionId as string | undefined) ?? null,
        lat: (Item.lat as number | undefined) ?? null,
        lng: (Item.lng as number | undefined) ?? null,
        geohashPrefix: (Item.geohashPrefix as string | undefined) ?? null,
      };
    },

    async queryActiveSubscriptions(regionId) {
      const items = await queryAll(doc, {
        TableName: tables.alertSubscription,
        IndexName: tables.regionIndex,
        KeyConditionExpression: 'regionId = :regionId',
        ExpressionAttributeValues: { ':regionId': regionId },
      });
      return items.map(toSubscriptionRecord);
    },

    async queryActiveSubscriptionsByGeohashPrefix(geohashPrefix) {
      const items = await queryAll(doc, {
        TableName: tables.alertSubscription,
        IndexName: tables.geohashPrefixIndex,
        KeyConditionExpression: 'centerGeohashPrefix = :prefix',
        ExpressionAttributeValues: { ':prefix': geohashPrefix },
      });
      return items.map(toSubscriptionRecord);
    },

    async claimDeliveryAttempt({ delivery, leaseExpiresBefore }) {
      try {
        const result = await doc.send(
          new UpdateCommand({
            TableName: tables.alertDelivery,
            Key: { id: delivery.id },
            UpdateExpression:
              'SET #reportId = if_not_exists(#reportId, :reportId), #recipientId = if_not_exists(#recipientId, :recipientId), #channel = if_not_exists(#channel, :channel), #createdAt = if_not_exists(#createdAt, :now), #s = :pending, #attempts = if_not_exists(#attempts, :zero) + :one, #lastAttemptAt = :now, #updatedAt = :now',
            ConditionExpression:
              'attribute_not_exists(id) OR #s = :failed OR (#s = :pending AND (attribute_not_exists(#lastAttemptAt) OR #lastAttemptAt < :leaseExpiresBefore))',
            ExpressionAttributeNames: {
              '#reportId': 'reportId',
              '#recipientId': 'recipientId',
              '#channel': 'channel',
              '#createdAt': 'createdAt',
              '#s': 'status',
              '#attempts': 'attempts',
              '#lastAttemptAt': 'lastAttemptAt',
              '#updatedAt': 'updatedAt',
            },
            ExpressionAttributeValues: {
              ':reportId': delivery.reportId,
              ':recipientId': delivery.recipientId,
              ':channel': delivery.channel,
              ':pending': AlertDeliveryStatus.PENDING,
              ':failed': AlertDeliveryStatus.FAILED,
              ':zero': 0,
              ':one': 1,
              ':now': delivery.updatedAt,
              ':leaseExpiresBefore': leaseExpiresBefore,
            },
            ReturnValues: 'ALL_NEW',
          }),
        );
        return (result.Attributes?.attempts as number | undefined) ?? 1;
      } catch (err) {
        if (isConditionalCheckFailed(err)) return null;
        throw err;
      }
    },

    async updateDeliveryStatus(input) {
      await doc.send(
        new UpdateCommand({
          TableName: tables.alertDelivery,
          Key: { id: input.id },
          UpdateExpression:
            'SET #s = :status, attempts = :attempts, lastAttemptAt = :now, updatedAt = :now',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: {
            ':status': input.status,
            ':attempts': input.attempts,
            ':now': input.lastAttemptAt,
          },
        }),
      );
    },
  };
}

/** Default status a newly created delivery record starts at. */
export const INITIAL_DELIVERY_STATUS: AlertDeliveryStatus = AlertDeliveryStatus.PENDING;
