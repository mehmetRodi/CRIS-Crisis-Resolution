import { defineFunction } from '@aws-amplify/backend';

/**
 * Unauthenticated read path for the public incident map (CRIS-54, ADR-0056).
 *
 * A Lambda resolver rather than a generated model read, because the public map
 * needs BOTH halves of the redaction enforced server-side: the field allow-list
 * (`toPublicReport`) and the status allow-list (`PUBLICLY_VISIBLE_STATUSES`).
 * A model-level rule can express neither, and any client-side filtering would
 * be advisory only — the raw rows would still cross the wire.
 */
export const listPublicReports = defineFunction({
  name: 'list-public-reports',
  entry: './handler.ts',
  timeoutSeconds: 10,
  memoryMB: 256,
  // The schema references this function and backend.ts grants it table reads.
  // Co-locating both directions avoids an Amplify nested-stack cycle (ADR-0031).
  resourceGroupName: 'data',
});
