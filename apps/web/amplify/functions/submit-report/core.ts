/**
 * submitReport — pure business logic (design doc §3, §5.3, §5.4.4).
 *
 * This module is deliberately free of AWS SDK / Lambda imports so it can be unit
 * tested in isolation (docs/conventions.md → Testing: the safety-critical write
 * path must be tested). The handler (`handler.ts`) injects ids/time and performs
 * the actual conditional DynamoDB writes the plan describes.
 *
 * The write path must be fast and durable: a report is acknowledged as `NEW` in
 * p95 < 800 ms and is never lost thereafter (§3.2). AI classification runs later,
 * asynchronously, off the DynamoDB stream (§5.4.1).
 */
import {
  REPORT_SUBMIT_VALIDATION_PREFIX,
  ReportEventType,
  ReportStatus,
  UserRole,
  type ReportEventType as ReportEventTypeT,
  type ReportStatus as ReportStatusT,
} from '@crisismap/shared';

/** Bounds for the free-text report body. Untrusted input (§5.6). */
export const MIN_TEXT_LENGTH = 1;
export const MAX_TEXT_LENGTH = 5000;
export const MAX_MEDIA_KEYS = 10;

/** Arguments accepted by the `submitReport` mutation (see data/resource.ts). */
export interface SubmitReportInput {
  text: string;
  /** Client-generated idempotency token — dedupes retried submissions (§5.4.4). */
  clientRequestId: string;
  lat?: number | null;
  lng?: number | null;
  regionId?: string | null;
  isAnonymous?: boolean | null;
  /** Optional contact; KMS-encrypted at rest, never public/prompted (§5.6). */
  reporterContact?: string | null;
  mediaKeys?: string[] | null;
  /**
   * Cognito sub of the authenticated reporter, resolved by the handler from the
   * request identity — NEVER trusted from client arguments.
   */
  reporterId?: string | null;
}

/** Deterministic inputs the handler supplies so the plan is pure/testable. */
export interface SubmitContext {
  /** ULID primary key for the new report (time-sortable). */
  reportId: string;
  /** Immutable id for the SUBMITTED audit event (§5.4.4). */
  eventId: string;
  /** ISO-8601 timestamp used for createdAt across the transaction. */
  now: string;
}

/** The `Report` item written to DynamoDB. Shape mirrors the Report model. */
export interface ReportRecord {
  id: string;
  text: string;
  status: ReportStatusT;
  version: number;
  isAnonymous: boolean;
  createdAt: string;
  /**
   * Amplify auto-adds a non-nullable `updatedAt` to every model and populates it
   * in its own resolvers. Our custom resolver bypasses that, so we set it
   * explicitly — otherwise GraphQL can't serialize the returned/read item.
   */
  updatedAt: string;
  lat: number | null;
  lng: number | null;
  regionId: string | null;
  reporterId: string | null;
  reporterContact: string | null;
  mediaKeys: string[];
}

/** The immutable `ReportEvent` item written alongside the report. */
export interface ReportEventRecord {
  id: string;
  reportId: string;
  eventId: string;
  type: ReportEventTypeT;
  toStatus: ReportStatusT;
  actorId: string;
  actorRole: string | null;
  version: number;
  createdAt: string;
  /** Non-nullable Amplify-managed field; set explicitly (see ReportRecord). */
  updatedAt: string;
}

/** The idempotency guard item, keyed by the client request id (§5.4.4). */
export interface IdempotencyRecord {
  id: string;
  idempotencyKey: string;
  reportId: string;
  /** Unix-seconds TTL; DynamoDB expires stale keys automatically. */
  expiresAt: number;
  /** Non-nullable Amplify-managed fields; set explicitly (see ReportRecord). */
  createdAt: string;
  updatedAt: string;
}

/** A fully-described, atomically-writable submission. */
export interface SubmitPlan {
  report: ReportRecord;
  event: ReportEventRecord;
  idempotency: IdempotencyRecord;
}

export class SubmitValidationError extends Error {
  constructor(message: string) {
    super(`${REPORT_SUBMIT_VALIDATION_PREFIX} ${message}`);
    this.name = 'SubmitValidationError';
  }
}

/** Idempotency keys live for 24h — long enough to absorb client retries. */
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/**
 * Validate raw mutation arguments. Throws `SubmitValidationError` on the first
 * problem so the resolver can surface a stable, machine-readable message.
 */
