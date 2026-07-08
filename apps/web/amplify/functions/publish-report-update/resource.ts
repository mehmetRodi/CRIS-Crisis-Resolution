import { defineFunction } from '@aws-amplify/backend';

/**
 * `publishReportUpdate` resolver function (CRIS-19, design doc §5.3).
 *
 * A stateless passthrough that turns an internal call into an AppSync mutation
 * so subscriptions fire. No table access — it never touches DynamoDB.
 */
export const publishReportUpdate = defineFunction({
  name: 'publish-report-update',
  entry: './handler.ts',
  timeoutSeconds: 10,
  memoryMB: 128,
});
