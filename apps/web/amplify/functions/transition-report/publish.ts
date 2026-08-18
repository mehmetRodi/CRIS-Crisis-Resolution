import type { RedactableReport } from '@crisismap/shared';
import {
  publishCommittedReportUpdate,
  type PublishLog,
  type PublisherFactory,
} from '../publish-report-update/best-effort';

/**
 * Publish a committed human status transition without making AppSync part of
 * the durable transaction. Failures are structured-logged and swallowed: the
 * report and audit event have already committed, and clients reconcile on a
 * reconnect or manual refresh if this best-effort notification is unavailable.
 */
export async function publishTransitionUpdate(
  report: RedactableReport,
  createPublisher?: PublisherFactory,
  log?: PublishLog,
): Promise<void> {
  await publishCommittedReportUpdate(report, 'transition', createPublisher, log);
}
