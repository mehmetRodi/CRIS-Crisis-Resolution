// @vitest-environment node

import { App, NestedStack, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { describe, expect, it } from 'vitest';
import { createDataKey } from './security/encryption';
import { addObservability, type BackendFunctions } from './observability';

/**
 * Synth-level contract for the observability module (CRIS-35, ADR-0050): every
 * alarm notifies the ops topic on both ALARM and OK, no alarm pages on missing
 * data, and the alarm set itself is pinned so dropping one is a visible diff —
 * the same `Template.fromStack` pattern as `security/encryption.test.ts`.
 */

const EXPECTED_ALARMS = 12;

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
  // including the auth-stack trigger referenced across stacks (ADR-0050).
  const data = new NestedStack(root, 'Data');
  const auth = new NestedStack(root, 'Auth');
  const encryptionKey = createDataKey(root);

  const functions: BackendFunctions = {
    submitReport: lambdaStub(data, 'SubmitReportFn'),
    transitionReport: lambdaStub(data, 'TransitionReportFn'),
    publishReportUpdate: lambdaStub(data, 'PublishReportUpdateFn'),
    classifyReport: lambdaStub(data, 'ClassifyReportFn'),
    createMediaUploadUrl: lambdaStub(data, 'CreateMediaUploadUrlFn'),
    listVolunteerTasks: lambdaStub(data, 'ListVolunteerTasksFn'),
    assignTeam: lambdaStub(data, 'AssignTeamFn'),
    citizenRoleAssignment: lambdaStub(auth, 'CitizenRoleAssignmentFn'),
  };

  const classificationDlq = new Queue(data, 'ClassificationDlq');
  const classificationQueue = new Queue(data, 'ClassificationQueue', {
    deadLetterQueue: { queue: classificationDlq, maxReceiveCount: 3 },
  });
  const pipeDlq = new Queue(data, 'ReportStreamPipeDlq');

  addObservability({
    scope: data,
    functions,
    classificationQueue,
    classificationDlq,
    pipeDlq,
    encryptionKey,
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

describe('observability baseline (ADR-0015, ADR-0050)', () => {
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

    for (const prefix of ['ClassificationDlqNotEmpty', 'ReportStreamPipeDlqNotEmpty']) {
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

  it('alarms on any error from each write-path resolver and the classify worker', () => {
    const { alarms } = synthesizeObservability();

    for (const prefix of [
      'SubmitReportErrors',
      'TransitionReportErrors',
      'PublishReportUpdateErrors',
      'ClassifyWorkerErrors',
      'MediaUploadUrlErrors',
      'VolunteerTasksErrors',
      'AssignTeamErrors',
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
});
