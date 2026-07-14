import { defineBackend } from '@aws-amplify/backend';
import { Duration } from 'aws-cdk-lib';
import { StreamViewType } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { CfnPipe } from 'aws-cdk-lib/aws-pipes';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { submitReport } from './functions/submit-report/resource';
import { transitionReport } from './functions/transition-report/resource';
import { publishReportUpdate } from './functions/publish-report-update/resource';
import { classifyReport } from './functions/classify-report/resource';
import { addObservability } from './observability';

/**
 * CrisisMap AI backend (Amplify Gen 2).
 *
 * Wires the managed auth/data/storage resources, the custom resolvers that back
 * the E2 API surface (CRIS-9/18/19), and the custom asynchronous AI-triage
 * pipeline from the design doc (§3, §5.4), added via CDK escape hatches
 * (ADR-0003, ADR-0013):
 *
 *   Report DynamoDB stream → EventBridge Pipe → SQS (+DLQ) → classify-report Lambda
 *
 * Table names and IAM grants for the resolver/worker functions are set here
 * rather than in each function's `resource.ts`, because the DynamoDB tables
 * don't exist until the data schema is synthesized. The worker classifies
 * (Bedrock), scores, and writes results back durably (direct-to-DynamoDB, §5.3);
 * fanning the redacted update out to subscribers via `publishReportUpdate`
 * (CRIS-19) and SNS proximity alerts remain deferred seams.
 *
 * Nothing here is deployed by the scaffold. Run `npx ampx sandbox` from
 * `apps/web` (with AWS credentials + Bedrock model access) to stand up a
 * personal dev environment. NOTE: enabling the stream changes the table's
 * custom-resource update path — deploy on a fresh sandbox first (ADR-0013).
 */
const backend = defineBackend({
  auth,
  data,
  storage,
  submitReport,
  transitionReport,
  publishReportUpdate,
  classifyReport,
});

const tables = backend.data.resources.tables;

/* -------------------------------------------------------------------------- */
/* submitReport (CRIS-9) — grant table access + inject table names            */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* classify-report pipeline (CRIS-10) — Streams → Pipe → SQS → Lambda          */
/* -------------------------------------------------------------------------- */

const worker = backend.classifyReport.resources.lambda;
const cfnTables = backend.data.resources.cfnResources.amplifyDynamoDbTables;

/* -------------------------------------------------------------------------- */
/* Table mutations — enable the stream + TTL BEFORE building the pipe          */
/* (the pipe source is the stream ARN, which only exists once the stream is on) */
/* -------------------------------------------------------------------------- */

// Amplify models are `Custom::AmplifyDynamoDBTable`; stream/TTL are set on the
// wrapper (keyed by model name), not on the L2 ITable (ADR-0013).
cfnTables['Report'].streamSpecification = {
  streamViewType: StreamViewType.NEW_AND_OLD_IMAGES,
};
cfnTables['IdempotencyRecord'].timeToLiveAttribute = {
  enabled: true,
  attributeName: 'expiresAt', // a.integer() = epoch seconds, as TTL requires
};

/* -------------------------------------------------------------------------- */
/* Pipeline stack — isolated from Amplify's managed nested stacks              */
/* -------------------------------------------------------------------------- */

const pipelineStack = backend.createStack('pipeline');

// Standard queues (reports are independent; idempotency is enforced in-app).
const classificationDlq = new Queue(pipelineStack, 'ClassificationDlq', {
  retentionPeriod: Duration.days(14),
});
const classificationQueue = new Queue(pipelineStack, 'ClassificationQueue', {
  // visibilityTimeout must be ≥ the Lambda timeout; 6× (360s) absorbs retries.
  visibilityTimeout: Duration.seconds(360),
  deadLetterQueue: { queue: classificationDlq, maxReceiveCount: 3 },
});

/* -------------------------------------------------------------------------- */
/* EventBridge Pipe: Report stream → classification queue                      */
/* -------------------------------------------------------------------------- */

const reportTable = tables['Report'];
const streamArn = reportTable.tableStreamArn;
if (!streamArn) {
  throw new Error('Report table stream ARN is undefined — stream not enabled?');
}

const pipeRole = new Role(pipelineStack, 'StreamToSqsPipeRole', {
  assumedBy: new ServicePrincipal('pipes.amazonaws.com'),
});
reportTable.grantStreamRead(pipeRole);
classificationQueue.grantSendMessages(pipeRole);

