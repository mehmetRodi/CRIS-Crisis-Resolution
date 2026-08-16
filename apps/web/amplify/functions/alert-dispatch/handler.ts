/**
 * alert-dispatch worker (design doc §2.7, §5, Fig 10; CRIS-34).
 *
 * Consumes the alert queue that `classify-report` enqueues P0/P1 AI_CLASSIFIED
 * reports onto. Matches each candidate against `AlertSubscription`s in its
 * region (`processCandidate` in `core.ts`) and delivers SMS (SNS)/EMAIL (SES)
 * to matched, active subscriptions — PUSH is declarable but not yet
 * delivered (no device-token infrastructure exists).
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
import { Category, PriorityBand, Urgency, type AlertCandidate } from '@crisismap/shared';
import { createDynamoAlertStore } from './store';
import { createAwsDeliverer } from './deliver';
import { processCandidate, type AlertDispatchDeps, type ContactInfo } from './core';

/** Parses the SQS body into a validated `AlertCandidate`, or null if malformed. */
export function parseMessage(body: string): AlertCandidate | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const { reportId, category, urgency, priorityBand, regionId, lat, lng } = raw as Record<
    string,
    unknown
  >;

  if (typeof reportId !== 'string') return null;
  if (!Object.values(PriorityBand).includes(priorityBand as PriorityBand)) return null;

  return {
    reportId,
    category: Object.values(Category).includes(category as Category)
      ? (category as Category)
      : null,
    urgency: Object.values(Urgency).includes(urgency as Urgency) ? (urgency as Urgency) : null,
    priorityBand: priorityBand as PriorityBand,
    regionId: typeof regionId === 'string' ? regionId : null,
    lat: typeof lat === 'number' ? lat : null,
    lng: typeof lng === 'number' ? lng : null,
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function buildDeps(): AlertDispatchDeps {
  const store = createDynamoAlertStore(
    {
      alertSubscription: requireEnv('ALERT_SUBSCRIPTION_TABLE_NAME'),
      alertDelivery: requireEnv('ALERT_DELIVERY_TABLE_NAME'),
      regionIndex: requireEnv('ALERT_SUBSCRIPTION_REGION_INDEX_NAME'),
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
        new AdminGetUserCommand({ UserPoolId: userPoolId, Username: userId }),
      );
      const attr = (name: string) =>
        UserAttributes?.find((a) => a.Name === name)?.Value ?? null;
      return { email: attr('email'), phoneNumber: attr('phone_number') };
    } catch {
      return null;
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
      const candidate = parseMessage(record.body);
      if (!candidate) throw new Error('unparseable message');
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
