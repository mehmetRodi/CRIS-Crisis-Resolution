import { defineFunction } from '@aws-amplify/backend';

/** Server-enforced redacted read path for the CRIS-33 volunteer task board. */
export const listVolunteerTasks = defineFunction({
  name: 'list-volunteer-tasks',
  entry: './handler.ts',
  timeoutSeconds: 10,
  memoryMB: 256,
  // The schema references this function and backend.ts grants it table reads.
  // Co-locating both directions avoids an Amplify nested-stack cycle.
  resourceGroupName: 'data',
});
