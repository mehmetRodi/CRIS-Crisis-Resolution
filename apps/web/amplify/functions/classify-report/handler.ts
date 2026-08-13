import type { SQSHandler } from 'aws-lambda';
import {
  canTransition,
  ReportStatus,
  scoreReport,
  shouldEscalateToVerification,
  toPublicReport,
  type PublicReport,
} from '@crisismap/shared';
import { createBedrockClassifier } from './bedrock';
import { createBedrockTriageAgent, createTriageAgent, type TriageAgent } from './agent';
import { createAmazonLocationGeocoder, createNullGeocoder, type Geocoder } from './geocode';
import { createDynamoStore, type ReportStore } from './store';
import { resolveDuplicates, type DedupeInput, type DedupeResult } from './dedupe';
import type { Publisher } from './publish';

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
 *
 * After the durable write, the worker fans the redacted `PublicReport` out via
 * `publishReportUpdate` over the worker's IAM grant (§5.3, CRIS-19,
 * ADR-0009/0029/0030) so subscribers update in near real time — a best-effort call
 * (an injected {@link Publisher}) that never rolls back the durable write. The
 * subscriptions that consume it are enabled in CRIS-28.
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
  /** Fans the redacted result out to AppSync subscribers after the durable write (CRIS-19). */
  publisher: Publisher;
  /** Structured-log sink; defaults to console. Override in tests. */
  log?: (entry: Record<string, unknown>) => void;
  /**
   * Duplicate grouping (§5.4.3, CRIS-31). Defaults to the real
   * {@link resolveDuplicates} over `store`; overridden in tests. Not optional in
   * behaviour — only in wiring, so production can never forget to enable it.
   */
  dedupe?: (input: DedupeInput) => Promise<DedupeResult>;
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
 * Fan the redacted projection out to subscribers (§5.3, CRIS-19) — best-effort.
 * The durable DynamoDB write has already committed, so a publish failure must
 * NOT propagate: throwing would re-drive the SQS message and reprocess an
 * already-classified report (wasteful, and eventually DLQ). Subscribers instead
 * reconcile on their next read/refetch. `toPublicReport` builds the payload from
 * the `PUBLIC_REPORT_FIELDS` allow-list, so no PII can leak onto this channel.
 */
