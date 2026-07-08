import { a, defineData, type ClientSchema } from '@aws-amplify/backend';
import { classifyReport } from '../functions/classify-report/resource';

/**
 * GraphQL data model (AppSync + DynamoDB) — design doc §5.1–5.3, §5.6.
 *
 * CRIS-8 delivers the MVP data model: the Report system-of-record plus its
 * supporting entities, the six Report GSIs, geohash location fields, and a
 * SEPARATE `PublicReport` projection that guarantees reporter identity/contact
 * and internal notes can never leak to guest/public queries (§5.6, ADR-0006).
 *
 * SCOPE (what this file does NOT do):
 *   TODO(CRIS-9): `submitReport` / `publishReportUpdate` custom mutations,
 *     optimistic-lock (expectedVersion) conditional writes, and the writer that
 *     keeps `PublicReport` in sync with `Report`.
 *   CRIS-10 (done): DynamoDB Streams → SQS → Lambda pipeline populates the
 *     derived classification/priority fields and statusUpdatedAt. The worker's
 *     DURABLE write is direct-to-DynamoDB (§5.3, IAM granted in backend.ts); the
 *     `allow.resource(classifyReport)` grants below authorize the AppSync path
 *     used by the CRIS-9 `publishReportUpdate` notify mutation (ADR-0007). The
 *     stream, EventBridge Pipe, SQS+DLQ, and the TTL on IdempotencyRecord.expiresAt
 *     are wired in backend.ts.
 *   TODO(CRIS-11): classification JSON contract + deterministic scoring formula.
 *   TODO(CRIS-7): fine-grained `allow.owner()` ownership scoping and guest
 *     identity-pool wiring (guest rules below are inert until then).
 *
 * ENUM SYNC: `a.enum()` requires literal arrays, so enum values are duplicated
 * from `@crisismap/shared` (the source of truth). They MUST stay identical — the
 * "schema enum sync guard" test in packages/shared/src/domain.test.ts fails if
 * they drift. When you change an enum, update BOTH places.
 *
 * DERIVED KEY FIELDS: `geohashPrefix` (coarse geohash bucket) and
 * `statusUpdatedAt` exist only to satisfy DynamoDB GSI key constraints; they are
 * written by CRIS-9/CRIS-10 resolvers. Reports are absent from a GSI until its
 * key is populated (sparse index) — expected, not a bug (see ADR-0006).
 */
