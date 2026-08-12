import { ArnFormat, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Key, type IKey } from 'aws-cdk-lib/aws-kms';
import type { ITopic } from 'aws-cdk-lib/aws-sns';
import type { Construct } from 'constructs';

/**
 * Encryption at rest for the triage data plane (CRIS-25, ADR-0043).
 *
 * This module owns one customer-managed key (CMK) shared by the three queues in
 * the DynamoDB Streams -> EventBridge Pipes -> SQS -> Lambda path and the
 * operational alarm topic that watches that path. The pipe DLQ can contain raw
 * stream images, including report text and reporter contact, so it is the most
 * sensitive resource in this boundary.
 *
 * DynamoDB tables, report media in S3, and application-layer contact encryption
 * are not configured by this module. Those resources retain their existing
 * service-managed encryption until a later decision explicitly extends the CMK
 * boundary; do not treat this key as field-level encryption for reporter contact.
 *
 * A CMK makes KMS API use visible in CloudTrail, permits explicit revocation,
 * and rotates annually. Service-side data-key caching means KMS audit events are
 * not a per-message read log; resource access still belongs in service/API audit
 * controls.
 *
 * One key is sufficient because the queues and alarm topic form one operational
 * pipeline with the same administrators. Splitting that trust boundary requires
 * a new ADR rather than silently adding more keys here.
 */

/**
 * Creates the backend's customer-managed key.
 *
 * Create it in the ROOT stack. The data nested stack then receives the key ARN as
 * a CloudFormation parameter, which is the direction nested-stack references are
 * free in. The reverse would need an Output and risks the same circular dependency
 * the pipeline resources already work around (ADR-0031).
 */
export function createDataKey(scope: Construct): Key {
  const stack = Stack.of(scope);

  return new Key(scope, 'CrisisMapDataKey', {
    description:
      'CrisisMap AI — encryption at rest for triage queues and operational alarms (CRIS-25).',
    // Annual rotation. Rotation re-keys new writes only; KMS keeps prior key
    // material so existing ciphertext stays readable with no re-encrypt step.
    enableKeyRotation: true,
    alias: `alias/${stack.stackName}-data`,
    // RETAIN protects messages encrypted with an older key if an update replaces
    // the key before those messages expire. It also strands a billable key after
    // `ampx sandbox delete`; docs/runbooks/deploy.md defines the cleanup check.
    removalPolicy: RemovalPolicy.RETAIN,
  });
}

/**
 * Authorizes both sides of CloudWatch -> encrypted SNS alarm delivery.
 *
 * CloudWatch needs permission to publish and to use the key while publishing;
 * SNS also needs key access to encrypt/decrypt messages for delivery. These are
 * service principals, so the KMS permissions must live in the key policy rather
 * than an IAM role. Account/ARN/encryption-context conditions keep both grants
 * inside this deployment without referencing a child-stack resource from the
 * root key policy.
 *
 * The topic policy uses its exact ARN because it lives beside the topic. The key
 * policy deliberately uses account-scoped wildcard ARNs to avoid a root -> child
 * reference that would reverse the key's child-stack dependency.
 */
export function configureEncryptedAlarmTopic(key: IKey, topic: ITopic): void {
  const keyStack = Stack.of(key);
  const topicStack = Stack.of(topic);
  const alarmsInAccount = alarmArnWildcard(keyStack);
  const topicsInAccount = keyStack.formatArn({ service: 'sns', resource: '*' });

  key.addToResourcePolicy(
    new PolicyStatement({
      sid: 'AllowCloudWatchAlarmsToPublishToEncryptedTopic',
      principals: [new ServicePrincipal('cloudwatch.amazonaws.com')],
      actions: ['kms:Decrypt', 'kms:GenerateDataKey*'],
      // KMS resource policies are attached to the key, so `*` IS this key.
      resources: ['*'],
      conditions: {
        ArnLike: { 'aws:SourceArn': alarmsInAccount },
        StringEquals: { 'aws:SourceAccount': keyStack.account },
      },
    }),
  );

  key.addToResourcePolicy(
    new PolicyStatement({
      sid: 'AllowSnsToUseKeyForAlarmTopic',
      principals: [new ServicePrincipal('sns.amazonaws.com')],
      actions: ['kms:Decrypt', 'kms:GenerateDataKey*'],
      resources: ['*'],
      conditions: {
        ArnLike: {
          'kms:EncryptionContext:aws:sns:topicArn': topicsInAccount,
        },
      },
    }),
  );

  topic.addToResourcePolicy(
    new PolicyStatement({
      sid: 'AllowCloudWatchAlarmsToPublish',
      principals: [new ServicePrincipal('cloudwatch.amazonaws.com')],
      actions: ['sns:Publish'],
      resources: [topic.topicArn],
      conditions: {
        ArnLike: { 'aws:SourceArn': alarmArnWildcard(topicStack) },
        StringEquals: { 'aws:SourceAccount': topicStack.account },
      },
    }),
  );
}

function alarmArnWildcard(stack: Stack): string {
  return stack.formatArn({
    service: 'cloudwatch',
    resource: 'alarm',
    resourceName: '*',
    // CloudWatch alarm ARNs are `alarm:name`, not `alarm/name`.
    arnFormat: ArnFormat.COLON_RESOURCE_NAME,
  });
}
