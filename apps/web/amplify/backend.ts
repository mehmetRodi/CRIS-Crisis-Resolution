import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { submitReport } from './functions/submit-report/resource';
import { transitionReport } from './functions/transition-report/resource';
import { publishReportUpdate } from './functions/publish-report-update/resource';

/**
 * CrisisMap AI backend (Amplify Gen 2).
 *
 * Wires the managed auth/data/storage resources plus the custom resolvers that
 * back the E2 API surface (CRIS-9/18/19). Table names and IAM grants for those
 * functions are set here rather than in each function's `resource.ts`, because
 * the DynamoDB tables don't exist until the data schema is synthesized.
 *
 * The custom asynchronous pipeline from the design doc (§3, §5.4) — DynamoDB
 * Streams → SQS → Lambda classification workers → Bedrock → SNS alerts — is
 * still NOT defined here; it is added via CDK escape hatches under CRIS-10.
 *
 * Nothing here is deployed by the scaffold. Run `npx ampx sandbox` from
 * `apps/web` (with AWS credentials configured) to stand up a personal dev
 * environment. See docs/architecture.md and ADR 0003.
 */
const backend = defineBackend({
  auth,
  data,
  storage,
  submitReport,
  transitionReport,
  publishReportUpdate,
});

/* -------------------------------------------------------------------------- */
/* submitReport (CRIS-9) — grant table access + inject table names            */
/* -------------------------------------------------------------------------- */

const tables = backend.data.resources.tables;
const submitFn = backend.submitReport.resources.lambda;

// The resolver writes the report + its opening audit event and reads back the
// existing report on an idempotent replay.
tables['Report'].grantReadWriteData(submitFn);
tables['ReportEvent'].grantWriteData(submitFn);
tables['IdempotencyRecord'].grantReadWriteData(submitFn);

backend.submitReport.addEnvironment('REPORT_TABLE_NAME', tables['Report'].tableName);
backend.submitReport.addEnvironment('REPORT_EVENT_TABLE_NAME', tables['ReportEvent'].tableName);
backend.submitReport.addEnvironment(
  'IDEMPOTENCY_TABLE_NAME',
  tables['IdempotencyRecord'].tableName,
);

/* -------------------------------------------------------------------------- */
/* updateReportStatus (CRIS-18) — grant table access + inject table names     */
/* -------------------------------------------------------------------------- */

const transitionFn = backend.transitionReport.resources.lambda;

// Reads the current report, applies the version-checked update, appends the
// audit event.
tables['Report'].grantReadWriteData(transitionFn);
tables['ReportEvent'].grantWriteData(transitionFn);

backend.transitionReport.addEnvironment('REPORT_TABLE_NAME', tables['Report'].tableName);
backend.transitionReport.addEnvironment('REPORT_EVENT_TABLE_NAME', tables['ReportEvent'].tableName);
