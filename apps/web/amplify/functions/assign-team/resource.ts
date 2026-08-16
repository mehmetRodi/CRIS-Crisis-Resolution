import { defineFunction } from '@aws-amplify/backend';

/**
 * `assignTeam` resolver function (CRIS-32, design doc §5.1).
 *
 * Assigns a response team to a report with an optimistic-lock conditional
 * write, a new `Assignment` record, and an appended `ASSIGNED` audit event.
 * Table names and IAM grants are wired in `backend.ts`.
 */
export const assignTeam = defineFunction({
  name: 'assign-team',
  entry: './handler.ts',
  timeoutSeconds: 10,
  memoryMB: 256,
  // Data resolver + table grants in backend.ts → assign to the data stack to
  // avoid a nested-stack circular dependency (Amplify Gen 2 prescribed fix).
  resourceGroupName: 'data',
});
