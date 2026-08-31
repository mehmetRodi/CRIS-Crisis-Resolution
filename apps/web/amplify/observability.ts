import { Duration, Stack } from 'aws-cdk-lib';
import {
  Alarm,
  ComparisonOperator,
  Dashboard,
  GraphWidget,
  MathExpression,
  Metric,
  Row,
  Stats,
  TextWidget,
  TreatMissingData,
  type IMetric,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import type { IKey } from 'aws-cdk-lib/aws-kms';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Topic } from 'aws-cdk-lib/aws-sns';
import type { IQueue } from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';
import { configureEncryptedAlarmTopic } from './security/encryption';
import {
  RESOLVER_METRIC_NAMESPACE,
  UNEXPECTED_ERROR_METRIC,
  ResolverOperation,
  type ResolverOperation as ResolverOperationT,
} from './functions/resolver-metrics';

/**
 * Observability baseline (design doc §3.1 "CloudWatch / X-Ray", §3.2 SLAs; CRIS-15,
 * ADR-0015). Realizes the observability contract that ADR-0005 deferred until the
 * Lambda pipeline existed.
 *
 * X-Ray active tracing is enabled in `backend.ts` (it needs the CfnFunction escape
 * hatch on each `defineFunction`). This module owns the *signals*: a single ops SNS
 * alarm topic, CloudWatch alarms whose thresholds trace back to the §3.2 targets,
 * and a dashboard that puts the SLAs on one screen.
 *
 * Alarm thresholds ↔ design goals (§3.2):
 *   - submission latency  p95 < 800 ms   → submit-report duration + error alarms
 *   - classification      p95 < 15 s     → classification-queue oldest-message age
 *   - degraded operation / never-lost    → DLQ depth (poison) + worker error/throttle
 *   - availability        99.9%          → resolver error alarms (submit/transition/publish)
 *
 * Alarms `treatMissingData: NOT_BREACHING` — an idle queue with no traffic must not
 * page. All alarms/dashboards are auto-named by CDK so multiple sandbox branches in
 * one account don't collide.
 */

/** The alarmed backend Lambdas, keyed by role (ADR-0015; completed by ADR-0051). */
export interface BackendFunctions {
  submitReport: IFunction;
  transitionReport: IFunction;
  publishReportUpdate: IFunction;
  classifyReport: IFunction;
  alertDispatch: IFunction;
  createMediaUploadUrl: IFunction;
  listVolunteerTasks: IFunction;
  /**
   * The unauthenticated public-map read (CRIS-54, ADR-0056). Alarmed like the
   * other resolvers, and worth watching more closely than most: it is the only
   * function a caller with no credentials can invoke, so its error and
   * invocation curves are the first place an abuse pattern would show up while
   * WAF rate limiting is still open (CRIS-25).
   */
  listPublicReports: IFunction;
  assignTeam: IFunction;
  /** Cognito post-confirmation trigger — lives in the auth stack, alarmed from here. */
  citizenRoleAssignment: IFunction;
}

export interface ObservabilityProps {
  /** Stack to attach the alarms/dashboard/topic to (the pipeline stack). */
  scope: Construct;
  functions: BackendFunctions;
  /** Classification queue fed by the Report stream (Streams → Pipe → SQS). */
  classificationQueue: IQueue;
  /** Redrive DLQ for poison classification messages. */
  classificationDlq: IQueue;
  /** Redrive DLQ for alert candidates that exhausted delivery retries. */
  alertDlq: IQueue;
  /** Failure sink for Report-stream records that never reached the alert queue. */
  alertPipeDlq: IQueue;
  /**
   * Failure sink for the Stream→SQS pipe (CRIS-31). Distinct from
   * {@link ObservabilityProps.classificationDlq}: these messages are stream
   * records the pipe could not deliver, and a non-empty queue means reports were
   * dropped *before* ever reaching classification.
   */
  pipeDlq: IQueue;
  /**
   * Customer-managed key the ops topic is encrypted with (CRIS-25, ADR-0043).
   * `addObservability` installs the required CloudWatch, SNS, and KMS policies.
   */
  encryptionKey: IKey;
  /**
   * GraphQL API id (`CfnGraphQLApi.attrApiId`) for the API-level 5XX alarm
   * (ADR-0051) — failures AppSync serves itself never appear in any Lambda metric.
   */
  graphqlApiId: string;
}

