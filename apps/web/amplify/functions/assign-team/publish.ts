import type { RedactableReport } from '@crisismap/shared';
import {
  publishCommittedReportUpdate,
  type PublishLog,
  type PublisherFactory,
} from '../publish-report-update/best-effort';

/** Notify CRIS-28 subscribers after the assignment transaction commits. */
export async function publishAssignmentUpdate(
  report: RedactableReport,
  createPublisher?: PublisherFactory,
  log?: PublishLog,
): Promise<void> {
  await publishCommittedReportUpdate(report, 'assignment', createPublisher, log);
}
