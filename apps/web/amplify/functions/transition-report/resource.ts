import { defineFunction } from '@aws-amplify/backend';

/**
 * `updateReportStatus` resolver function (CRIS-18, design doc §5.1, §5.3).
 *
 * Drives every human report-lifecycle transition with a role check, an
 * optimistic-lock conditional write, and an appended audit event. After commit,
 * it publishes a redacted update to CRIS-28 subscribers through its schema-level
 * IAM grant. Table names and DynamoDB grants are wired in `backend.ts`.
 */
export const transitionReport = defineFunction({
  name: 'transition-report',
  entry: './handler.ts',
  // Includes headroom for the post-commit AppSync publish client initialization.
  timeoutSeconds: 20,
  memoryMB: 256,
  // Data resolver + table grants in backend.ts → assign to the data stack to
  // avoid a nested-stack circular dependency (Amplify Gen 2 prescribed fix).
  resourceGroupName: 'data',
});
