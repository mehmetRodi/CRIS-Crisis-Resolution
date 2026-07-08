import type { SQSHandler } from 'aws-lambda';
import {
  canTransition,
  LocationPrecision,
  priorityBandForScore,
  ReportStatus,
  Urgency,
  type ClassificationResult,
} from '@crisismap/shared';
import { createBedrockClassifier, type Classifier } from './bedrock';
import { createDynamoStore, type LocationResult, type ReportStore } from './store';

/**
 * classify-report worker (design doc §3, §5.4; CRIS-10).
 *
 * The per-record orchestration lives in `processRecord`, which depends only on
 * an injected {@link WorkerDeps} — so the claim/idempotency/failure control flow
 * is unit-tested with fakes (see handler.test.ts), while the exported `handler`
 * wires the real Bedrock + DynamoDB implementations from the environment.
 */

/** SQS payload projected by the EventBridge Pipe input transformer (IDs only, no PII). */
export interface ClassificationMessage {
  reportId: string;
  version: number;
  streamEventId: string;
}

export interface WorkerDeps {
  store: ReportStore;
  classifier: Classifier;
  /** Structured-log sink; defaults to console. Override in tests. */
  log?: (entry: Record<string, unknown>) => void;
}

/** Urgency → provisional score. TODO(CRIS-11): replace with the §5.4.2 formula. */
const URGENCY_SCORE: Record<string, number> = {
  [Urgency.CRITICAL]: 9,
  [Urgency.HIGH]: 7,
  [Urgency.MEDIUM]: 4,
  [Urgency.LOW]: 1,
};

/**
 * Provisional deterministic score (§5.4.2). CRIS-10 delivers only an
 * urgency-based placeholder so the map/board have something to rank on; the
 * authoritative weighted formula + `scoreBreakdown` is CRIS-11. `scoreVersion`
 * 0 marks the result as provisional.
 */
function provisionalScore(c: ClassificationResult): { score: number; band: string } {
  const score = URGENCY_SCORE[c.urgency] ?? 0;
  return { score, band: priorityBandForScore(score) };
}

/** Geocode seam. TODO(CRIS-13): call Amazon Location; derive geohash/geohashPrefix. */
function geocode(): LocationResult {
  return { locationPrecision: LocationPrecision.UNKNOWN };
}

/** Parses the SQS body into a validated message, or null if malformed (poison). */
export function parseMessage(body: string): ClassificationMessage | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const { reportId, version, streamEventId } = raw as Record<string, unknown>;
  // The pipe projects DynamoDB's numeric `version` as a string (stream N type).
  const versionNum = typeof version === 'string' ? Number(version) : version;
  if (
    typeof reportId !== 'string' ||
    typeof streamEventId !== 'string' ||
    typeof versionNum !== 'number' ||
    Number.isNaN(versionNum)
  ) {
    return null;
  }
  return { reportId, version: versionNum, streamEventId };
}

/**
 * Processes one classification message end to end. Idempotent and version-safe:
 * a duplicate delivery, a lost claim race, or an already-processed report is a
 * no-op success. A classification failure lands the report in
 * NEEDS_VERIFICATION (never lost, §5.4.4); infra errors propagate so SQS
 * retries and, after `maxReceiveCount`, routes to the DLQ.
 */
export async function processRecord(
  deps: WorkerDeps,
  message: ClassificationMessage,
): Promise<void> {
  const log = deps.log ?? ((entry) => console.log(JSON.stringify(entry)));
  const { reportId, streamEventId } = message;

  const report = await deps.store.getReport(reportId);
  if (!report) {
    log({ event: 'report.missing', reportId, streamEventId });
    return;
  }

  // Idempotency (§5.4.4): this stream event already applied.
  if (report.lastProcessedEventId === streamEventId) {
    log({ event: 'classify.skip.duplicate', reportId, streamEventId });
    return;
  }

  // Only NEW reports are classifiable; anything else was already claimed/handled.
  if (report.status !== ReportStatus.NEW || !canTransition(report.status, ReportStatus.PROCESSING)) {
    log({ event: 'classify.skip.status', reportId, status: report.status });
    return;
  }

  // Claim NEW → PROCESSING via optimistic lock (§5.1/§5.2).
  const claimed = await deps.store.claimProcessing(reportId, report.version);
  if (!claimed) {
    log({ event: 'classify.skip.raceLost', reportId });
    return;
  }
  const claimedVersion = report.version + 1;

  let result: { classification: ClassificationResult; score: number; band: string; location: LocationResult };
  try {
    const classification = await deps.classifier.classify(report.rawText);
    const { score, band } = provisionalScore(classification);
    const location = geocode(); // stub (CRIS-13); dedupe likewise deferred.
    result = { classification, score, band, location };
  } catch (err) {
    // Bedrock/geocode failure ⇒ NEEDS_VERIFICATION, never lost (§5.4.4).
    log({
      event: 'classify.failed',
      reportId,
      reason: err instanceof Error ? err.message : String(err),
    });
    await deps.store.markNeedsVerification({
      reportId,
      claimedVersion,
      reason: 'classification_failed',
      streamEventId,
    });
    return;
  }

  await deps.store.persistClassification({
    reportId,
    claimedVersion,
    classification: result.classification,
    priorityScore: result.score,
    priorityBand: result.band,
    scoreVersion: 0, // provisional (CRIS-11)
    location: result.location,
    streamEventId,
  });

  // TODO(CRIS-9): call the IAM-only `publishReportUpdate` mutation so subscribed
  // clients update in near real time (§5.3). Durable write above is independent
  // of AppSync availability.
  log({ event: 'classify.done', reportId, band: result.band });
}

function buildDeps(): WorkerDeps {
  const env = (key: string): string => {
    const value = process.env[key];
    if (!value) throw new Error(`missing required env var: ${key}`);
    return value;
  };
  return {
    store: createDynamoStore({
      report: env('REPORT_TABLE_NAME'),
      publicReport: env('PUBLIC_REPORT_TABLE_NAME'),
      reportEvent: env('REPORT_EVENT_TABLE_NAME'),
    }),
    classifier: createBedrockClassifier({ modelId: env('BEDROCK_MODEL_ID') }),
  };
}

/**
 * SQS entry point. Returns partial-batch failures so one poison/failed record
 * doesn't fail the whole batch (paired with `reportBatchItemFailures: true` on
 * the event-source mapping). A message that can't be parsed is reported as a
 * failure so it retries and ultimately lands in the DLQ.
 */
export const handler: SQSHandler = async (event) => {
  const deps = buildDeps();
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      const message = parseMessage(record.body);
      if (!message) throw new Error('unparseable message');
      await processRecord(deps, message);
    } catch (err) {
      console.log(
        JSON.stringify({
          event: 'classify.record.error',
          messageId: record.messageId,
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
