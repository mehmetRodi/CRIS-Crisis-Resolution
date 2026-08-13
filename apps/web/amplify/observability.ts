import { Duration, Stack } from 'aws-cdk-lib';
import {
  Alarm,
  ComparisonOperator,
  Dashboard,
  GraphWidget,
  MathExpression,
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

/** The four backend Lambdas, keyed by role. */
export interface BackendFunctions {
  submitReport: IFunction;
  transitionReport: IFunction;
  publishReportUpdate: IFunction;
  classifyReport: IFunction;
}

export interface ObservabilityProps {
  /** Stack to attach the alarms/dashboard/topic to (the pipeline stack). */
  scope: Construct;
  functions: BackendFunctions;
  /** Classification queue fed by the Report stream (Streams → Pipe → SQS). */
  classificationQueue: IQueue;
  /** Redrive DLQ for poison classification messages. */
  classificationDlq: IQueue;
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
}

/** §3.2 targets, in the units CloudWatch reports them. */
const SUBMISSION_P95_MS = 800;
const CLASSIFICATION_P95_SECONDS = 15;

/** Builds the ops alarm topic, alarms, and dashboard. Returns the topic so callers can subscribe. */
export function addObservability(props: ObservabilityProps): Topic {
  const { scope, functions, classificationQueue, classificationDlq, pipeDlq, encryptionKey } =
    props;

  /* ---- Ops alarm topic ---------------------------------------------------- */
  // Dedicated to operational alarms, separate from the app's (future) proximity-
  // alert SNS topic (CRIS-34). A human/Slack/PagerDuty subscription is added
  // post-deploy — see docs/runbooks/deploy.md — because the endpoint is
  // environment-specific and must not be committed.
  //
  // SSE-KMS under the shared CMK (CRIS-25). Alarm descriptions are operational
  // text, but the topic is the one place an outside endpoint (a phone, an inbox,
  // a Slack workspace) is attached to this system, so it gets the same key and
  // KMS audit surface as the triage queues.
  const alarmTopic = new Topic(scope, 'OpsAlarmTopic', {
    displayName: 'CrisisMap ops alarms',
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
        'Inspect the message and redrive after fixing the cause. See docs/runbooks/deploy.md.',
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
        'payloads are stream records, not worker messages. See docs/runbooks/deploy.md.',
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
  // The submit path is the fast citizen ack (p95 < 800 ms); any error is a failed
  // submission. transition/publish errors degrade the coordinator/real-time path.
  register(
    lambdaErrorAlarm(scope, 'SubmitReportErrors', functions.submitReport, {
      description:
        'submitReport resolver errors — citizens may be unable to file reports (99.9% availability, §3.2).',
    }),
  );
  register(
    lambdaErrorAlarm(scope, 'TransitionReportErrors', functions.transitionReport, {
      description: 'updateReportStatus resolver errors — coordinator state transitions failing.',
    }),
  );
  register(
    lambdaErrorAlarm(scope, 'PublishReportUpdateErrors', functions.publishReportUpdate, {
      description:
        'publishReportUpdate resolver errors; the worker call is wired, but subscribers are not yet connected.',
    }),
  );

  /* ---- Dashboard ---------------------------------------------------------- */
  buildDashboard(scope, functions, classificationQueue, classificationDlq, queueAge, dlqVisible);

  return alarmTopic;
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

/** One-screen SLA view: submission, classification pipeline, worker, resolver health. */
function buildDashboard(
  scope: Construct,
  functions: BackendFunctions,
  queue: IQueue,
  dlq: IQueue,
  queueAge: IMetric,
  dlqVisible: IMetric,
): void {
  const dashboard = new Dashboard(scope, 'ObservabilityDashboard', {
    // Auto-name would be an opaque hash; scope by stack so branches don't collide
    // yet the name stays greppable in the CloudWatch console.
    dashboardName: `CrisisMap-${Stack.of(scope).stackName}`,
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
        '# CrisisMap AI — Observability',
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
}
