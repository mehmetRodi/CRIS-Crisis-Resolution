import { defineFunction } from '@aws-amplify/backend';

/**
 * `publishReportUpdate` resolver function (CRIS-19, design doc §5.3).
 *
 * A stateless passthrough that turns the triage worker's call into an AppSync
 * mutation so subscriptions fire. The worker uses `allow.resource`; the
 * operation's required client-facing rule is limited to `ADMIN` (ADR-0030).
 * No table access — it never touches DynamoDB.
 */
export const publishReportUpdate = defineFunction({
  name: 'publish-report-update',
  entry: './handler.ts',
  timeoutSeconds: 10,
  memoryMB: 128,
  // AppSync data resolver → keep in the data stack alongside the other
  // resolvers (Amplify Gen 2 prescribed fix for nested-stack cycles).
  resourceGroupName: 'data',
});
