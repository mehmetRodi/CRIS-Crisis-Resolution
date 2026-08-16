/**
 * IAM client for the internal `publishReportUpdate` mutation (CRIS-19/28).
 *
 * Direct DynamoDB writers call this only after their durable write commits, so
 * AppSync can fan a redacted `PublicReport` out to subscribers without becoming
 * part of the system-of-record transaction. Amplify injects the API endpoint,
 * model introspection location, and IAM authorization through schema-level
 * `allow.resource(...).to(['mutate'])` grants in `data/resource.ts`.
 */
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { PublicReport } from '@crisismap/shared';
import type { Schema } from '../../data/resource';

/** Fans a redacted report projection out to AppSync subscribers. */
export interface Publisher {
  publishUpdate(report: PublicReport): Promise<void>;
}

type DataClientEnv = Parameters<typeof getAmplifyDataClientConfig>[0];

let clientPromise: Promise<ReturnType<typeof generateClient<Schema>>> | undefined;

/** Configure Amplify + build the IAM-auth data client once per warm container. */
function getClient(): Promise<ReturnType<typeof generateClient<Schema>>> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(
        process.env as unknown as DataClientEnv,
      );
      Amplify.configure(resourceConfig, libraryOptions);
      return generateClient<Schema>();
    })();
  }
  return clientPromise;
}

/**
 * Calls `publishReportUpdate` over the caller function's IAM grant. The
 * argument list is exactly `PublicReport`, so PII cannot travel this channel.
 * GraphQL errors are thrown for the durable caller to log and swallow.
 */
export function createAppSyncPublisher(): Publisher {
  return {
    async publishUpdate(report) {
      const client = await getClient();
      const { errors } = await client.mutations.publishReportUpdate(
        {
          reportId: report.reportId,
          status: report.status,
          category: report.category,
          urgency: report.urgency,
          priorityScore: report.priorityScore,
          priorityBand: report.priorityBand,
          summary: report.summary,
          lat: report.lat,
          lng: report.lng,
          geohash: report.geohash,
          geohashPrefix: report.geohashPrefix,
          regionId: report.regionId,
          createdAt: report.createdAt,
          updatedAt: report.updatedAt,
        },
        { authMode: 'iam' },
      );
      if (errors && errors.length > 0) {
        throw new Error(errors.map((error) => error.message).join('; '));
      }
    },
  };
}
