import type { SQSHandler } from 'aws-lambda';
import {
  canTransition,
  ReportStatus,
  scoreReport,
  shouldEscalateToVerification,
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
 *
 * Scoring is the deterministic §5.4.2 formula from `@crisismap/shared`
 * (`scoreReport`, ADR-0010); a low-confidence or model-flagged classification is
 * escalated to NEEDS_VERIFICATION (§2.6) while still recording the AI result.
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

/** Geocode seam. TODO(CRIS-13): call Amazon Location; derive geohash/geohashPrefix. */
function geocode(): LocationResult {
  return {};
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
  if (
    report.status !== ReportStatus.NEW ||
    !canTransition(report.status, ReportStatus.PROCESSING)
  ) {
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

  let classification;
  try {
    classification = await deps.classifier.classify(report.text);
  } catch (err) {
    // Bedrock/parse failure ⇒ NEEDS_VERIFICATION, never lost (§5.4.4).
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

  // Deterministic, explainable priority (§5.4.2, ADR-0010).
  const scoring = scoreReport({
    urgency: classification.urgency,
    category: classification.category,
  });
  // Low-confidence / model-flagged reports still record the AI result but are
  // routed to human review rather than surfacing as AI_CLASSIFIED (§2.6).
  const status = shouldEscalateToVerification(classification)
    ? ReportStatus.NEEDS_VERIFICATION
    : ReportStatus.AI_CLASSIFIED;

  await deps.store.persistClassification({
    reportId,
    claimedVersion,
    status,
    classification,
    priorityScore: scoring.priorityScore,
    priorityBand: scoring.priorityBand,
    scoreVersion: scoring.scoreVersion,
    scoreBreakdown: scoring.breakdown,
    location: geocode(), // stub (CRIS-13); dedupe likewise deferred.
    streamEventId,
  });

  // TODO(CRIS-19): call the IAM-only `publishReportUpdate` mutation so subscribed
  // clients update in near real time (§5.3). Durable write above is independent
  // of AppSync availability.
  log({ event: 'classify.done', reportId, band: scoring.priorityBand, status });
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
