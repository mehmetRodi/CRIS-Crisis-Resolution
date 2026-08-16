import { toPublicReport, type RedactableReport } from '@crisismap/shared';
import type { Publisher } from '../publish-report-update/client';

type Log = (entry: Record<string, unknown>) => void;
type PublisherFactory = () => Promise<Publisher>;
const PUBLISH_TIMEOUT_MS = 8_000;

const defaultPublisherFactory: PublisherFactory = async () => {
  const { createAppSyncPublisher } = await import('../publish-report-update/client');
  return createAppSyncPublisher();
};

/**
 * Publish a committed human status transition without making AppSync part of
 * the durable transaction. Failures are structured-logged and swallowed: the
 * report and audit event have already committed, and clients reconcile on a
 * reconnect or manual refresh if this best-effort notification is unavailable.
 */
export async function publishTransitionUpdate(
  report: RedactableReport,
  createPublisher: PublisherFactory = defaultPublisherFactory,
  log: Log = (entry) => console.log(JSON.stringify(entry)),
): Promise<void> {
  const projection = toPublicReport(report);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        const publisher = await createPublisher();
        await publisher.publishUpdate(projection);
      })(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('AppSync publish timed out')),
          PUBLISH_TIMEOUT_MS,
        );
      }),
    ]);
    log({
      event: 'transition.publish.done',
      reportId: projection.reportId,
      status: projection.status,
    });
  } catch (error) {
    log({
      event: 'transition.publish.failed',
      reportId: projection.reportId,
      reason: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
