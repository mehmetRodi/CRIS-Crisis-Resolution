import { a, defineData, type ClientSchema } from '@aws-amplify/backend';
import { submitReport as submitReportFn } from '../functions/submit-report/resource';
import { transitionReport as transitionReportFn } from '../functions/transition-report/resource';
import { publishReportUpdate as publishReportUpdateFn } from '../functions/publish-report-update/resource';

/**
 * GraphQL data model (AppSync + DynamoDB) — design doc §5.1, §5.2, §5.3.
 *
 * CRIS-8 — the MVP DynamoDB data model. DynamoDB is the system of record, one
 * table per entity (each `a.model()` below maps to its own on-demand table),
 * built to burst with disaster traffic (§5.2).
 *
 * The central `Report` table is keyed by a `reportId` ULID (Amplify's `id`),
 * carries an optimistic-lock `version`, the normalized classification, the
 * derived `priorityScore`/`priorityBand`, and the resolved location
 * (lat/long + precision-7 `geohash` + `regionId`). Six GSIs serve the main
 * access patterns (§5.2): region dashboard by priority, category filter, status
 * work-queues, map-viewport by geohash, duplicate-group lookup, and team task
 * board.
 *
 * Custom API status:
 *   - `submitReport` implements the guarded, idempotent create path (CRIS-9).
 *   - `updateReportStatus` implements the guarded transition engine (CRIS-18).
 *   - `PublicReport` and `publishReportUpdate` are defined, but worker IAM
 *     authorization, worker invocation, and custom subscriptions remain deferred.
 *
 * ENUM SYNC: `a.enum()` requires literal arrays, so the members below are
 * duplicated from `@crisismap/shared` (the source of truth). When you change an
 * enum there, update the matching `a.enum([...])` here in the same PR
 * (docs/conventions.md → Domain vocabulary).
 *
 * AUTH: model-level rules below are coarse role gates for the data model. The
 * resolver-layer guarantees the design depends on — ownership/region/version
 * checks, prompt-safe redaction, and the public projection — must be enforced by
 * custom resolvers, not inferred from these rules alone. Generated model
 * operations still coexist with the guarded mutations pending auth hardening.
 */