/** §3.2 targets, in the units CloudWatch reports them. */
const SUBMISSION_P95_MS = 800;
const CLASSIFICATION_P95_SECONDS = 15;

/** Builds the ops alarm topic, alarms, and dashboard. Returns the topic so callers can subscribe. */
export function addObservability(props: ObservabilityProps): Topic {
  const {
    scope,
    functions,
    classificationQueue,
    classificationDlq,
    alertDlq,
    alertPipeDlq,
    pipeDlq,
    encryptionKey,
    graphqlApiId,
  } = props;

  /* ---- Ops alarm topic ---------------------------------------------------- */
  // Dedicated to operational alarms, separate from direct citizen-alert
  // SNS/SES delivery (CRIS-34). A human/Slack/PagerDuty subscription is added
  // post-deploy — see docs/runbooks/deploy.md — because the endpoint is
  // environment-specific and must not be committed.
  //
  // SSE-KMS under the shared CMK (CRIS-25). Alarm descriptions are operational
  // text, but the topic is the one place an outside endpoint (a phone, an inbox,
  // a Slack workspace) is attached to this system, so it gets the same key and
  // KMS audit surface as the triage queues.
  const alarmTopic = new Topic(scope, 'OpsAlarmTopic', {
    displayName: 'CRIS ops alarms',
    masterKey: encryptionKey,
  });
  configureEncryptedAlarmTopic(encryptionKey, alarmTopic);
  const alarmAction = new SnsAction(alarmTopic);

  const alarms: Alarm[] = [];
  const register = (alarm: Alarm): Alarm => {
    alarm.addAlarmAction(alarmAction);
    alarm.addOkAction(alarmAction);
    alarms.push(alarm);
    return alarm;
  };

  /* ---- Pipeline "never lost" + latency alarms ----------------------------- */

  // Poison messages: anything in the DLQ has exhausted maxReceiveCount (=3) and
  // needs a human. A single message is worth paging (§5.4.4 "never lost").
  const dlqVisible = classificationDlq.metricApproximateNumberOfMessagesVisible({
    period: Duration.minutes(1),
    statistic: Stats.MAXIMUM,
  });
  register(
    new Alarm(scope, 'ClassificationDlqNotEmpty', {
      metric: dlqVisible,
      threshold: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
      alarmDescription:
        'Classification DLQ is non-empty: a report exhausted its retries (poison message). ' +
        'Inspect the message and redrive after fixing the cause. See docs/runbooks/incident-response.md.',
    }),
  );

  register(
    new Alarm(scope, 'AlertDlqNotEmpty', {
      metric: alertDlq.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(1),
        statistic: Stats.MAXIMUM,
      }),
      threshold: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
      alarmDescription:
        'Alert DLQ is non-empty: a proximity alert exhausted Cognito/SNS/SES retries. ' +
        'Fix the dependency or recipient issue, then redrive to AlertQueue. ' +
        'See docs/runbooks/incident-response.md.',
    }),
  );

  register(
    new Alarm(scope, 'AlertStreamPipeDlqNotEmpty', {
      metric: alertPipeDlq.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(1),
        statistic: Stats.MAXIMUM,
      }),
      threshold: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
      alarmDescription:
        'Alert stream pipe DLQ is non-empty: classified P0/P1 stream records never reached ' +
        'AlertQueue. Do NOT redrive raw stream records directly into AlertQueue. ' +
        'See docs/runbooks/incident-response.md.',
    }),
  );

  // Stream→SQS delivery failures (CRIS-31). Strictly worse than the queue DLQ
  // above: those reports never entered classification at all, and the pipe gave
  // up on them to stop the shard blocking. Same single-message threshold — §5.4.4
  // "never lost" applies most strongly to the records nothing else has seen.
  register(
    new Alarm(scope, 'ReportStreamPipeDlqNotEmpty', {
      metric: pipeDlq.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(1),
        statistic: Stats.MAXIMUM,
      }),
      threshold: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
      alarmDescription:
        'Stream→SQS pipe DLQ is non-empty: report stream records never reached the ' +
        'classification queue and were parked. These reports are unclassified and ' +
        'invisible to the queue DLQ. Do NOT redrive into ClassificationQueue — the ' +
        'payloads are stream records, not worker messages. See docs/runbooks/incident-response.md.',
    }),
  );

  // Classification latency proxy: the oldest un-consumed message's age. Sustained
  // age above the §3.2 p95 < 15 s target means the pipeline is falling behind.
  // Maximum over 1-min periods, 3 consecutive periods to ride out normal spikes.
  const queueAge = classificationQueue.metricApproximateAgeOfOldestMessage({
    period: Duration.minutes(1),
    statistic: Stats.MAXIMUM,
  });
  register(
    new Alarm(scope, 'ClassificationBacklogAge', {
      metric: queueAge,
      threshold: CLASSIFICATION_P95_SECONDS * 2, // headroom over the p95 target
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 3,
      treatMissingData: TreatMissingData.NOT_BREACHING,
      alarmDescription:
        'Classification queue oldest-message age exceeds the §3.2 p95 < 15 s target for 3 min. ' +
        'Check Bedrock throttling/quota and the classify-report worker.',
    }),
  );

  /* ---- Worker health ------------------------------------------------------ */
  // Handled failures (Bedrock/parse errors) route the report to NEEDS_VERIFICATION
  // and return success — they are NOT Lambda Errors. So any Errors here is an
  // *unhandled* fault (infra/poison), and any Throttles means concurrency pressure
  // against the 1,000 writes/min target.
  register(
    lambdaErrorAlarm(scope, 'ClassifyWorkerErrors', functions.classifyReport, {
      description:
        'classify-report worker raised unhandled errors (handled Bedrock/parse failures route to ' +
        'NEEDS_VERIFICATION and do not count here). Check logs; repeated errors feed the DLQ.',
    }),
  );
  register(
    lambdaErrorAlarm(scope, 'AlertDispatchErrors', functions.alertDispatch, {
      description:
        'alert-dispatch raised retryable delivery errors. Repeated errors feed AlertDlq; ' +
        'check Cognito, SNS, SES, and DynamoDB health.',
    }),
  );
  register(
    new Alarm(scope, 'ClassifyWorkerThrottles', {
      metric: functions.classifyReport.metricThrottles({
        period: Duration.minutes(5),
        statistic: Stats.SUM,
      }),
      threshold: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
      alarmDescription:
        'classify-report is being throttled — concurrency ceiling reached under load. ' +
        'Review reserved concurrency vs the 1,000 writes/min target (§3.2).',
    }),
  );

  /* ---- Write-path / resolver availability (99.9%, §3.2) ------------------- */
  // The submit path is the fast citizen ack (p95 < 800 ms). Public/guarded
  // resolvers alarm on their explicit unexpected-error metric so normal client
  // validation and state-machine rejections cannot page; the internal publish
  // resolver has no expected error path and retains its Lambda Errors alarm.
  register(
    resolverUnexpectedErrorAlarm(scope, 'SubmitReportErrors', ResolverOperation.SUBMIT_REPORT, {
      description:
        'submitReport unexpected errors — citizens may be unable to file reports ' +
        '(expected validation failures excluded; 99.9% availability, §3.2).',
    }),
  );
  register(
    resolverUnexpectedErrorAlarm(
      scope,
      'TransitionReportErrors',
      ResolverOperation.UPDATE_REPORT_STATUS,
      {
        description:
          'updateReportStatus unexpected errors — coordinator state transitions failing ' +
          '(expected authorization, legality, and optimistic-lock rejections excluded).',
      },
    ),
  );
  register(
    lambdaErrorAlarm(scope, 'PublishReportUpdateErrors', functions.publishReportUpdate, {
      description:
        'publishReportUpdate resolver errors; classification/transition fan-out to live subscribers is degraded.',
    }),
  );

  /* ---- Support resolvers + auth trigger (ADR-0051) ------------------------ */
  // The remaining wired Lambdas. Public/guarded operations use the same
  // expected-error-aware policy as the write path; pure read/trigger handlers
  // with no client/domain rejection path retain Lambda Errors.
  register(
    resolverUnexpectedErrorAlarm(
      scope,
      'MediaUploadUrlErrors',
      ResolverOperation.CREATE_MEDIA_UPLOAD_URL,
      {
        description:
          'createMediaUploadUrl unexpected errors — citizens cannot attach photos to reports ' +
          '(expected validation failures excluded; CRIS-17/ADR-0035).',
      },
    ),
  );
  register(
    lambdaErrorAlarm(scope, 'VolunteerTasksErrors', functions.listVolunteerTasks, {
      description:
        'listVolunteerTasks resolver errors — the volunteer task board read path is failing (CRIS-33).',
    }),
  );
  register(
    resolverUnexpectedErrorAlarm(scope, 'AssignTeamErrors', ResolverOperation.ASSIGN_TEAM, {
      description:
        'assignTeam unexpected errors — coordinators cannot dispatch response teams ' +
        '(expected authorization, legality, and optimistic-lock rejections excluded; CRIS-32).',
    }),
  );
  register(
    lambdaErrorAlarm(scope, 'CitizenRoleAssignmentErrors', functions.citizenRoleAssignment, {
      description:
        'citizen-role-assignment trigger errors — sign-up confirmation may be failing, or new ' +
        'accounts are left without the CITIZEN role (CRIS-24).',
    }),
  );

  /* ---- API surface (ADR-0051) --------------------------------------------- */
  // 5XX from AppSync itself: request/response mapping faults, auth-plumbing
  // breakage, resolver invoke failures — none of which increment a Lambda Errors
  // metric. 4XX is deliberately NOT alarmed (dominated by client mistakes and
  // auth denials) but is charted on the dashboard.
  register(
    new Alarm(scope, 'AppSyncServerErrors', {
      metric: appSyncMetric(graphqlApiId, '5XXError', Duration.minutes(5)),
      threshold: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
      alarmDescription:
        'AppSync returned 5XX server errors — an API-level failure independent of any resolver ' +
        'Lambda (99.9% availability, §3.2). Check AppSync request logs and X-Ray for the failing field.',
    }),
  );

  /* ---- Dashboard ---------------------------------------------------------- */
  buildDashboard(
    scope,
    functions,
    classificationQueue,
    classificationDlq,
    queueAge,
    dlqVisible,
    graphqlApiId,
  );

  return alarmTopic;
}

