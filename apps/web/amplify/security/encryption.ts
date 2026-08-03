import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import { PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Key, type IKey } from 'aws-cdk-lib/aws-kms';
import type { Construct } from 'constructs';

/**
 * Encryption at rest (design doc §5.6; CRIS-25, ADR-0040).
 *
 * §5.6 asks for one thing by name — "contact data is KMS-encrypted" — but the
 * blast radius of a leaked report is wider than its contact field: the free-text
 * body routinely names an address, a school, or an injured person. So the whole
 * backend shares ONE customer-managed key (CMK) rather than relying on the
 * AWS-owned default keys, and the sensitive field gets a second, application-layer
 * pass on top of it (`security/contact.ts`).
 *
 * Why a customer-managed key at all, when AWS-owned keys already encrypt every
 * one of these services for free:
 *
 *   - **It is auditable.** CMK use shows up in CloudTrail as `kms:Decrypt` with
 *     the caller identity and encryption context. AWS-owned key use does not
 *     appear at all, so "who read the reports" has no answer.
 *   - **It is revocable.** Access to the plaintext can be cut by editing one key
 *     policy, without touching a table, a bucket, or a queue.
 *   - **It rotates on a schedule we own** (`enableKeyRotation`, annual).
 *
 * ONE key, not one per service, is a deliberate trade. Separate keys would let us
 * revoke media access without revoking report access, but nothing in the MVP
 * draws that boundary — the same responder roles read both — and each extra key
 * carries a monthly charge plus another policy to keep correct. Split the key when
 * a role genuinely needs one and not the other; that is a new ADR, not an edit.
 */

/**
 * Creates the backend's customer-managed key.
 *
 * Create it in the ROOT stack. Every nested stack (data, storage, function) then
 * receives the key ARN as a CloudFormation *parameter*, which is the direction
 * nested-stack references are free in. The reverse — a key in a nested stack that
 * the root or a sibling reads — would need an Output, and combined with the
 * root's existing dependency on those stacks it risks the same circular
 * dependency the pipeline resources already work around (ADR-0031).
 */
export function createDataKey(scope: Construct): Key {
  const stack = Stack.of(scope);

  return new Key(scope, 'CrisisMapDataKey', {
    description:
      'CrisisMap AI — encryption at rest for reports, report media, and the triage pipeline (CRIS-25).',
    // Annual rotation. Rotation re-keys new writes only; KMS keeps prior key
    // material so existing ciphertext stays readable with no re-encrypt step.
    enableKeyRotation: true,
    alias: `alias/${stack.stackName}-data`,
    // RETAIN, even though it strands a key after `ampx sandbox delete`.
    // Ciphertext outlives the stack: point-in-time-recovery backups (CRIS-25),
    // any bucket kept on delete, and CloudTrail-visible copies are all encrypted
    // with THIS key, and KMS cannot decrypt them once the key is gone. A stranded
    // $1/month key is recoverable; a deleted key is the permanent loss of every
    // report it protected. Sweep unused keys manually — docs/runbooks/deploy.md.
    removalPolicy: RemovalPolicy.RETAIN,
  });
}

/**
 * Lets CloudWatch publish alarm notifications to an SNS topic encrypted with
 * {@link createDataKey}'s key.
 *
 * Encrypting the ops topic silently breaks alarms without this. CloudWatch calls
 * `kms:GenerateDataKey*` under its OWN service principal, not the alarm owner's
 * identity, so no `grant*` on an IAM role can authorize it — it has to be a key
 * policy statement. The failure mode is the worst kind: `PutMetricAlarm` still
 * succeeds, the alarm still transitions to ALARM, and the notification is simply
 * dropped. Nothing pages, and the dashboard looks healthy.
 *
 * `aws:SourceAccount` pins the grant to this account so another account's alarms
 * cannot use our key (the standard confused-deputy guard for service principals).
 */
export function allowCloudWatchAlarmPublish(key: IKey): void {
  const stack = Stack.of(key);

  key.addToResourcePolicy(
    new PolicyStatement({
      sid: 'AllowCloudWatchAlarmsToPublishToEncryptedTopic',
      principals: [new ServicePrincipal('cloudwatch.amazonaws.com')],
      actions: ['kms:Decrypt', 'kms:GenerateDataKey*'],
      // KMS resource policies are attached to the key, so `*` IS this key.
      resources: ['*'],
      conditions: { StringEquals: { 'aws:SourceAccount': stack.account } },
    }),
  );
}
