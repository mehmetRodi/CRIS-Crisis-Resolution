import { defineFunction } from '@aws-amplify/backend';

/**
 * `updateReportStatus` resolver function (CRIS-18, design doc §5.1, §5.3).
 *
 * Drives every human report-lifecycle transition with a role check, an
 * optimistic-lock conditional write, and an appended audit event. Table names
 * and IAM grants are wired in `backend.ts`.
 */
export const transitionReport = defineFunction({
  name: 'transition-report',
  entry: './handler.ts',
  timeoutSeconds: 10,
  memoryMB: 256,
});
