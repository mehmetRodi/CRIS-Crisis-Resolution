/**
 * Real-time fan-out for the triage worker (design doc §5.3; CRIS-19, ADR-0009/0029).
 *
 * After the worker writes a classification result durably to DynamoDB, it calls
 * the internal `publishReportUpdate` AppSync mutation so subscribers get the
 * redacted update in near real time. AppSync subscriptions fire on *mutations*,
 * not on raw DynamoDB writes — hence this extra hop.
 *
 * WHY the Amplify data client (not hand-rolled SigV4): letting a backend
 * function call an operation over IAM auth is exactly what schema-level
 * `allow.resource(classifyReport)` is for (see data/resource.ts). That grant is
 * the *only* supported way to permit the worker's role on the field, and it
 * pairs with `getAmplifyDataClientConfig` + `generateClient`, which read the
 * endpoint/introspection env vars Amplify injects alongside the grant. A manual
 * SigV4 POST would still need `allow.resource` for the field auth, then reinvent
 * the endpoint/credential wiring — so it buys nothing.
 *
 * `getAmplifyDataClientConfig` is fed `process.env` directly (cast to its env
 * shape) rather than the generated `$amplify/env/classify-report` module, so a
 * plain `tsc`/CI typecheck needs no Amplify codegen — matching how the other
 * functions read `process.env` (ADR-0029). The config is memoized so the S3
 * model-introspection fetch happens once per warm container, not per report.
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

/** Configure Amplify + build the IAM-auth data client once per container. */
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
 * The real publisher. Calls `publishReportUpdate` with IAM auth. The argument
 * list is exactly the public fields (`PublicReport`), so PII cannot travel this
 * channel by construction (§5.6). GraphQL-level errors are thrown so the caller
 * can log them; the caller treats publishing as best-effort (the durable write
 * already succeeded).
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
        throw new Error(errors.map((e) => e.message).join('; '));
      }
    },
  };
}