async function publishUpdate(
  deps: WorkerDeps,
  report: PublicReport,
  log: (entry: Record<string, unknown>) => void,
): Promise<void> {
  try {
    await deps.publisher.publishUpdate(report);
    log({ event: 'publish.done', reportId: report.reportId, status: report.status });
  } catch (err) {
    log({
      event: 'publish.failed',
      reportId: report.reportId,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Group this report with near-duplicates (§5.4.3, CRIS-31) — best-effort, for
 * the same reason as {@link publishUpdate}: the classification is already
 * durable, and grouping is an advisory pointer for coordinators. A dedup failure
 * must not re-drive the SQS message and reclassify an already-classified report,
 * so it is logged and swallowed.
 */
async function groupDuplicates(
  deps: WorkerDeps,
  input: DedupeInput,
  log: (entry: Record<string, unknown>) => void,
): Promise<void> {
  const dedupe =
    deps.dedupe ?? ((i: DedupeInput) => resolveDuplicates({ store: deps.store, log }, i));
  try {
    await dedupe(input);
  } catch (err) {
    log({
      event: 'dedupe.failed',
      reportId: input.reportId,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
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
    // Still fan out: a report awaiting human review is exactly what coordinators
    // need to see promptly. No classification ran, so the projection carries only
    // the status + location context that already existed.
    await publishUpdate(
      deps,
      toPublicReport({
        id: reportId,
        status: ReportStatus.NEEDS_VERIFICATION,
        regionId: report.regionId,
        createdAt: report.createdAt,
        updatedAt: new Date().toISOString(),
      }),
      log,
    );
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
    // Location resolved by the Triage Agent's geocode tool (Amazon Location,
    // §5.5/CRIS-21), or {} when it stayed unresolved (no place matched, a weak
    // match, geocoding disabled/unavailable). Duplicate grouping runs after this
    // durable classification write.
    location: location ?? {},
    streamEventId,
  });

  // Conservative duplicate grouping (§5.4.3, CRIS-31). After the durable write,
  // so a dedup failure can never cost a classification.
  await groupDuplicates(
    deps,
    {
      reportId,
      version: claimedVersion + 1,
      geohashPrefix: location?.geohashPrefix,
      now: new Date().toISOString(),
      streamEventId,
      subject: {
        category: classification.category,
        lat: location?.lat,
        lng: location?.lng,
        createdAt: report.createdAt ?? new Date().toISOString(),
        text: report.text,
        entities: classification.entities,
      },
    },
    log,
  );

  // Fan the redacted result out to subscribers (§5.3, CRIS-19). The durable
  // write above already committed, so this is best-effort. The custom
  // subscriptions that consume `publishReportUpdate` are enabled in CRIS-28.
  await publishUpdate(
    deps,
    toPublicReport({
      id: reportId,
      status,
      category: classification.category,
      urgency: classification.urgency,
      priorityScore: scoring.priorityScore,
      priorityBand: scoring.priorityBand,
      summary: classification.summary,
      lat: location?.lat,
      lng: location?.lng,
      geohash: location?.geohash,
      geohashPrefix: location?.geohashPrefix,
      regionId: report.regionId,
      createdAt: report.createdAt,
      updatedAt: new Date().toISOString(),
    }),
    log,
  );
  log({ event: 'classify.done', reportId, band: scoring.priorityBand, status });
}

async function buildDeps(): Promise<WorkerDeps> {
  const env = (key: string): string => {
    const value = process.env[key];
    if (!value) throw new Error(`missing required env var: ${key}`);
    return value;
  };
  const modelId = env('BEDROCK_MODEL_ID');
  // Dynamically imported so the AppSync/Amplify client (and its transitive deps)
  // stays out of the unit-test import graph — processRecord is tested with an
  // injected fake Publisher and never calls buildDeps().
  const { createAppSyncPublisher } = await import('./publish');
  // The agent's geocode_location tool is wired regardless; the flag chooses what
  // backs it (CRIS-21, ADR-0027). When off, every lookup returns "unavailable"
  // and reports stay unlocated — the tool-use path still runs.
  const geocoder: Geocoder =
    process.env.GEOCODING_ENABLED === 'true'
      ? createAmazonLocationGeocoder()
      : createNullGeocoder();
  return {
    store: createDynamoStore({
      report: env('REPORT_TABLE_NAME'),
      reportEvent: env('REPORT_EVENT_TABLE_NAME'),
      // Physical name of the geohashPrefix/geohash GSI, injected by backend.ts
      // rather than guessed — see DynamoStoreTables.geoIndex (CRIS-31).
      geoIndex: env('REPORT_GEO_INDEX_NAME'),
    }),
    // Tool-using Triage Agent (§5.5, CRIS-20), degrading to the MVP single-call
    // classifier (CRIS-10) when agent orchestration is unavailable.
    triage: createTriageAgent({
      primary: createBedrockTriageAgent({ modelId, geocoder }),
      fallback: createBedrockClassifier({ modelId }),
    }),
    // Worker IAM fan-out to `publishReportUpdate` (CRIS-19, ADR-0009/0029/0030).
    publisher: createAppSyncPublisher(),
  };
}

/**
 * SQS entry point. Returns partial-batch failures so one poison/failed record
 * doesn't fail the whole batch (paired with `reportBatchItemFailures: true` on
 * the event-source mapping). A message that can't be parsed is reported as a
 * failure so it retries and ultimately lands in the DLQ.
 */
export const handler: SQSHandler = async (event) => {
  const deps = await buildDeps();
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
