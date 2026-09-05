import { defineFunction } from '@aws-amplify/backend';
export const reportWork = defineFunction({
  name: 'report-work',
  entry: './handler.ts',
  timeoutSeconds: 20,
  memoryMB: 256,
  resourceGroupName: 'data',
});
