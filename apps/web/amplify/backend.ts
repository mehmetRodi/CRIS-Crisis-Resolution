import { defineBackend } from '@aws-amplify/backend';
import { Duration, Stack } from 'aws-cdk-lib';
import { StreamViewType } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { CfnPipe } from 'aws-cdk-lib/aws-pipes';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { PASSWORD_MIN_LENGTH } from '@crisismap/shared';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { submitReport } from './functions/submit-report/resource';
import { transitionReport } from './functions/transition-report/resource';
import { publishReportUpdate } from './functions/publish-report-update/resource';
import { classifyReport } from './functions/classify-report/resource';
import { createMediaUploadUrl } from './functions/create-media-upload-url/resource';
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
 * (Bedrock), scores, writes results back durably (direct-to-DynamoDB, §5.3),
 * and then fans the redacted update out via the internal `publishReportUpdate`
 * mutation (CRIS-19). That last grant is NOT wired here: the schema's
 * `allow.resource(classifyReport)` (data/resource.ts) attaches the
 * `appsync:GraphQL` policy and injects the endpoint/introspection env vars onto
 * the worker's role automatically. That grant is a `data → function` edge, and
 * the Report-stream pipe below is a `function → data` edge — opposing edges that
 * form a nested-stack cycle unless the worker lives in the data stack. So
 * `classify-report` is pinned to the `data` group (`resourceGroupName: 'data'`,
 * ADR-0031); every edge here is then intra-`data`-stack. Custom subscriptions
 * (CRIS-28) and SNS proximity alerts remain deferred seams.
 *
 * Run `npx ampx sandbox` from `apps/web` (with AWS credentials + Bedrock model
 * access) to stand up a personal dev environment. Source control does not
 * establish whether a shared environment is active. NOTE: enabling the stream changes the table's
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
  createMediaUploadUrl,
});

/* -------------------------------------------------------------------------- */
/* auth (CRIS-7, ADR-0024) — pin the User Pool password policy                */
/* -------------------------------------------------------------------------- */

// `defineAuth` has no password-policy option, so set it via the CDK escape
// hatch (ADR-0003). Keep it exactly in step with the client-side rule in
// `@crisismap/shared` (`isPasswordValid` / `PASSWORD_MIN_LENGTH`) so a password
// the sign-up form accepts is never rejected only by Cognito. Symbols are not
// required — matching the shared rule (upper + lower + number, min length).
backend.auth.resources.cfnResources.cfnUserPool.policies = {
  passwordPolicy: {
    minimumLength: PASSWORD_MIN_LENGTH,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSymbols: false,
  },
};

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
/* createMediaUploadUrl (CRIS-17) — grant S3 write + inject bucket name       */
/* -------------------------------------------------------------------------- */

const mediaUploadFn = backend.createMediaUploadUrl.resources.lambda;

// The presigned POST is signed with a DEDICATED role's temporary credentials,
// not the Lambda's own execution-role credentials. A Lambda's ambient
// execution-role session carries a long STS session token (often several KB),
// and combined with the presigned POST's policy document, that pushes the
// multipart request's "fields" section (everything before the photo data)
// past S3's fixed, non-configurable 20 KB cap — the exact
// `MaxPostPreDataLengthExceeded` error this role exists to avoid. A fresh
// `AssumeRole` against a role with no other trust relationships or session
// tags produces a materially shorter token that fits comfortably under that
// cap. This role has no other purpose: it exists solely to be assumed for
// signing, so it carries no permissions beyond the S3 write itself.
const mediaUploadPresignRole = new Role(Stack.of(mediaUploadFn), 'MediaUploadPresignRole', {
  assumedBy: mediaUploadFn.grantPrincipal,
});
backend.storage.resources.bucket.grantWrite(mediaUploadPresignRole, 'reports/*');
mediaUploadPresignRole.grantAssumeRole(mediaUploadFn.grantPrincipal);

