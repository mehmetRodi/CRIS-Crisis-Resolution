import { toPublicReport, type RedactableReport } from '@crisismap/shared';
import type { Publisher } from './client';

export type PublishLog = (entry: Record<string, unknown>) => void;
export type PublisherFactory = () => Promise<Publisher>;

const PUBLISH_TIMEOUT_MS = 8_000;

const defaultPublisherFactory: PublisherFactory = async () => {
  const { createAppSyncPublisher } = await import('./client');
  return createAppSyncPublisher();
};

/** Best-effort fan-out after a direct DynamoDB report write has committed. */
export async function publishCommittedReportUpdate(
  report: RedactableReport,
  source: 'assignment' | 'transition',
  createPublisher: PublisherFactory = defaultPublisherFactory,
  log: PublishLog = (entry) => console.log(JSON.stringify(entry)),
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
      event: `${source}.publish.done`,
      reportId: projection.reportId,
      status: projection.status,
    });
  } catch (error) {
    log({
      event: `${source}.publish.failed`,
      reportId: projection.reportId,
      reason: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
