// @vitest-environment node

import { App, NestedStack, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { describe, expect, it } from 'vitest';
import { createDataKey } from './security/encryption';
import { addObservability, type BackendFunctions } from './observability';
import {
  RESOLVER_METRIC_NAMESPACE,
  UNEXPECTED_ERROR_METRIC,
  ResolverOperation,
} from './functions/resolver-metrics';

/**
 * Synth-level contract for the observability module (CRIS-35, ADR-0051): every
 * alarm notifies the ops topic on both ALARM and OK, no alarm pages on missing
 * data, and the alarm set itself is pinned so dropping one is a visible diff —
 * the same `Template.fromStack` pattern as `security/encryption.test.ts`.
 */

const EXPECTED_ALARMS = 16;

interface SynthesizedObservability {
  template: Template;
  alarms: Record<string, CfnResource>;
}

type CfnResource = {
  Type: string;
  Properties: Record<string, unknown>;
};

function lambdaStub(scope: Stack, id: string): LambdaFunction {
  return new LambdaFunction(scope, id, {
    runtime: Runtime.NODEJS_20_X,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = async () => ({});'),
  });
}

function synthesizeObservability(): SynthesizedObservability {
  const app = new App();
  const root = new Stack(app, 'ObservabilityRoot');
  // Alarms live in the data (pipeline) nested stack in backend.ts; mirror that,
  // including the auth-stack trigger referenced across stacks (ADR-0051).
  const data = new NestedStack(root, 'Data');
  const auth = new NestedStack(root, 'Auth');
  const encryptionKey = createDataKey(root);

  const functions: BackendFunctions = {
    submitReport: lambdaStub(data, 'SubmitReportFn'),
    transitionReport: lambdaStub(data, 'TransitionReportFn'),
    publishReportUpdate: lambdaStub(data, 'PublishReportUpdateFn'),
    classifyReport: lambdaStub(data, 'ClassifyReportFn'),
    alertDispatch: lambdaStub(data, 'AlertDispatchFn'),
    createMediaUploadUrl: lambdaStub(data, 'CreateMediaUploadUrlFn'),
    listVolunteerTasks: lambdaStub(data, 'ListVolunteerTasksFn'),
    listPublicReports: lambdaStub(data, 'ListPublicReportsFn'),
    assignTeam: lambdaStub(data, 'AssignTeamFn'),
    citizenRoleAssignment: lambdaStub(auth, 'CitizenRoleAssignmentFn'),
  };

  const classificationDlq = new Queue(data, 'ClassificationDlq');
  const classificationQueue = new Queue(data, 'ClassificationQueue', {
    deadLetterQueue: { queue: classificationDlq, maxReceiveCount: 3 },
  });
  const pipeDlq = new Queue(data, 'ReportStreamPipeDlq');
  const alertDlq = new Queue(data, 'AlertDlq');
  const alertPipeDlq = new Queue(data, 'AlertStreamPipeDlq');

  addObservability({
    scope: data,
    functions,
    classificationQueue,
    classificationDlq,
    alertDlq,
    alertPipeDlq,
    pipeDlq,
    encryptionKey,
    graphqlApiId: 'testGraphqlApiId',
  });

  const template = Template.fromStack(data);
  return {
    template,
    alarms: template.findResources('AWS::CloudWatch::Alarm') as Record<string, CfnResource>,
  };
}

function alarmByLogicalIdPrefix(
  alarms: Record<string, CfnResource>,
  prefix: string,
): Record<string, unknown> {
  const match = Object.entries(alarms).find(([logicalId]) => logicalId.startsWith(prefix));
  if (!match) {
    throw new Error(`No alarm with logical id prefix "${prefix}" was synthesized`);
  }
  return match[1].Properties;
}

describe('observability baseline (ADR-0015, ADR-0051)', () => {
  it('synthesizes the pinned alarm set, one encrypted ops topic, and the dashboard', () => {
    const { template, alarms } = synthesizeObservability();

    expect(Object.keys(alarms)).toHaveLength(EXPECTED_ALARMS);
    template.resourceCountIs('AWS::SNS::Topic', 1);
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
    template.hasResourceProperties('AWS::SNS::Topic', {
      KmsMasterKeyId: Match.anyValue(),
    });
  });

  it('routes every alarm to the ops topic on ALARM and OK and never pages on missing data', () => {
    const { alarms } = synthesizeObservability();

    for (const [logicalId, alarm] of Object.entries(alarms)) {
      expect(alarm.Properties.AlarmActions, logicalId).toHaveLength(1);
      expect(alarm.Properties.OKActions, logicalId).toHaveLength(1);
      expect(alarm.Properties.TreatMissingData, logicalId).toBe('notBreaching');
      expect(alarm.Properties.AlarmDescription, logicalId).toEqual(expect.any(String));
    }
  });

  it('pages on a single message in either DLQ (§5.4.4 never-lost)', () => {
    const { alarms } = synthesizeObservability();

    for (const prefix of [
      'ClassificationDlqNotEmpty',
      'AlertDlqNotEmpty',
      'AlertStreamPipeDlqNotEmpty',
      'ReportStreamPipeDlqNotEmpty',
    ]) {
      expect(alarmByLogicalIdPrefix(alarms, prefix)).toMatchObject({
        MetricName: 'ApproximateNumberOfMessagesVisible',
        Namespace: 'AWS/SQS',
        Statistic: 'Maximum',
        Threshold: 1,
        ComparisonOperator: 'GreaterThanOrEqualToThreshold',
        EvaluationPeriods: 1,
      });
    }
  });

  it('alarms on sustained classification backlog age with 2× SLA headroom', () => {
    const { alarms } = synthesizeObservability();

    expect(alarmByLogicalIdPrefix(alarms, 'ClassificationBacklogAge')).toMatchObject({
      MetricName: 'ApproximateAgeOfOldestMessage',
      Namespace: 'AWS/SQS',
      Threshold: 30,
      ComparisonOperator: 'GreaterThanThreshold',
      EvaluationPeriods: 3,
    });
  });

  it('alarms on unexpected errors while excluding expected resolver rejections', () => {
    const { alarms } = synthesizeObservability();

    for (const [prefix, operation] of [
      ['SubmitReportErrors', ResolverOperation.SUBMIT_REPORT],
      ['TransitionReportErrors', ResolverOperation.UPDATE_REPORT_STATUS],
      ['MediaUploadUrlErrors', ResolverOperation.CREATE_MEDIA_UPLOAD_URL],
      ['AssignTeamErrors', ResolverOperation.ASSIGN_TEAM],
    ] as const) {
      expect(alarmByLogicalIdPrefix(alarms, prefix)).toMatchObject({
        MetricName: UNEXPECTED_ERROR_METRIC,
        Namespace: RESOLVER_METRIC_NAMESPACE,
        Statistic: 'Sum',
        Threshold: 1,
        ComparisonOperator: 'GreaterThanOrEqualToThreshold',
        Dimensions: [{ Name: 'Operation', Value: operation }],
      });
    }

    for (const prefix of [
      'PublishReportUpdateErrors',
      'ClassifyWorkerErrors',
      'AlertDispatchErrors',
      'VolunteerTasksErrors',
      'CitizenRoleAssignmentErrors',
    ]) {
      expect(alarmByLogicalIdPrefix(alarms, prefix)).toMatchObject({
        MetricName: 'Errors',
        Namespace: 'AWS/Lambda',
        Statistic: 'Sum',
        Threshold: 1,
        ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      });
    }

    expect(alarmByLogicalIdPrefix(alarms, 'ClassifyWorkerThrottles')).toMatchObject({
      MetricName: 'Throttles',
      Namespace: 'AWS/Lambda',
      Threshold: 1,
    });
  });

  it('alarms on AppSync 5XX server errors at the API level', () => {
    const { alarms } = synthesizeObservability();

    expect(alarmByLogicalIdPrefix(alarms, 'AppSyncServerErrors')).toMatchObject({
      MetricName: '5XXError',
      Namespace: 'AWS/AppSync',
      Statistic: 'Sum',
      Threshold: 1,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      EvaluationPeriods: 1,
      Dimensions: [{ Name: 'GraphQLAPIId', Value: 'testGraphqlApiId' }],
    });
  });
});
