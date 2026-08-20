import { defineFunction } from '@aws-amplify/backend';

/**
 * `alert-dispatch` worker (CRIS-34, design doc §2.7, §5, Fig 10).
 *
 * Consumes the alert queue, matches candidates against `AlertSubscription`s,
 * and delivers SMS (SNS)/EMAIL (SES). Table names, queue wiring, and IAM
 * grants are set in `backend.ts` (tables/queue don't exist until the data
 * schema and queue are synthesized).
 */
export const alertDispatch = defineFunction({
  name: 'alert-dispatch',
  entry: './handler.ts',
  timeoutSeconds: 30,
  memoryMB: 256,
  // Data resolver + table grants in backend.ts → assign to the data stack to
  // avoid a nested-stack circular dependency (Amplify Gen 2 prescribed fix).
  resourceGroupName: 'data',
});
