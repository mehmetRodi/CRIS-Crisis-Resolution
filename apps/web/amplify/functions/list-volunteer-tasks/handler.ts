import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { VolunteerTask } from '@crisismap/shared';
import type { FunctionResolverHandler } from '../appsync-event';
import { createVolunteerTaskReader } from './store';

const reader = createVolunteerTaskReader(
  {
    report: requireEnv('REPORT_TABLE_NAME'),
    assignment: requireEnv('ASSIGNMENT_TABLE_NAME'),
    team: requireEnv('TEAM_TABLE_NAME'),
  },
  DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  }),
);

/** AppSync authorizes the caller's Cognito group before invoking this resolver. */
export const handler: FunctionResolverHandler<Record<string, never>, VolunteerTask[]> = async () =>
  reader.list();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
