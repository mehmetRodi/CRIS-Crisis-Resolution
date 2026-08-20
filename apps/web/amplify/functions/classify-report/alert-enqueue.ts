import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import {
  ALERT_TRIGGER_BANDS,
  ReportStatus,
  type AlertCandidate,
  type PriorityBand,
} from '@crisismap/shared';

/**
 * Enqueues threshold-crossing classifications onto the proximity-alert queue
 * (design doc §2.7, §5, Fig 10; CRIS-34). Mirrors `dedupe.ts`'s split: a pure
 * decision (`shouldAlert`) plus a thin I/O wrapper (`enqueueAlert`), called as
 * a best-effort step from `handler.ts` the same way `groupDuplicates` is —
 * the classification is already durable, so a failure here must never
 * re-drive the SQS message.
 *
 * The enqueued message carries only the PII-free fields `AlertCandidate`
 * needs (no report text, no reporter data) — the same "no PII crosses this
 * hop" discipline already applied to the classification queue's own
 * EventBridge Pipe payload.
 */

/**
 * Only a human-confirmed classification (`AI_CLASSIFIED`, never
 * `NEEDS_VERIFICATION`) at P0/P1 triggers an alert — the system doesn't alert
 * the public off a report it isn't confident enough in to skip human review.
 */
export function shouldAlert(status: string, priorityBand: PriorityBand): boolean {
  return status === ReportStatus.AI_CLASSIFIED && ALERT_TRIGGER_BANDS.includes(priorityBand);
}

export interface AlertQueueClient {
  send(candidate: AlertCandidate): Promise<void>;
}

export function createSqsAlertQueueClient(queueUrl: string, client?: SQSClient): AlertQueueClient {
  const sqs = client ?? new SQSClient({});
  return {
    async send(candidate) {
      await sqs.send(
        new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(candidate) }),
      );
    },
  };
}