/** An AppSync API-level metric (`AWS/AppSync`, keyed by GraphQL API id). */
function appSyncMetric(
  graphqlApiId: string,
  metricName: '5XXError' | '4XXError' | 'Latency',
  period: Duration,
  statistic: string = Stats.SUM,
): Metric {
  return new Metric({
    namespace: 'AWS/AppSync',
    metricName,
    dimensionsMap: { GraphQLAPIId: graphqlApiId },
    period,
    statistic,
  });
}

/** A standard "Lambda raised errors" alarm: any error over a 5-min window pages. */
function lambdaErrorAlarm(
  scope: Construct,
  id: string,
  fn: IFunction,
  opts: { description: string },
): Alarm {
  return new Alarm(scope, id, {
    metric: fn.metricErrors({ period: Duration.minutes(5), statistic: Stats.SUM }),
    threshold: 1,
    comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    evaluationPeriods: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
    alarmDescription: opts.description,
  });
}

/** Pages on the PII-free EMF metric emitted only for unexpected resolver failures. */
function resolverUnexpectedErrorAlarm(
  scope: Construct,
  id: string,
  operation: ResolverOperationT,
  opts: { description: string },
): Alarm {
  return new Alarm(scope, id, {
    metric: new Metric({
      namespace: RESOLVER_METRIC_NAMESPACE,
      metricName: UNEXPECTED_ERROR_METRIC,
      dimensionsMap: { Operation: operation },
      period: Duration.minutes(5),
      statistic: Stats.SUM,
    }),
    threshold: 1,
    comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    evaluationPeriods: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
    alarmDescription: opts.description,
  });
}