new CfnPipe(pipelineStack, 'ReportStreamToClassificationQueue', {
  roleArn: pipeRole.roleArn,
  source: streamArn,
  target: classificationQueue.queueArn,
  sourceParameters: {
    dynamoDbStreamParameters: {
      startingPosition: 'LATEST', // don't replay historical NEW reports on deploy
      batchSize: 10,
      maximumBatchingWindowInSeconds: 1,
    },
    // Only INSERTs of reports that still need classification. `pattern` is a
    // JSON string (L1 CfnPipe quirk).
    filterCriteria: {
      filters: [
        {
          pattern: JSON.stringify({
            eventName: ['INSERT'],
            dynamodb: { NewImage: { status: { S: ['NEW'] } } },
          }),
        },
      ],
    },
  },
  targetParameters: {
    // Ship ONLY IDs + trace metadata to SQS — no PII (text/reporter*) ever
    // leaves the table into the queue (§5.6). The worker re-reads the full item
    // from DynamoDB under IAM.
    inputTemplate: JSON.stringify({
      reportId: '<$.dynamodb.Keys.id.S>',
      version: '<$.dynamodb.NewImage.version.N>',
      streamEventId: '<$.eventID>',
    }),
  },
});

/* -------------------------------------------------------------------------- */
/* Lambda wiring — SQS event source, IAM, environment                          */
/* -------------------------------------------------------------------------- */

worker.addEventSource(
  new SqsEventSource(classificationQueue, {
    batchSize: 5,
    maxBatchingWindow: Duration.seconds(5),
    reportBatchItemFailures: true, // pairs with the handler's SQSBatchResponse
  }),
);

// SQS consume (receive/delete/getAttributes).
classificationQueue.grantConsumeMessages(worker);

// Durable direct-to-DynamoDB writes (§5.3): read+write Report, append audit
// events. The redacted public projection is fanned out via publishReportUpdate
// (CRIS-19), not written to a table here.
reportTable.grantReadWriteData(worker);
tables['ReportEvent'].grantWriteData(worker);

// Bedrock — scoped to the Claude family, no cross-provider access. Current
// Claude tiers (Opus 4.8 / Sonnet 5 / Haiku 4.5) are invoked through a
// cross-Region *inference profile* (`eu.anthropic.claude-*`), not a bare
// in-Region model id, so the grant needs BOTH (ADR-0017):
//   1. the inference-profile ARN in this account/Region (what the API call
//      names), and
//   2. the underlying foundation-model ARNs in every EU destination Region the
//      profile can route to (`eu-*`) — an in-Region-only grant throws
//      AccessDenied the moment the profile fans out.
// The `claude-*` wildcard keeps BEDROCK_MODEL_ID swappable across tiers with no
// IAM change; `eu-*` keeps it within the EU geography (data residency, §5.6).
worker.addToRolePolicy(
  new PolicyStatement({
    actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
    resources: [
      `arn:aws:bedrock:${backend.stack.region}:${backend.stack.account}:inference-profile/eu.anthropic.claude-*`,
      'arn:aws:bedrock:eu-*::foundation-model/anthropic.claude-*',
    ],
  }),
);

// Table names the worker resolves at runtime (no secrets/PII).
backend.classifyReport.addEnvironment('REPORT_TABLE_NAME', reportTable.tableName);
backend.classifyReport.addEnvironment('REPORT_EVENT_TABLE_NAME', tables['ReportEvent'].tableName);

/* -------------------------------------------------------------------------- */
/* Observability (CRIS-15, ADR-0015) — X-Ray tracing + CloudWatch alarms       */
/* -------------------------------------------------------------------------- */

// X-Ray active tracing across AppSync → Lambda → downstream calls (design doc
// §3.1). The managed `defineFunction`/`data` constructs don't expose a tracing
// prop, so it's set via CDK escape hatches; enabling it manually means we must
// also grant the X-Ray write actions (an L2 `tracing: ACTIVE` would do both).
const tracedFunctions = [
  backend.submitReport,
  backend.transitionReport,
  backend.publishReportUpdate,
  backend.classifyReport,
];
for (const fn of tracedFunctions) {
  fn.resources.cfnResources.cfnFunction.tracingConfig = { mode: 'Active' };
  fn.resources.lambda.addToRolePolicy(
    new PolicyStatement({
      actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
      resources: ['*'], // X-Ray write actions don't support resource-level scoping.
    }),
  );
}
backend.data.resources.cfnResources.cfnGraphqlApi.xrayEnabled = true;

// Alarms + dashboard + ops SNS topic live in the pipeline stack (same stack as
// the queues they watch, so the SQS alarms need no cross-stack export). Returns
// the topic; an alert endpoint is subscribed post-deploy (docs/runbooks/deploy.md).
addObservability({
  scope: pipelineStack,
  functions: {
    submitReport: submitFn,
    transitionReport: transitionFn,
    publishReportUpdate: backend.publishReportUpdate.resources.lambda,
    classifyReport: worker,
  },
  classificationQueue,
  classificationDlq,
});