const schema = a.schema({
  /* ---------------------------------------------------------------------- */
  /* Report — system of record (§5.1, §5.2)                                  */
  /* ---------------------------------------------------------------------- */
  Report: a
    .model({
      // Free-text citizen/field report. Treated as UNTRUSTED in prompts (§5.6).
      text: a.string().required(),

      // Lifecycle state (§5.1). Transitions are guarded in CRIS-18, never here.
      status: a.enum([
        'NEW',
        'PROCESSING',
        'AI_CLASSIFIED',
        'NEEDS_VERIFICATION',
        'VERIFIED',
        'IN_PROGRESS',
        'RESOLVED',
        'REJECTED',
      ]),

      // --- Normalized classification (§5.4.1). Null until AI_CLASSIFIED. -----
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
      urgency: a.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
      /** Model confidence in [0,1]. Low confidence routes to NEEDS_VERIFICATION. */
      confidence: a.float(),
      /**
       * Entities extracted by the Bedrock Triage Agent (§2.2, CRIS-20):
       * peopleAffected + infrastructure/hazards. Coordinator-internal triage
       * context (design doc Fig 2) — intentionally NOT projected to PublicReport.
       */
      entities: a.json(),

      // --- Deterministic priority (§5.4.2). Never raw model output. ----------
      priorityScore: a.float(),
      priorityBand: a.enum(['P0', 'P1', 'P2', 'P3']),
      /** Version of the scoring formula used, so scores stay explainable. */
      scoreVersion: a.integer(),
      /** Per-factor breakdown (U,C,A,V,R,D,S) the UI shows to justify the rank. */
      scoreBreakdown: a.json(),

      // --- Resolved location (§5.2). Set by the geocode step. ----------------
      lat: a.float(),
      lng: a.float(),
      /** Precision-7 geohash (~153 m cell). Sort key of the map-viewport GSI. */
      geohash: a.string(),
      /** Coarser prefix (precision-5) partitioning viewport queries into cells. */
      geohashPrefix: a.string(),
      regionId: a.id(),

      // --- Routing / dedup pointers ------------------------------------------
      /** Set when a team is assigned; partition key of the team task-board GSI. */
      assignedTeamId: a.id(),
      /** Set when grouped with near-duplicates (§5.4.3). Never auto-deleted. */
      duplicateGroupId: a.id(),

      // --- Reporter & media (PII-sensitive; kept out of PublicReport) --------
      /** Cognito sub of the reporter, or null for anonymous submissions (§2.1). */
      reporterId: a.string(),
      isAnonymous: a.boolean(),
      /**
       * Optional reporter contact. KMS-encrypted at rest, excluded from prompts
       * and every public projection (§5.6). NEVER select this into PublicReport.
       */
      reporterContact: a.string(),
      /** S3 object keys for uploaded media (§4 media storage). */
      mediaKeys: a.string().array(),

      // --- Concurrency & idempotency -----------------------------------------
      /** Optimistic-lock version. Every mutation requires expectedVersion (§5.3). */
      version: a.integer().required(),
      /** Last classification event applied — idempotent reprocessing (§5.4.1). */
      lastProcessedEventId: a.string(),

      // Explicit timestamp so GSIs can sort by recency (Amplify's implicit
      // createdAt is not index-eligible). System-managed; kept in sync on write.
      createdAt: a.datetime(),
    })
    .secondaryIndexes((index) => [
      // 1) Region dashboard, highest priority first.
      index('regionId').sortKeys(['priorityScore']).queryField('reportsByRegion'),
      // 2) Category filter, newest first.
      index('category').sortKeys(['createdAt']).queryField('reportsByCategory'),
      // 3) Status work-queues (e.g. the NEEDS_VERIFICATION queue).
      index('status').sortKeys(['createdAt']).queryField('reportsByStatus'),
      // 4) Map-viewport: query the prefixes covering the viewport in parallel,
      //    ordered within each cell by full geohash, then filter exactly (§5.2).
      index('geohashPrefix').sortKeys(['geohash']).queryField('reportsByGeohash'),
      // 5) Duplicate-group lookup.
      index('duplicateGroupId').sortKeys(['createdAt']).queryField('reportsByDuplicateGroup'),
      // 6) Team task board, highest priority first.
      index('assignedTeamId').sortKeys(['priorityScore']).queryField('reportsByTeam'),
    ])
    // Coarse role gate. Clients should use the guarded CRIS-9/18 mutations, but
    // generated model operations still exist for the allowed groups. Public-facing
    // reads must use PublicReport; authenticated internal reads currently remain.
    .authorization((allow) => [
      allow.groups(['COORDINATOR', 'ADMIN']),
      allow.groups(['RESPONDER', 'VOLUNTEER']).to(['read']),
      allow.authenticated().to(['read']),
    ]),

  /* ---------------------------------------------------------------------- */
  /* ReportEvent — immutable audit log (§5.1)                                */
  /* ---------------------------------------------------------------------- */
  ReportEvent: a
    .model({
      reportId: a.id().required(),
      type: a.enum([
        'SUBMITTED',
        'STATUS_CHANGED',
        'CLASSIFIED',
        'PRIORITY_SCORED',
        'VERIFICATION_RECORDED',
        'ASSIGNED',
        'DUPLICATE_LINKED',
        'ALERT_DISPATCHED',
      ]),
      fromStatus: a.string(),
      toStatus: a.string(),
      /** Actor userId, or 'SYSTEM' for pipeline-driven events. */
      actorId: a.string(),
      actorRole: a.enum(['CITIZEN', 'VOLUNTEER', 'RESPONDER', 'COORDINATOR', 'ADMIN']),
      /** Report version AFTER this event — pairs the audit log to the lock. */
      version: a.integer(),
      /** Immutable event id; dedups retried appends (§5.4.4). */
      eventId: a.string().required(),
      detail: a.json(),
      /** Explicit timestamp so the audit log GSI sorts chronologically. */
      createdAt: a.datetime(),
    })
    .secondaryIndexes((index) => [
      index('reportId').sortKeys(['createdAt']).queryField('eventsByReport'),
    ])
    // Append-only: coordinators/admins read; nobody updates or deletes. Writes
    // come from the guarded resolvers (CRIS-18), tightened to IAM there.
    .authorization((allow) => [
      allow.groups(['COORDINATOR', 'ADMIN']).to(['read', 'create']),
      allow.groups(['RESPONDER']).to(['read']),
    ]),

  /* ---------------------------------------------------------------------- */
  /* Verification — evidence behind leaving NEEDS_VERIFICATION (§5.1)        */
  /* ---------------------------------------------------------------------- */
  Verification: a
    .model({
      reportId: a.id().required(),
      outcome: a.enum(['CONFIRMED', 'REJECTED', 'INCONCLUSIVE']),
      /** Verification confidence in [0,1]. */
      confidence: a.float(),
      /** 'HUMAN' or 'AGENT'. Critical reports always require HUMAN (§5.5). */
      method: a.string(),
      verifiedById: a.string(),
      /** Internal reviewer notes — excluded from public projections (§5.6). */
      notes: a.string(),
      /** Explicit timestamp so verifications list newest-first per report. */
      createdAt: a.datetime(),
    })
    .secondaryIndexes((index) => [
      index('reportId').sortKeys(['createdAt']).queryField('verificationsByReport'),
    ])
    .authorization((allow) => [
      allow.groups(['COORDINATOR', 'ADMIN']),
      allow.groups(['RESPONDER']).to(['read', 'create']),
    ]),

  /* ---------------------------------------------------------------------- */
  /* DuplicateGroup — reports grouped, never deleted (§5.4.3)                */
  /* ---------------------------------------------------------------------- */
  DuplicateGroup: a
    .model({
      /** The representative report for the group. */
      primaryReportId: a.id().required(),
      memberReportIds: a.id().array(),
      linkType: a.enum(['STRONG', 'SUGGESTED']),
      /** Aggregate similarity (§5.4.3). ≥0.80 STRONG, 0.65–0.79 SUGGESTED. */
      similarityScore: a.float(),
      /** Coordinator review state, e.g. OPEN | MERGED | DISMISSED. */
      reviewState: a.string(),
    })
    .authorization((allow) => [
      allow.groups(['COORDINATOR', 'ADMIN']),
      allow.groups(['RESPONDER', 'VOLUNTEER']).to(['read']),
    ]),

  /* ---------------------------------------------------------------------- */
  /* Assignment — Team ↔ Report link and responder workflow (§5.1, §6.3)     */
  /* ---------------------------------------------------------------------- */
  Assignment: a
    .model({
      reportId: a.id().required(),
      teamId: a.id().required(),
      status: a.enum([
        'PROPOSED',
        'ASSIGNED',
        'ACCEPTED',
        'EN_ROUTE',
        'ON_SCENE',
        'COMPLETED',
        'CANCELLED',
      ]),
      assignedById: a.string(),
      /** Optimistic-lock version for responder status updates (§5.3). */
      version: a.integer().required(),
      /** Explicit timestamp so a report's assignments list chronologically. */
      createdAt: a.datetime(),
    })
    .secondaryIndexes((index) => [
      // Team task board: a team's active assignments by state.
      index('teamId').sortKeys(['status']).queryField('assignmentsByTeam'),
      index('reportId').sortKeys(['createdAt']).queryField('assignmentsByReport'),
    ])
    .authorization((allow) => [
      allow.groups(['COORDINATOR', 'ADMIN']),
      allow.groups(['RESPONDER', 'VOLUNTEER']).to(['read', 'update']),
    ]),

  /* ---------------------------------------------------------------------- */
  /* Team — response teams (§5.1)                                            */
  /* ---------------------------------------------------------------------- */
  Team: a
    .model({
      name: a.string().required(),
      regionId: a.id(),
      /** Capability tags matched by the Dispatch Agent (§5.5). */
      capabilities: a.string().array(),
      /** Home base for nearest-team routing. */
      baseLat: a.float(),
      baseLng: a.float(),
      active: a.boolean(),
    })
    .secondaryIndexes((index) => [index('regionId').queryField('teamsByRegion')])
    .authorization((allow) => [
      allow.groups(['COORDINATOR', 'ADMIN']),
      allow.groups(['RESPONDER', 'VOLUNTEER']).to(['read']),
    ]),

  /* ---------------------------------------------------------------------- */
  /* AlertSubscription — who gets proximity alerts (§2.7)                    */
  /* ---------------------------------------------------------------------- */
  AlertSubscription: a
    .model({
      userId: a.string().required(),
      regionId: a.id(),
      /** Category allow-list; empty means all categories. */
      categories: a.string().array(),
      /** Minimum urgency that triggers a notification. */
      minUrgency: a.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
      channels: a.string().array(),
      /** Geofence: center cell + radius for proximity matching (§2.7). */
      centerGeohash: a.string(),
      radiusMeters: a.integer(),
      active: a.boolean(),
    })
    .secondaryIndexes((index) => [
      index('regionId').queryField('subscriptionsByRegion'),
      index('userId').queryField('subscriptionsByUser'),
    ])
    // Owner-scoped: a user manages their own subscriptions; coordinators audit.
    .authorization((allow) => [
      allow.ownerDefinedIn('userId'),
      allow.groups(['COORDINATOR', 'ADMIN']).to(['read']),
    ]),

  /* ---------------------------------------------------------------------- */
  /* AlertDelivery — one durable record per recipient per channel (Fig 10)   */
  /* ---------------------------------------------------------------------- */
  AlertDelivery: a
    .model({
      reportId: a.id().required(),
      recipientId: a.string().required(),
      channel: a.enum(['SMS', 'EMAIL', 'PUSH']),
      status: a.enum(['PENDING', 'SENT', 'DELIVERED', 'FAILED']),
      attempts: a.integer(),
      lastAttemptAt: a.datetime(),
      /** Explicit timestamp so a report's deliveries list chronologically. */
      createdAt: a.datetime(),
    })
    .secondaryIndexes((index) => [
      index('reportId').sortKeys(['createdAt']).queryField('deliveriesByReport'),
    ])
    .authorization((allow) => [allow.groups(['COORDINATOR', 'ADMIN']).to(['read'])]),

  /* ---------------------------------------------------------------------- */
  /* Region — operational areas (§5.2 regionId)                              */
  /* ---------------------------------------------------------------------- */
  Region: a
    .model({
      name: a.string().required(),
      code: a.string(),
      /** Geohash prefixes that make up the region, for viewport mapping. */
      geohashPrefixes: a.string().array(),
      active: a.boolean(),
    })
    .authorization((allow) => [allow.groups(['ADMIN']), allow.authenticated().to(['read'])]),

  /* ---------------------------------------------------------------------- */
  /* CategoryConfig — tunable scoring weights per category (§5.4.2)          */
  /* ---------------------------------------------------------------------- */
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
      /** Impact-type weight fed into the deterministic priority score (§5.4.2). */
      weight: a.float(),
      iconKey: a.string(),
      color: a.string(),
      active: a.boolean(),
    })
    .authorization((allow) => [allow.groups(['ADMIN']), allow.authenticated().to(['read'])]),

  /* ---------------------------------------------------------------------- */
  /* IdempotencyRecord — end-to-end idempotency boundary (§5.4.4)            */
  /* ---------------------------------------------------------------------- */
  IdempotencyRecord: a
    .model({
      /** Client request id (submitReport) or immutable event id (pipeline). */
      idempotencyKey: a.string().required(),
      reportId: a.id(),
      /** TTL attribute — DynamoDB expires stale keys automatically. */
      expiresAt: a.integer(),
    })
    .secondaryIndexes((index) => [index('idempotencyKey').queryField('idempotencyByKey')])
    // System-internal only. Tightened to IAM/function access with CRIS-9.
    .authorization((allow) => [allow.groups(['ADMIN']).to(['read'])]),

  /* ---------------------------------------------------------------------- */
  /* Custom operations (§5.3)                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * CRIS-9 — the guarded write path. Persists a durable `NEW` report with an
   * optimistic-lock `version = 1` and a client-request-id idempotency guard,
   * returning immediately (§3.2). Available to authenticated users and to
   * guests for anonymous submissions (§2.1). Identity is resolved server-side
   * from the request — reporterId is never a client argument.
   *
   * The web/mobile clients always call this with `authMode: 'identityPool'`
   * (ADR-0021) — guests AND signed-in citizens alike — so a signed-in caller
   * presents an identityPool-*authenticated* credential, not a userPool JWT.
   * `allow.authenticated()` alone only matches the userPool JWT case, so it's
   * listed here alongside the identityPool variant (ADR-0024).
   */
  submitReport: a
    .mutation()
    .arguments({
      text: a.string().required(),
      clientRequestId: a.string().required(),
      lat: a.float(),
      lng: a.float(),
      regionId: a.id(),
      isAnonymous: a.boolean(),
      reporterContact: a.string(),
      mediaKeys: a.string().array(),
    })
    .returns(a.ref('Report'))
    .handler(a.handler.function(submitReportFn))
    .authorization((allow) => [
      allow.authenticated(),
      allow.authenticated('identityPool'),
      allow.guest(),
    ]),

  /**
   * CRIS-18 — the guarded state-machine engine. Applies a single report
   * transition with a role check, an `expectedVersion` optimistic lock, and an
   * appended `STATUS_CHANGED` audit event (§5.1). A stale version returns a
   * `CONFLICT` error and the client refetches (§5.3). Human-only: the pipeline's
   * classification transitions run on the internal path, not here. Coarse group
   * gate here; the fine-grained per-transition role rules are enforced in the
   * resolver via `TRANSITION_ROLES`.
   */
  updateReportStatus: a
    .mutation()
    .arguments({
      reportId: a.id().required(),
      toStatus: a.string().required(),
      expectedVersion: a.integer().required(),
      note: a.string(),
    })
    .returns(a.ref('Report'))
    .handler(a.handler.function(transitionReportFn))
    .authorization((allow) => [allow.groups(['RESPONDER', 'COORDINATOR', 'ADMIN'])]),

  /* ---------------------------------------------------------------------- */
  /* Public projection + real-time (CRIS-19, §5.3, §5.6)                     */
  /* ---------------------------------------------------------------------- */

  /**
   * The redacted incident shape exposed to the live map and public queries.
   * Mirrors `PublicReport` in `@crisismap/shared` (produced by `toPublicReport`).
   * By construction it carries NO reporter identity/contact, internal notes, or
   * raw report text — the map shows the AI `summary`, never the untrusted body.
   */
  PublicReport: a.customType({
    reportId: a.id().required(),
    status: a.string().required(),
    category: a.string(),
    urgency: a.string(),
    priorityScore: a.float(),
    priorityBand: a.string(),
    summary: a.string(),
    lat: a.float(),
    lng: a.float(),
    geohash: a.string(),
    geohashPrefix: a.string(),
    regionId: a.id(),
    createdAt: a.datetime(),
    updatedAt: a.datetime(),
  }),

  /**
   * Intended internal mutation for driving subscriptions (§5.3). AppSync
   * subscriptions fire on mutations, not on raw DynamoDB writes, so the async
   * worker will write the report durably and then call this to fan the redacted
   * update out to subscribers — keeping the durable write independent of AppSync
   * availability.
   *
   * Restricted to ADMIN at the client boundary today. TODO: grant the
   * classification worker's IAM role via a schema-level `allow.resource(worker)`
   * so it becomes the real (internal-only) caller, and drop the ADMIN rule.
   */
  publishReportUpdate: a
    .mutation()
    .arguments({
      reportId: a.id().required(),
      status: a.string().required(),
      category: a.string(),
      urgency: a.string(),
      priorityScore: a.float(),
      priorityBand: a.string(),
      summary: a.string(),
      lat: a.float(),
      lng: a.float(),
      geohash: a.string(),
      geohashPrefix: a.string(),
      regionId: a.id(),
      createdAt: a.datetime(),
      updatedAt: a.datetime(),
    })
    .returns(a.ref('PublicReport'))
    .handler(a.handler.function(publishReportUpdateFn))
    .authorization((allow) => [allow.groups(['ADMIN'])]),

  /*
   * TODO(CRIS-28): Real-time subscriptions are temporarily disabled. Amplify
   * backend deploy. Amplify Gen 2 requires every custom subscription to declare a
   * `.handler()` (an AppSync JS resolver that sets the subscription filter via
   * `util.transform.toSubscriptionFilter`) in addition to its auth rule — these
   * had auth rules but no handler, so synthesis failed with InvalidSchemaError.
   *
   * Re-enable as part of CRIS-28 by adding `.handler(a.handler.custom({ entry }))`
   * to each, implementing the filter resolvers, and adding `@aws-appsync/utils`
   * for resolver types. The `publishReportUpdate` mutation + `PublicReport` type
   * above remain valid and stay enabled.
   *
   *   // Live map: every redacted update. TODO(CRIS-28/CRIS-24): define guest policy.
   *   onReportUpdate: a
   *     .subscription()
   *     .for(a.ref('publishReportUpdate'))
   *     .handler(a.handler.custom({ entry: './subscriptions/on-report-update.js' }))
   *     .authorization((allow) => [allow.authenticated()]),
   *
   *   // Region dashboard: updates filtered to one region.
   *   onReportUpdateByRegion: a
   *     .subscription()
   *     .for(a.ref('publishReportUpdate'))
   *     .arguments({ regionId: a.id().required() })
   *     .handler(a.handler.custom({ entry: './subscriptions/by-region.js' }))
   *     .authorization((allow) => [allow.authenticated()]),
   *
   *   // Status work-queues: updates filtered to one lifecycle state.
   *   onReportUpdateByStatus: a
   *     .subscription()
   *     .for(a.ref('publishReportUpdate'))
   *     .arguments({ status: a.string().required() })
   *     .handler(a.handler.custom({ entry: './subscriptions/by-status.js' }))
   *     .authorization((allow) => [allow.authenticated()]),
   */
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
