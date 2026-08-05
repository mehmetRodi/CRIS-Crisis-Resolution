// @vitest-environment node

import { App, NestedStack, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { describe, expect, it } from 'vitest';
import { configureEncryptedAlarmTopic, createDataKey } from './encryption';

interface SynthesizedEncryption {
  key: Record<string, unknown>;
  keyStatements: Array<Record<string, unknown>>;
  topicStatements: Array<Record<string, unknown>>;
}

function synthesizeEncryption(): SynthesizedEncryption {
  const app = new App();
  const root = new Stack(app, 'ReviewRoot');
  const data = new NestedStack(root, 'Data');
  const key = createDataKey(root);
  const topic = new Topic(data, 'OpsAlarmTopic', { masterKey: key });

  configureEncryptedAlarmTopic(key, topic);

  const rootResources = Template.fromStack(root).toJSON().Resources as Record<
    string,
    Record<string, unknown>
  >;
  const dataResources = Template.fromStack(data).toJSON().Resources as Record<
    string,
    Record<string, unknown>
  >;
  const keyResource = Object.values(rootResources).find(
    (resource) => resource.Type === 'AWS::KMS::Key',
  );
  const topicPolicy = Object.values(dataResources).find(
    (resource) => resource.Type === 'AWS::SNS::TopicPolicy',
  );

  if (!keyResource || !topicPolicy) {
    throw new Error('Expected synthesized KMS key and SNS topic policy');
  }

  const keyProperties = keyResource.Properties as {
    KeyPolicy: { Statement: Array<Record<string, unknown>> };
  };
  const topicProperties = topicPolicy.Properties as {
    PolicyDocument: { Statement: Array<Record<string, unknown>> };
  };

  return {
    key: keyResource,
    keyStatements: keyProperties.KeyPolicy.Statement,
    topicStatements: topicProperties.PolicyDocument.Statement,
  };
}

function statementFor(
  statements: Array<Record<string, unknown>>,
  service: string,
): Record<string, unknown> | undefined {
  return statements.find((statement) => {
    const principal = statement.Principal as { Service?: string } | undefined;
    return principal?.Service === service;
  });
}

describe('triage data-plane encryption', () => {
  it('rotates and retains the customer-managed key', () => {
    const { key } = synthesizeEncryption();

    expect(key).toMatchObject({
      Type: 'AWS::KMS::Key',
      Properties: { EnableKeyRotation: true },
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  it('allows CloudWatch and SNS to use the key within this account boundary', () => {
    const { keyStatements } = synthesizeEncryption();
    const cloudWatch = statementFor(keyStatements, 'cloudwatch.amazonaws.com');
    const sns = statementFor(keyStatements, 'sns.amazonaws.com');

    expect(cloudWatch).toMatchObject({
      Action: ['kms:Decrypt', 'kms:GenerateDataKey*'],
      Effect: 'Allow',
      Resource: '*',
      Condition: {
        ArnLike: { 'aws:SourceArn': expect.anything() },
        StringEquals: { 'aws:SourceAccount': { Ref: 'AWS::AccountId' } },
      },
    });
    expect(JSON.stringify(cloudWatch)).toContain(':alarm:');
    expect(JSON.stringify(cloudWatch)).not.toContain('alarm/');

    expect(sns).toMatchObject({
      Action: ['kms:Decrypt', 'kms:GenerateDataKey*'],
      Effect: 'Allow',
      Resource: '*',
      Condition: {
        ArnLike: {
          'kms:EncryptionContext:aws:sns:topicArn': expect.anything(),
        },
      },
    });
  });

  it('allows only same-account CloudWatch alarms to publish to the topic', () => {
    const { topicStatements } = synthesizeEncryption();
    const cloudWatch = statementFor(topicStatements, 'cloudwatch.amazonaws.com');

    expect(cloudWatch).toMatchObject({
      Action: 'sns:Publish',
      Effect: 'Allow',
      Condition: {
        ArnLike: { 'aws:SourceArn': expect.anything() },
        StringEquals: { 'aws:SourceAccount': { Ref: 'AWS::AccountId' } },
      },
    });
    expect(JSON.stringify(cloudWatch)).toContain(':alarm:');
  });
});
