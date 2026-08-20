/**
 * alert-dispatch worker (design doc §2.7, §5, Fig 10; CRIS-34).
 *
 * Consumes P0/P1 threshold-crossing report IDs projected from the durable
 * Report stream. It re-reads only the PII-free candidate fields, matches them
 * against `AlertSubscription`s, and delivers SMS (SNS)/EMAIL (SES) — PUSH is
 * declarable but not yet delivered (no device-token infrastructure exists).
 *
 * Same SQS entry-point shape as `classify-report/handler.ts`: `parseMessage`
 * + a per-record loop reporting partial-batch failures, so one poison/failed
 * record doesn't fail the whole batch.
 */
import type { SQSHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { ALERT_TRIGGER_BANDS, PriorityBand } from '@crisismap/shared';
import { createDynamoAlertStore } from './store';
import { createAwsDeliverer } from './deliver';
import { processCandidate, type AlertDispatchDeps, type ContactInfo } from './core';

export interface AlertMessage {
  reportId: string;
  priorityBand: PriorityBand;
}

/** Parses the PII-free stream projection, or returns null if malformed. */
export function parseMessage(body: string): AlertMessage | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const { reportId, priorityBand } = raw as Record<string, unknown>;

  if (typeof reportId !== 'string' || reportId.length === 0) return null;
  if (!ALERT_TRIGGER_BANDS.includes(priorityBand as PriorityBand)) return null;

  return { reportId, priorityBand: priorityBand as PriorityBand };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function buildDeps(): AlertDispatchDeps {
  const store = createDynamoAlertStore(
    {
      report: requireEnv('REPORT_TABLE_NAME'),
      alertSubscription: requireEnv('ALERT_SUBSCRIPTION_TABLE_NAME'),
      alertDelivery: requireEnv('ALERT_DELIVERY_TABLE_NAME'),
      regionIndex: requireEnv('ALERT_SUBSCRIPTION_REGION_INDEX_NAME'),
      geohashPrefixIndex: requireEnv('ALERT_SUBSCRIPTION_GEOHASH_PREFIX_INDEX_NAME'),
    },
    DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    }),
  );
  const deliver = createAwsDeliverer({ fromEmailAddress: requireEnv('ALERT_FROM_EMAIL') });
  const userPoolId = requireEnv('USER_POOL_ID');
  const cognito = new CognitoIdentityProviderClient({});

  // Recipient contact info lives on the Cognito user, not the subscription
  // (avoids a denormalized, staleness-prone copy — see the CRIS-34 ADR).
  const lookupContact = async (userId: string): Promise<ContactInfo | null> => {
    try {
      const { UserAttributes } = await cognito.send(
        new AdminGetUserCommand({
          UserPoolId: userPoolId,
          Username: userId,
        }),
      );
      const attr = (name: string) => UserAttributes?.find((a) => a.Name === name)?.Value ?? null;
      return { email: attr('email'), phoneNumber: attr('phone_number') };
    } catch (err) {
      if ((err as { name?: string })?.name === 'UserNotFoundException') return null;
      throw err;
    }
  };

  return { store, deliver, lookupContact };
}

/**
 * SQS entry point. Returns partial-batch failures so one poison/failed
 * record doesn't fail the whole batch (paired with `reportBatchItemFailures:
 * true` on the event-source mapping).
 */
export const handler: SQSHandler = async (event) => {
  const deps = buildDeps();
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      const message = parseMessage(record.body);
      if (!message) throw new Error('unparseable message');
      const candidate = await deps.store.getAlertCandidate(message.reportId, message.priorityBand);
      if (!candidate) {
        console.log(
          JSON.stringify({ event: 'alert.skip.reportMissing', reportId: message.reportId }),
        );
        continue;
      }
      await processCandidate(deps, candidate);
    } catch (err) {
      console.log(
        JSON.stringify({
          event: 'alert.record.error',
          messageId: record.messageId,
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