backend.createMediaUploadUrl.addEnvironment(
  'MEDIA_BUCKET_NAME',
  backend.storage.resources.bucket.bucketName,
);
backend.createMediaUploadUrl.addEnvironment(
  'MEDIA_UPLOAD_PRESIGN_ROLE_ARN',
  mediaUploadPresignRole.roleArn,
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
/* Pipeline resources — co-located in the worker's (function) nested stack     */
/* -------------------------------------------------------------------------- */

// The queues, pipe, and observability alarms all reference the classify worker
// (event source + consume grant + metric alarms). A separate `createStack`
// would make that nested stack and the worker's stack reference each other,
// which CloudFormation rejects as a circular dependency. AWS's fix is to create
// these resources in the SAME stack as the Lambda they wire to, so every
// reference is intra-stack. The worker itself is pinned to the `data` stack
// (`resourceGroupName: 'data'`, ADR-0031) because the CRIS-19 `allow.resource`
// grant is a data→function edge that would otherwise close a cycle against the
// pipe's function→data read of the Report stream. With the worker in the data
// stack, `Stack.of(worker)` IS the data stack, so the pipe reads the stream and
// the queues/alarms reference the worker all intra-stack — no cross-stack edge
// remains. https://docs.amplify.aws/react/build-a-backend/troubleshooting/circular-dependency/
const pipelineStack = Stack.of(worker);

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

// Failure sink for the Stream→SQS hop (CRIS-31). `classificationDlq` covers only
// SQS→Lambda; without this, a record that repeatedly fails to reach the queue is
// retried until the 24 h stream retention expires, and because DynamoDB streams
// are ordered per shard it head-of-line-blocks every report behind it — the whole
// shard stops classifying. Deliberately a *separate* queue from
// `classificationDlq`: its messages are stream-record metadata, not the worker's
// message shape, so redriving them into the classification queue would hand the
// worker bodies it cannot parse (poison). They need a different recovery path.
const pipeDlq = new Queue(pipelineStack, 'ReportStreamPipeDlq', {
  retentionPeriod: Duration.days(14),
});
pipeDlq.grantSendMessages(pipeRole);

new CfnPipe(pipelineStack, 'ReportStreamToClassificationQueue', {
  roleArn: pipeRole.roleArn,
  source: streamArn,
  target: classificationQueue.queueArn,
  sourceParameters: {
    dynamoDbStreamParameters: {
      startingPosition: 'LATEST', // don't replay historical NEW reports on deploy
      batchSize: 10,
      maximumBatchingWindowInSeconds: 1,
      // Bound how long one bad batch can block its shard, then park it (CRIS-31).
      // Without these three the defaults are "retry until the record expires",
      // which converts a transient SQS failure into a stalled shard.
      maximumRetryAttempts: 5,
      maximumRecordAgeInSeconds: 3600,
      // Park only the records that actually failed, not the whole batch.
      onPartialBatchItemFailure: 'AUTOMATIC_BISECT',
      deadLetterConfig: { arn: pipeDlq.queueArn },
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
// events. The redacted public projection is not written to a table — after the
// durable write the worker calls `publishReportUpdate`, whose IAM grant comes
// from `allow.resource(classifyReport)` in the schema (CRIS-19), not from here.
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

// Amazon Location geocoding (CRIS-21, ADR-0027) — the Triage Agent's
// geocode_location tool resolves described places via the standalone Places
// `Geocode` API. The standalone geo-places/geo-routes/geo-maps APIs are
// resource-less (no place-index ARN to scope to, unlike legacy Location), so
// the action can only be granted against `*`; it is a single read-only verb.
// The client runs in `eu-central-1` (ADR-0017), keeping lookups in the EU.
worker.addToRolePolicy(
  new PolicyStatement({
    actions: ['geo-places:Geocode'],
    resources: ['*'],
  }),
);

// Table names the worker resolves at runtime (no secrets/PII).
backend.classifyReport.addEnvironment('REPORT_TABLE_NAME', reportTable.tableName);
backend.classifyReport.addEnvironment('REPORT_EVENT_TABLE_NAME', tables['ReportEvent'].tableName);

// Duplicate detection (§5.4.3, CRIS-31) gathers candidates from the
// geohashPrefix/geohash GSI (`data/resource.ts` index #4). The L2 `ITable` does
// not expose its GSI names, so the name is stated here and injected rather than
// hardcoded in the worker. `grantReadWriteData` above already covers
// `<tableArn>/index/*`, so the Query needs no additional IAM.
//
// The name is NOT `<partitionKey>-<sortKey>-index`. When `@index` carries no
// explicit `name` — and `data/resource.ts` passes only `.sortKeys()`/
// `.queryField()` — the transformer derives it as
// `${toLower(pluralize(model))}By${[field, ...sortKeys].map(toUpper).join('And')}`
// (@aws-amplify/graphql-index-transformer: graphql-index-transformer.js
// `getOrGenerateDefaultName` → utils.js `generateKeyAndQueryNameForConfig`),
// then passes it straight to `addGlobalSecondaryIndex({ indexName })`
// (resolvers/resolvers.js). For Report/geohashPrefix/geohash that is
// `reportsByGeohashPrefixAndGeohash`.
//
// `.queryField('reportsByGeohash')` renames the *GraphQL query field* only and
// has no effect on the physical index name — the two are derived separately.
//
// A wrong value here is invisible to unit tests (ADR-0011) and degrades to
// "dedup silently links nothing" (logged as `dedupe.failed`), so it is derived
// from the transformer source rather than guessed — see docs/adr/0038.
backend.classifyReport.addEnvironment('REPORT_GEO_INDEX_NAME', 'reportsByGeohashPrefixAndGeohash');

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
  backend.createMediaUploadUrl,
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
  pipeDlq,
});
