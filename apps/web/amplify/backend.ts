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
import { classifyReport } from './functions/classify-report/resource';

/**
 * CrisisMap AI backend (Amplify Gen 2).
 *
 * Managed resources (auth/data/storage) are wired by `defineBackend`. The custom
 * asynchronous AI-triage pipeline from the design doc (§3, §5.4) is added below
 * via CDK escape hatches (ADR-0003, ADR-0007):
 *
 *   Report DynamoDB stream → EventBridge Pipe → SQS (+DLQ) → classify-report Lambda
 *
 * The worker classifies (Bedrock), scores, geocodes, dedupes, and writes results
 * back durably (direct-to-DynamoDB, §5.3), then — once CRIS-9 lands — notifies
 * subscribers via the IAM-only `publishReportUpdate` mutation. SNS proximity
 * alerts remain deferred.
 *
 * Nothing here is deployed by the scaffold. Run `npx ampx sandbox` from
 * `apps/web` (with AWS credentials + Bedrock model access) to stand up a
 * personal dev environment. NOTE: enabling the stream changes the table's
 * custom-resource update path — deploy on a fresh sandbox first (ADR-0007).
 */
const backend = defineBackend({
  auth,
  data,
  storage,
  classifyReport,
});

const worker = backend.classifyReport.resources.lambda;
const tables = backend.data.resources.tables;
const cfnTables = backend.data.resources.cfnResources.amplifyDynamoDbTables;

/* -------------------------------------------------------------------------- */
/* Table mutations — enable the stream + TTL BEFORE building the pipe          */
/* (the pipe source is the stream ARN, which only exists once the stream is on) */
/* -------------------------------------------------------------------------- */

// Amplify models are `Custom::AmplifyDynamoDBTable`; stream/TTL are set on the
// wrapper (keyed by model name), not on the L2 ITable (ADR-0007).
cfnTables['Report'].streamSpecification = {
  streamViewType: StreamViewType.NEW_AND_OLD_IMAGES,
};
cfnTables['IdempotencyRecord'].timeToLiveAttribute = {
  enabled: true,
  attributeName: 'expiresAt', // a.timestamp() = epoch seconds, as TTL requires
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
    // Ship ONLY IDs + trace metadata to SQS — no PII (rawText/reporter*) ever
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

// Durable direct-to-DynamoDB writes (§5.3): read+write Report, write the
// projection + audit events.
reportTable.grantReadWriteData(worker);
tables['PublicReport'].grantWriteData(worker);
tables['ReportEvent'].grantWriteData(worker);

// Bedrock — scoped to the Claude foundation-model family in this region (no
// cross-provider access). Kept a family wildcard so switching BEDROCK_MODEL_ID
// across Claude tiers needs no IAM change (ADR-0007).
worker.addToRolePolicy(
  new PolicyStatement({
    actions: ['bedrock:InvokeModel'],
    resources: [`arn:aws:bedrock:${backend.stack.region}::foundation-model/anthropic.claude-*`],
  }),
);

// Table names the worker resolves at runtime (no secrets/PII).
backend.classifyReport.addEnvironment('REPORT_TABLE_NAME', reportTable.tableName);
backend.classifyReport.addEnvironment('PUBLIC_REPORT_TABLE_NAME', tables['PublicReport'].tableName);
backend.classifyReport.addEnvironment('REPORT_EVENT_TABLE_NAME', tables['ReportEvent'].tableName);