/** One-screen SLA view: submission, classification pipeline, worker, resolver + API health. */
function buildDashboard(
  scope: Construct,
  functions: BackendFunctions,
  queue: IQueue,
  dlq: IQueue,
  queueAge: IMetric,
  dlqVisible: IMetric,
  graphqlApiId: string,
): void {
  const dashboard = new Dashboard(scope, 'ObservabilityDashboard', {
    // Auto-name would be an opaque hash; scope by stack so branches don't collide
    // yet the name stays greppable in the CloudWatch console.
    dashboardName: `CRIS-${Stack.of(scope).stackName}`,
  });

  const invocations = (fn: IFunction): IMetric =>
    fn.metricInvocations({ period: Duration.minutes(1), statistic: Stats.SUM });
  const errors = (fn: IFunction): IMetric =>
    fn.metricErrors({ period: Duration.minutes(1), statistic: Stats.SUM });
  const p95 = (fn: IFunction): IMetric =>
    fn.metricDuration({ period: Duration.minutes(1), statistic: Stats.percentile(95) });

  dashboard.addWidgets(
    new TextWidget({
      markdown: [
        '# CRIS — Observability',
        '',
        'SLA targets (design doc §3.2): submission **p95 < 800 ms** · classification **p95 < 15 s** ·',
        'real-time propagation **p95 < 2 s** · availability **99.9%** · never-lost under degraded deps.',
      ].join('\n'),
      width: 24,
      height: 3,
    }),
  );

  dashboard.addWidgets(
    new Row(
      new GraphWidget({
        title: 'Submission — submit-report (p95 < 800 ms)',
        left: [invocations(functions.submitReport), errors(functions.submitReport)],
        right: [p95(functions.submitReport)],
        leftYAxis: { label: 'count', showUnits: false },
        rightYAxis: { label: 'ms', showUnits: false },
        rightAnnotations: [{ value: SUBMISSION_P95_MS, label: 'p95 target 800 ms' }],
        width: 12,
        height: 6,
      }),
      new GraphWidget({
        title: 'Classification pipeline (p95 < 15 s)',
        left: [
          queue.metricApproximateNumberOfMessagesVisible({
            period: Duration.minutes(1),
            statistic: Stats.MAXIMUM,
            label: 'queue backlog',
          }),
          dlqVisible,
        ],
        right: [queueAge],
        leftYAxis: { label: 'messages', showUnits: false },
        rightYAxis: { label: 'seconds', showUnits: false },
        rightAnnotations: [{ value: CLASSIFICATION_P95_SECONDS, label: 'p95 target 15 s' }],
        width: 12,
        height: 6,
      }),
    ),
  );

  dashboard.addWidgets(
    new Row(
      new GraphWidget({
        title: 'AI worker — classify-report',
        left: [
          invocations(functions.classifyReport),
          errors(functions.classifyReport),
          functions.classifyReport.metricThrottles({
            period: Duration.minutes(1),
            statistic: Stats.SUM,
          }),
        ],
        right: [p95(functions.classifyReport)],
        leftYAxis: { label: 'count', showUnits: false },
        rightYAxis: { label: 'ms', showUnits: false },
        width: 12,
        height: 6,
      }),
      new GraphWidget({
        title: 'Resolver health — transition / publish',
        left: [
          errors(functions.transitionReport),
          errors(functions.publishReportUpdate),
          invocations(functions.transitionReport),
          invocations(functions.publishReportUpdate),
        ],
        // A single failed-invocation ratio across the write-path resolvers.
        right: [
          new MathExpression({
            expression: '100 * (e1 + e2) / MAX([i1 + i2, 1])',
            usingMetrics: {
              e1: errors(functions.transitionReport),
              e2: errors(functions.publishReportUpdate),
              i1: invocations(functions.transitionReport),
              i2: invocations(functions.publishReportUpdate),
            },
            label: 'error %',
            period: Duration.minutes(1),
          }),
        ],
        leftYAxis: { label: 'count', showUnits: false },
        rightYAxis: { label: '%', showUnits: false, min: 0 },
        width: 12,
        height: 6,
      }),
    ),
  );

  dashboard.addWidgets(
    new Row(
      new GraphWidget({
        title: 'Support resolvers — media upload / volunteer tasks / assign team / roles',
        // Unlabelled on purpose: the console legend falls back to the function-name
        // dimension, which distinguishes the lines better than a shared label.
        left: [
          errors(functions.createMediaUploadUrl),
          errors(functions.listVolunteerTasks),
          errors(functions.assignTeam),
          errors(functions.citizenRoleAssignment),
        ],
        right: [
          invocations(functions.createMediaUploadUrl),
          invocations(functions.listVolunteerTasks),
          invocations(functions.assignTeam),
          invocations(functions.citizenRoleAssignment),
        ],
        leftYAxis: { label: 'errors', showUnits: false },
        rightYAxis: { label: 'invocations', showUnits: false },
        width: 12,
        height: 6,
      }),
      new GraphWidget({
        title: 'API — AppSync (5XX alarmed, 4XX charted)',
        left: [
          appSyncMetric(graphqlApiId, '5XXError', Duration.minutes(1)),
          appSyncMetric(graphqlApiId, '4XXError', Duration.minutes(1)),
        ],
        right: [appSyncMetric(graphqlApiId, 'Latency', Duration.minutes(1), Stats.percentile(95))],
        leftYAxis: { label: 'errors', showUnits: false },
        rightYAxis: { label: 'ms', showUnits: false },
        width: 12,
        height: 6,
      }),
    ),
  );
}
