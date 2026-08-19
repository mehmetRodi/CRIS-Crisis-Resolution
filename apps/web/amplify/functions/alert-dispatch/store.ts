import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { AlertDeliveryStatus, type AlertChannel, type Urgency } from '@crisismap/shared';

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
}

export interface AlertStore {
  /** Active subscriptions in a region — one of two independent candidate sets (§2.7). */
  queryActiveSubscriptions(regionId: string): Promise<AlertSubscriptionRecord[]>;
  /**
   * Subscriptions whose geofence center falls in this geohash prefix cell —
   * the other candidate set, for a subscription with no `regionId` (CRIS-34).
   * The caller merges both by `id` before matching.
   */
  queryActiveSubscriptionsByGeohashPrefix(geohashPrefix: string): Promise<AlertSubscriptionRecord[]>;
  /**
   * Conditionally creates the delivery record. Returns `false` (no write) when
   * one already exists at this id — the idempotency guard against an
   * at-least-once SQS redelivery double-dispatching the same alert.
   */
  putDeliveryIfAbsent(delivery: AlertDeliveryRecord): Promise<boolean>;
  /** Records the outcome of a delivery attempt. */
  updateDeliveryStatus(input: {
    id: string;
    status: AlertDeliveryStatus;
    attempts: number;
    lastAttemptAt: string;
  }): Promise<void>;
}

export interface AlertStoreTables {
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
    async queryActiveSubscriptions(regionId) {
      const { Items = [] } = await doc.send(
        new QueryCommand({
          TableName: tables.alertSubscription,
          IndexName: tables.regionIndex,
          KeyConditionExpression: 'regionId = :regionId',
          ExpressionAttributeValues: { ':regionId': regionId },
        }),
      );
      return Items.map(toSubscriptionRecord);
    },

    async queryActiveSubscriptionsByGeohashPrefix(geohashPrefix) {
      const { Items = [] } = await doc.send(
        new QueryCommand({
          TableName: tables.alertSubscription,
          IndexName: tables.geohashPrefixIndex,
          KeyConditionExpression: 'centerGeohashPrefix = :prefix',
          ExpressionAttributeValues: { ':prefix': geohashPrefix },
        }),
      );
      return Items.map(toSubscriptionRecord);
    },

    async putDeliveryIfAbsent(delivery) {
      try {
        await doc.send(
          new PutCommand({
            TableName: tables.alertDelivery,
            Item: delivery,
            ConditionExpression: 'attribute_not_exists(id)',
          }),
        );
        return true;
      } catch (err) {
        if (isConditionalCheckFailed(err)) return false;
        throw err;
      }
    },

    async updateDeliveryStatus(input) {
      await doc.send(
        new UpdateCommand({
          TableName: tables.alertDelivery,
          Key: { id: input.id },
          UpdateExpression: 'SET #s = :status, attempts = :attempts, lastAttemptAt = :now',
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
