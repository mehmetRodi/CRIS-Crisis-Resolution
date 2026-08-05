# ADR-0043: Customer-managed key for the triage data plane

- **Status:** Accepted
- **Date:** 2026-08-05
- **Deciders:** Team (CRIS-25)
- **Relates to:** ADR-0013 (async pipeline), ADR-0015 (observability), ADR-0031
  (classify worker in the data stack)

## Context

The triage path crosses three SQS queues: the classification queue, its worker DLQ, and the
EventBridge Pipe DLQ. The first two intentionally carry report identifiers and trace metadata
only. The pipe DLQ is different: failed source records are raw DynamoDB stream images and can
therefore contain report text, reporter contact, and precise location data for up to 14 days.

SQS encrypts new queues by default with service-managed encryption, but CRIS-25 needs explicit
control over key rotation, revocation, and auditable KMS API use. The operations SNS topic watches
the same pipeline and also needs a defined encrypted-delivery policy. Amplify places pipeline
resources in the data nested stack to avoid the cycle described by ADR-0031.

This decision does not complete the design document's broader contact-data requirement. DynamoDB,
S3 report media, and application-layer field encryption have different access and lifecycle
boundaries and need explicit follow-up rather than being implied by pipeline encryption.

## Options considered

- **Keep service-managed encryption** — lowest cost and policy surface, but no customer-controlled
  revocation or key rotation and less useful KMS audit visibility.
- **Create one customer-managed key per queue/topic** — maximizes isolation, but adds cost and four
  policies without a corresponding difference in administrators or operational ownership.
- **Share one customer-managed key across the triage queues and operations topic** — one policy and
  rotation lifecycle for resources in the same operational trust boundary.
- **Extend the same key immediately to DynamoDB and S3** — superficially simple, but silently joins
  distinct responder/media/report trust boundaries and increases nested-stack dependency risk.

## Decision

Create one symmetric customer-managed KMS key in the Amplify root stack and use it for:

1. the classification queue;
2. the classification worker DLQ;
3. the EventBridge Pipe DLQ; and
4. the operations SNS alarm topic.

Enable annual rotation and retain the key on CloudFormation deletion or replacement. Root-stack
placement lets the data nested stack consume the key ARN as a downward parameter and avoids a
child-to-parent CloudFormation reference.

Queue producers and consumers receive KMS permissions through the CDK queue grants. The encrypted
alarm path has three explicit policy edges:

- CloudWatch can publish to the SNS topic, scoped to same-account alarm ARNs;
- CloudWatch can use the KMS key while publishing, with the same account/alarm constraints; and
- SNS can encrypt and decrypt topic messages, scoped by the SNS topic encryption context to this
  account and Region.

KMS events show data-key operations in CloudTrail; they are not treated as per-message access logs
because AWS services cache and reuse data keys.

## Tradeoffs & consequences

- A failure of this one key affects all three queues and alarm delivery. This is accepted because
  they share one operational boundary; a future split requires a new ADR.
- Customer-managed KMS requests and the retained key incur AWS charges.
- Retention protects still-live ciphertext when an update replaces the key, but deleting a sandbox
  can strand the key. The deploy runbook includes identification and scheduled-deletion checks.
- DynamoDB tables and S3 media retain their existing service-managed encryption. Field-level
  reporter-contact encryption remains a separate security-hardening seam and must not be claimed as
  implemented by this ADR.
- Infrastructure tests assert rotation/retention and all CloudWatch, SNS, and KMS policy edges so a
  type-correct but undeliverable encrypted alarm topic cannot regress silently.