export function validateSubmitInput(input: SubmitReportInput): void {
  const text = (input.text ?? '').trim();
  if (text.length < MIN_TEXT_LENGTH) {
    throw new SubmitValidationError('Report text is required.');
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new SubmitValidationError(`Report text exceeds ${MAX_TEXT_LENGTH} characters.`);
  }
  if (!input.clientRequestId || input.clientRequestId.trim().length === 0) {
    throw new SubmitValidationError('clientRequestId is required for idempotency.');
  }
  const hasLat = input.lat !== undefined && input.lat !== null;
  const hasLng = input.lng !== undefined && input.lng !== null;
  if (hasLat !== hasLng) {
    throw new SubmitValidationError('lat and lng must be provided together.');
  }
  if (hasLat && (input.lat! < -90 || input.lat! > 90)) {
    throw new SubmitValidationError('lat must be within [-90, 90].');
  }
  if (hasLng && (input.lng! < -180 || input.lng! > 180)) {
    throw new SubmitValidationError('lng must be within [-180, 180].');
  }
  if (input.mediaKeys && input.mediaKeys.length > MAX_MEDIA_KEYS) {
    throw new SubmitValidationError(`At most ${MAX_MEDIA_KEYS} media items are allowed.`);
  }
}

/**
 * Build the initial `Report` record. Always starts at `NEW` / `version = 1`
 * (§5.1). For anonymous submissions, reporter identity and contact are dropped
 * entirely — "no contact info kept" (§2.1, §5.6) — regardless of what the client
 * sent.
 */
export function buildInitialReport(input: SubmitReportInput, ctx: SubmitContext): ReportRecord {
  const anonymous = input.isAnonymous === true;
  return {
    id: ctx.reportId,
    text: input.text.trim(),
    status: ReportStatus.NEW,
    version: 1,
    isAnonymous: anonymous,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    regionId: input.regionId ?? null,
    reporterId: anonymous ? null : (input.reporterId ?? null),
    reporterContact: anonymous ? null : (input.reporterContact ?? null),
    mediaKeys: input.mediaKeys ?? [],
  };
}

/** Build the immutable SUBMITTED audit event that opens the report timeline. */
export function buildSubmitEvent(report: ReportRecord, ctx: SubmitContext): ReportEventRecord {
  return {
    id: ctx.eventId,
    reportId: report.id,
    eventId: ctx.eventId,
    type: ReportEventType.SUBMITTED,
    toStatus: ReportStatus.NEW,
    actorId: report.reporterId ?? 'ANONYMOUS',
    actorRole: report.reporterId ? UserRole.CITIZEN : null,
    version: report.version,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
}

/**
 * Compose the full, atomically-writable plan: the idempotency guard, the new
 * report, and its opening audit event. The handler writes all three in a single
 * DynamoDB transaction, each guarded by an `attribute_not_exists` condition, so
 * a retried `clientRequestId` cannot create a duplicate report.
 */
export function buildSubmitPlan(input: SubmitReportInput, ctx: SubmitContext): SubmitPlan {
  validateSubmitInput(input);
  const report = buildInitialReport(input, ctx);
  const event = buildSubmitEvent(report, ctx);
  const idempotency: IdempotencyRecord = {
    id: input.clientRequestId,
    idempotencyKey: input.clientRequestId,
    reportId: report.id,
    expiresAt: Math.floor(Date.parse(ctx.now) / 1000) + IDEMPOTENCY_TTL_SECONDS,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  return { report, event, idempotency };
}

/**
 * Prepare a record for a DynamoDB write by dropping `null`/`undefined` attributes.
 *
 * DynamoDB rejects a NULL-typed value on any index key, and the `Report` table
 * indexes several attributes (`regionId`, `category`, `geohashPrefix`,
 * `priorityScore`, `geohash`, `duplicateGroupId`, `assignedTeamId`) that are
 * genuinely unset at submit time — the geocode/classification pipeline fills them
 * in later (§5.4). Omitting an attribute is the correct representation of "not set
 * yet"; a later update adds it. This does NOT change the API contract: the
 * mutation returns the full in-memory record (nulls included), only the persisted
 * item is trimmed.
 */
export function forDynamoItem<T extends object>(item: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(item).filter(([, value]) => value !== null && value !== undefined),
  ) as Partial<T>;
}
