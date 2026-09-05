import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { PublicReport } from '@crisismap/shared';

import type { FunctionResolverHandler } from '../appsync-event';
import { PUBLIC_REPORT_READ_LIMIT, createPublicReportReader } from './store';

/**
 * `listPublicReports` — the unauthenticated incident read (CRIS-54, ADR-0056).
 *
 * Invoked for guests as well as signed-in users, so it must assume NO trusted
 * identity. It logs nothing about the caller and returns nothing that is not on
 * the `PublicReport` allow-list; see `store.ts` for the layered redaction.
 */
const reader = createPublicReportReader(
  requireEnv('REPORT_TABLE_NAME'),
  DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  }),
);

export const handler: FunctionResolverHandler<{ limit?: number | null }, PublicReport[]> = async (
  event,
) => reader.list(event.arguments?.limit ?? PUBLIC_REPORT_READ_LIMIT);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
