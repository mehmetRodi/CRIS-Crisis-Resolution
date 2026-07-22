import type { SQSHandler } from 'aws-lambda';
import {
  canTransition,
  ReportStatus,
  scoreReport,
  shouldEscalateToVerification,
} from '@crisismap/shared';
import { createBedrockClassifier } from './bedrock';
import { createBedrockTriageAgent, createTriageAgent, type TriageAgent } from './agent';
import { createNullGeocoder } from './geocode';
import { createDynamoStore, type ReportStore } from './store';

/**
 * classify-report worker (design doc §3, §5.4; CRIS-10).
 *
 * The per-record orchestration lives in `processRecord`, which depends only on
 * an injected {@link WorkerDeps} — so the claim/idempotency/failure control flow
 * is unit-tested with fakes (see handler.test.ts), while the exported `handler`
 * wires the real Bedrock + DynamoDB implementations from the environment.
 *
 * Classification is done by the Bedrock **Triage Agent** (§5.5, CRIS-20,
 * ADR-0026): a tool-using agent that extracts category/urgency/entities/summary
 * and resolves location via a geocoding tool, degrading to the MVP single-call
 * classifier when agent orchestration is unavailable. The worker is agnostic to
 * which path ran — it consumes a {@link TriageAgent}.
 *
 * Scoring is the deterministic §5.4.2 formula from `@crisismap/shared`
 * (`scoreReport`, ADR-0010) — the ranking authority, never a model opinion; a
 * low-confidence or model-flagged classification is escalated to
 * NEEDS_VERIFICATION (§2.6) while still recording the AI result.
 */

/** SQS payload projected by the EventBridge Pipe input transformer (IDs only, no PII). */
export interface ClassificationMessage {
  reportId: string;
  version: number;
  streamEventId: string;
}

export interface WorkerDeps {
  store: ReportStore;
  triage: TriageAgent;
  /** Structured-log sink; defaults to console. Override in tests. */
  log?: (entry: Record<string, unknown>) => void;
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

  let triage;
  try {
    triage = await deps.triage.triage(report.text);
  } catch (err) {
    // Triage failure (agent + fallback both failed contract validation) ⇒
    // NEEDS_VERIFICATION, never lost (§5.4.4).
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

  const { classification, location } = triage;

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
    // Location resolved by the Triage Agent's geocode tool (§5.5), or {} when it
    // stayed unresolved (GEOCODING_ENABLED=false until CRIS-21). Dedupe deferred.
    location: location ?? {},
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
  const modelId = env('BEDROCK_MODEL_ID');
  // TODO(CRIS-21): when GEOCODING_ENABLED=true, swap in the Amazon Location
  // place-index geocoder; the agent's geocode_location tool is wired regardless.
  const geocoder = createNullGeocoder();
  return {
    store: createDynamoStore({
      report: env('REPORT_TABLE_NAME'),
      reportEvent: env('REPORT_EVENT_TABLE_NAME'),
    }),
    // Tool-using Triage Agent (§5.5, CRIS-20), degrading to the MVP single-call
    // classifier (CRIS-10) when agent orchestration is unavailable.
    triage: createTriageAgent({
      primary: createBedrockTriageAgent({ modelId, geocoder }),
      fallback: createBedrockClassifier({ modelId }),
    }),
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