const schema = a.schema({
  /* ---------------------------------------------------------------------- */
  /* Embedded value objects                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * Explainable priority breakdown (§5.4.2) — the factors behind priorityScore
   * so the UI can show "why" a report ranked where it did. Embedded on Report;
   * inherits Report's authorization. Populated by CRIS-11 scoring.
   */
  ScoreBreakdown: a.customType({
    urgencyWeight: a.float(),
    categoryWeight: a.float(),
    recencyWeight: a.float(),
    corroborationWeight: a.float(),
    manualAdjustment: a.float(),
    notes: a.string(),
  }),

  /* ---------------------------------------------------------------------- */
  /* Report — system of record (§5.1, §5.2)                                  */
  /* ---------------------------------------------------------------------- */

  Report: a
    .model({
      // Identity & optimistic lock (§5.2). ULID is client-supplied by CRIS-9.
      id: a.id().required(),
      version: a.integer().required(),

      // Raw citizen/field input. Treated as UNTRUSTED in prompts (§5.6).
      rawText: a.string().required(),

      // Normalized classification (§2.2) — null until classified (CRIS-10/11).
      // `category` is stored as a string GSI key (see reportsByCategoryByPriority);
      // its allowed values are `@crisismap/shared` Category.
      category: a.string(),
      urgency: a.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
      classificationConfidence: a.float(),

      // Derived priority (§5.4.2) — written by CRIS-11.
      priorityScore: a.float(),
      priorityBand: a.enum(['P0', 'P1', 'P2', 'P3']),
      scoreVersion: a.integer(),
      scoreBreakdown: a.ref('ScoreBreakdown'),

      // Resolved location (§2.4, §5.2) — written by CRIS-10 geocode worker.
      latitude: a.float(),
      longitude: a.float(),
      geohash: a.string(), // precision-7 (~150 m)
      geohashPrefix: a.string(), // derived coarse bucket (~40 km), GSI partition key
      locationPrecision: a.enum(['EXACT', 'APPROXIMATE', 'REGION_ONLY', 'UNKNOWN']),
      regionId: a.id(),

      // Workflow (§5.1). `status` is a string GSI key; values are ReportStatus.
      status: a.string(),
      statusUpdatedAt: a.datetime(), // derived sort key for the status work-queue GSI
      duplicateGroupId: a.id(),
      assignedTeamId: a.id(),
      lastProcessedEventId: a.string(), // idempotency (§5.4.4)

      // PROTECTED reporter identity/contact + internal notes (§5.6). Field-level
      // authorization limits these to COORDINATOR/ADMIN; the PublicReport
      // projection omits them physically. reporterContact is KMS-encrypted
      // app-side and never placed in prompts or public views.
      reporterUserId: a.string().authorization((allow) => [allow.groups(['COORDINATOR', 'ADMIN'])]),
      reporterName: a.string().authorization((allow) => [allow.groups(['COORDINATOR', 'ADMIN'])]),
      reporterContact: a
        .string()
        .authorization((allow) => [allow.groups(['COORDINATOR', 'ADMIN'])]),
      internalNotes: a.string().authorization((allow) => [allow.groups(['COORDINATOR', 'ADMIN'])]),

      // Relations
      verifications: a.hasMany('Verification', 'reportId'),
      assignments: a.hasMany('Assignment', 'reportId'),
      events: a.hasMany('ReportEvent', 'reportId'),
      region: a.belongsTo('Region', 'regionId'),
      duplicateGroup: a.belongsTo('DuplicateGroup', 'duplicateGroupId'),
      assignedTeam: a.belongsTo('Team', 'assignedTeamId'),
    })
    .identifier(['id'])
    // Six GSIs for the §5.2 access patterns. Every partition/sort key must be a
    // top-level string/number field (enum/id/json/boolean are not index keys).
    .secondaryIndexes((index) => [
      index('regionId').sortKeys(['priorityScore']).name('reportsByRegionByPriority'),
      index('category').sortKeys(['priorityScore']).name('reportsByCategoryByPriority'),
      index('status').sortKeys(['statusUpdatedAt']).name('reportsByStatusByUpdated'),
      index('geohashPrefix').sortKeys(['geohash']).name('reportsByGeohashPrefix'),
      index('duplicateGroupId').sortKeys(['priorityScore']).name('reportsByDuplicateGroup'),
      index('assignedTeamId').sortKeys(['priorityScore']).name('reportsByTeam'),
    ])
    .authorization((allow) => [
      allow.groups(['RESPONDER', 'COORDINATOR', 'ADMIN']),
      allow.group('VOLUNTEER').to(['read']),
      allow.group('CITIZEN').to(['create']),
      // Anonymous submission (§2.1): guests may CREATE but never READ Report —
      // PII stays server-side; public map reads go through PublicReport.
      allow.guest().to(['create']),
      // CRIS-10: the classification worker reads the report and updates derived
      // fields via the pipeline (ADR-0007).
      allow.resource(classifyReport).to(['read', 'update']),
      // TODO(CRIS-7): allow.owner() so a citizen sees only their own report.
      // TODO(CRIS-9): direct create is superseded by the submitReport mutation.
    ]),

  /* ---------------------------------------------------------------------- */
  /* PublicReport — redacted projection for guests/public (§5.3, §5.6)       */
  /* ---------------------------------------------------------------------- */

  /**
   * SEPARATE table holding only non-sensitive fields (ADR-0006). Guests read
   * this; the sensitive `Report` table has no guest read at all, so reporter
   * identity/contact/internal notes cannot leak — they physically do not exist
   * here. Kept in sync with Report by CRIS-9 (submit) + CRIS-10 (pipeline);
   * dual-write drift is the documented, accepted MVP risk (ADR-0006).
   */
  PublicReport: a
    .model({
      id: a.id().required(), // mirrors the source reportId
      category: a.string(),
      urgency: a.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
      priorityScore: a.float(),
      priorityBand: a.enum(['P0', 'P1', 'P2', 'P3']),
      status: a.string(),
      latitude: a.float(),
      longitude: a.float(),
      geohash: a.string(),
      geohashPrefix: a.string(),
      regionId: a.id(),
      duplicateGroupId: a.id(),
      // NOTE: no rawText, no reporter*, no internalNotes — by construction.
    })
    .identifier(['id'])
    .secondaryIndexes((index) => [
      index('geohashPrefix').sortKeys(['geohash']).name('publicReportsByGeohashPrefix'),
      index('regionId').sortKeys(['priorityScore']).name('publicReportsByRegionByPriority'),
    ])
    .authorization((allow) => [
      allow.guest().to(['read']),
      allow.authenticated().to(['read']),
      allow.group('ADMIN'),
      // CRIS-10: the pipeline mirrors non-sensitive fields into this projection.
      allow.resource(classifyReport).to(['create', 'update']),
      // TODO(CRIS-9): submit-path mirror write also uses allow.resource(...).
    ]),

  /* ---------------------------------------------------------------------- */
  /* Supporting entities (§5.1) — one DynamoDB table each                    */
  /* ---------------------------------------------------------------------- */

  /** Independent verification signal on a report (§2.5, §2.6). */
  Verification: a
    .model({
      reportId: a.id().required(),
      report: a.belongsTo('Report', 'reportId'),
      verifierUserId: a.string(),
      status: a.enum(['PENDING', 'CONFIRMED', 'REJECTED', 'INCONCLUSIVE']),
      method: a.string(),
      note: a.string(),
    })
    .authorization((allow) => [
      allow.groups(['RESPONDER', 'COORDINATOR', 'ADMIN']),
      // TODO(CRIS-7): owner scoping so a verifier manages their own signals.
    ]),

  /** Group of reports believed to describe the same incident (§5.4.3). */
  DuplicateGroup: a
    .model({
      canonicalReportId: a.id(),
      status: a.enum(['OPEN', 'MERGED', 'DISMISSED']),
      memberCount: a.integer(),
      similarityNote: a.string(),
      reports: a.hasMany('Report', 'duplicateGroupId'),
    })
    .authorization((allow) => [
      allow.groups(['COORDINATOR', 'ADMIN']),
      allow.groups(['RESPONDER', 'VOLUNTEER']).to(['read']),
      // CRIS-10: the pipeline's dedupe step groups reports (dedupe logic itself
      // is a deferred stub; the grant is in place for when it lands).
      allow.resource(classifyReport).to(['create', 'update']),
    ]),

  /** Assignment of a response team to a report (§2.5, §5.1 dispatch). */
  Assignment: a
    .model({
      reportId: a.id().required(),
      teamId: a.id().required(),
      report: a.belongsTo('Report', 'reportId'),
      team: a.belongsTo('Team', 'teamId'),
      status: a.enum(['PROPOSED', 'ACCEPTED', 'EN_ROUTE', 'ON_SCENE', 'COMPLETED', 'CANCELLED']),
      assignedByUserId: a.string(),
      note: a.string(),
    })
    .authorization((allow) => [
      allow.groups(['COORDINATOR', 'ADMIN']),
      allow.groups(['RESPONDER', 'VOLUNTEER']).to(['read']),
      // TODO(CRIS-7): team-member ownership scoping.
    ]),

  /** A response team (§2.5). */
  Team: a
    .model({
      name: a.string().required(),
      regionId: a.id(),
      status: a.enum(['AVAILABLE', 'BUSY', 'OFFLINE']),
      region: a.belongsTo('Region', 'regionId'),
      assignments: a.hasMany('Assignment', 'teamId'),
      reports: a.hasMany('Report', 'assignedTeamId'),
    })
    .authorization((allow) => [
      allow.groups(['COORDINATOR', 'ADMIN']),
      allow.authenticated().to(['read']),
    ]),

  /** A user's proximity-alert subscription (§2.7). */
  AlertSubscription: a
    .model({
      subscriberUserId: a.string(),
      regionId: a.id(),
      channel: a.enum(['SMS', 'EMAIL', 'PUSH']),
      // Destination (phone/endpoint) is contact PII — kept out of public views.
      destination: a.string(),
      minPriorityBand: a.enum(['P0', 'P1', 'P2', 'P3']),
      status: a.enum(['ACTIVE', 'PAUSED', 'UNSUBSCRIBED']),
      deliveries: a.hasMany('AlertDelivery', 'subscriptionId'),
    })
    .authorization((allow) => [
      allow.group('ADMIN'),
      // TODO(CRIS-7): allow.owner() — this is the primary owner-scoped model;
      // a subscriber manages only their own subscriptions.
    ]),

  /** Record of a single alert send attempt (§5.4.4). */
  AlertDelivery: a
    .model({
      subscriptionId: a.id().required(),
      subscription: a.belongsTo('AlertSubscription', 'subscriptionId'),
      reportId: a.id(),
      channel: a.enum(['SMS', 'EMAIL', 'PUSH']),
      status: a.enum(['QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SUPPRESSED']),
      providerMessageId: a.string(),
      attemptedAt: a.datetime(),
    })
    .authorization((allow) => [
      allow.group('ADMIN').to(['read']),
      // TODO(CRIS-10): alert Lambda writes via allow.resource(alertFn) (IAM-only).
    ]),

  /** Immutable audit event appended on every report transition (§5.1). */
  ReportEvent: a
    .model({
      reportId: a.id().required(),
      report: a.belongsTo('Report', 'reportId'),
      eventType: a.enum([
        'SUBMITTED',
        'STATUS_CHANGED',
        'CLASSIFIED',
        'SCORED',
        'GEOCODED',
        'DEDUPED',
        'ASSIGNED',
        'VERIFIED',
        'ALERT_SENT',
        'NOTE_ADDED',
      ]),
      fromStatus: a.string(),
      toStatus: a.string(),
      actorUserId: a.string(),
      payload: a.json(),
      occurredAt: a.datetime(),
    })
    // Immutable: only read is granted to clients; no update/delete rules exist.
    .authorization((allow) => [
      allow.groups(['COORDINATOR', 'ADMIN']).to(['read']),
      // CRIS-10: the pipeline appends immutable CLASSIFIED/SCORED events.
      allow.resource(classifyReport).to(['create']),
      // TODO(CRIS-9): submit-path SUBMITTED event also appends via allow.resource.
    ]),

  /** A geographic region reports/teams belong to (§5.2). */
  Region: a
    .model({
      name: a.string().required(),
      geohashPrefixes: a.string().array(),
      reports: a.hasMany('Report', 'regionId'),
      teams: a.hasMany('Team', 'regionId'),
    })
    .authorization((allow) => [
      allow.guest().to(['read']),
      allow.authenticated().to(['read']),
      allow.group('ADMIN'),
    ]),

  /** Per-category display + scoring configuration (§2.4, §5.4.2). */
  CategoryConfig: a
    .model({
      category: a.enum([
        'MEDICAL',
        'RESCUE',
        'STRUCTURAL_DAMAGE',
        'FIRE',
        'FLOOD',
        'HAZMAT',
        'BLOCKED_ROAD',
        'SHELTER',
        'UTILITY',
        'OTHER',
      ]),
      displayName: a.string(),
      defaultUrgency: a.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
      baseWeight: a.float(),
      iconKey: a.string(),
      enabled: a.boolean(),
    })
    .authorization((allow) => [
      allow.guest().to(['read']),
      allow.authenticated().to(['read']),
      allow.group('ADMIN'),
    ]),

  /** End-to-end idempotency record for the async pipeline (§5.4.4). */
  IdempotencyRecord: a
    .model({
      reportId: a.id(),
      operation: a.string(),
      result: a.json(),
      // TTL attribute — TTL enablement is wired by CRIS-10 via CDK escape hatch.
      expiresAt: a.timestamp(),
    })
    // Internal only. ADMIN read for debugging; pipeline writes are IAM-only.
    .authorization((allow) => [
      allow.group('ADMIN').to(['read']),
      // CRIS-10: the pipeline reads/writes idempotency records (TTL on
      // expiresAt is enabled in backend.ts).
      allow.resource(classifyReport).to(['create', 'read', 'update']),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    // userPool for signed-in users; guest reads (PublicReport/Region/
    // CategoryConfig) resolve via the identity pool's unauthenticated role,
    // which CRIS-7 wires up. Pipeline (IAM) grants are wired via the
    // `allow.resource(classifyReport)` rules above (CRIS-10).
    defaultAuthorizationMode: 'userPool',
  },
  // Registering the function here lets `allow.resource(classifyReport)` resolve
  // the worker's IAM principal without a backend-level import cycle (the schema
  // imports only the function factory, never `backend`). See ADR-0007.
  functions: {
    classifyReport,
  },
});
