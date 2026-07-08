import { defineFunction } from '@aws-amplify/backend';

/**
 * `submitReport` resolver function (CRIS-9, design doc §5.3).
 *
 * The fast, durable write path. Table names are injected as environment
 * variables and write access is granted in `backend.ts` (the data tables don't
 * exist until the schema is synthesized, so the wiring can't live here).
 */
export const submitReport = defineFunction({
  name: 'submit-report',
  entry: './handler.ts',
  // Fast ack path (§3.2 target p95 < 800 ms); fail fast rather than hang.
  timeoutSeconds: 10,
  memoryMB: 256,
});
