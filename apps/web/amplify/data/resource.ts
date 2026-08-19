import { a, defineData, type ClientSchema } from '@aws-amplify/backend';
import { submitReport as submitReportFn } from '../functions/submit-report/resource';
import { createMediaUploadUrl as createMediaUploadUrlFn } from '../functions/create-media-upload-url/resource';
import { transitionReport as transitionReportFn } from '../functions/transition-report/resource';
import { publishReportUpdate as publishReportUpdateFn } from '../functions/publish-report-update/resource';
import { classifyReport as classifyReportFn } from '../functions/classify-report/resource';
import { listVolunteerTasks as listVolunteerTasksFn } from '../functions/list-volunteer-tasks/resource';

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
 *   - `listVolunteerTasks` returns the server-redacted task projection
 *     (CRIS-33, ADR-0042).
 *   - `publishReportUpdate` is the internal fan-out mutation the triage worker
 *     calls over IAM after its durable write; it also carries an `ADMIN` group
 *     gate so it satisfies Amplify's per-operation auth requirement (CRIS-19,
 *     ADR-0009/0029/0030). CRIS-28's authenticated custom subscriptions consume
 *     this mutation; both the triage worker and transition resolver publish
 *     after their durable writes (ADR-0048).
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
const schema = a
  .schema({
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
         * Short, PII-free AI summary for coordinator triage (§2.2, CRIS-20). The
         * ONE classification field safe to surface publicly — the map/PublicReport
         * shows this, never the untrusted raw `text` (§5.6). Persisted so the
         * projection carries a summary on BOTH the query and the CRIS-19 real-time
         * publish paths, not only in the transient worker invocation.
         */
        summary: a.string(),
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
      // reads must use PublicReport. CRIS-24/ADR-0041: no blanket
      // `allow.authenticated()` read here — this model carries reporter PII
      // (`reporterContact`, `text`, `reporterId`) that a signed-in user with no
      // staff group (e.g. a self-signed-up CITIZEN) must never be able to read.
      .authorization((allow) => [
        allow.groups(['COORDINATOR', 'ADMIN']),
        allow.groups(['RESPONDER']).to(['read']),
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
        allow.groups(['RESPONDER']).to(['read']),
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
        allow.groups(['RESPONDER']).to(['read', 'update']),
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
        allow.groups(['RESPONDER']).to(['read']),
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
        /**
         * Precision-5 prefix of `centerGeohash` (mirrors `Report.geohashPrefix`,
         * §5.2) — the candidate-discovery partition key for a subscription with
         * no `regionId` (CRIS-34, ADR-0049). DynamoDB can't derive a prefix at
         * query time, so it's stored, the same reason `Report` stores both
         * `geohash` and `geohashPrefix`. Must equal
         * `geohashPrefix(centerGeohash)` (`@crisismap/shared`) — currently the
         * creator's responsibility (no subscription-management UI computes this
         * yet; see the ADR's scope note).
         */
        centerGeohashPrefix: a.string(),
        active: a.boolean(),
      })
      .secondaryIndexes((index) => [
        index('regionId').queryField('subscriptionsByRegion'),
        index('userId').queryField('subscriptionsByUser'),
        index('centerGeohashPrefix').queryField('subscriptionsByGeohashPrefix'),
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
     * CRIS-17 — issues a presigned S3 POST for a citizen's report photo,
     * before `submitReport` has ever run (no report id exists yet at photo-pick
     * time). Scoped by `clientRequestId`, the same idempotency token used for
     * `submitReport` (§5.4.4) — stable across retries, already minted
     * client-side. Same three-way auth as `submitReport` (ADR-0024): guests
     * and signed-in citizens alike pick photos before any auth state matters.
     * Content-type/size limits are enforced by the presigned POST policy
     * itself (`createMediaUploadUrl` handler), not just client-side.
     */
    createMediaUploadUrl: a
      .mutation()
      .arguments({
        clientRequestId: a.string().required(),
        contentType: a.string().required(),
      })
      .returns(
        a.customType({
          url: a.string().required(),
          fields: a.json().required(),
          key: a.string().required(),
        }),
      )
      .handler(a.handler.function(createMediaUploadUrlFn))
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
    /* Volunteer task projection (CRIS-33, ADR-0042)                           */
    /* ---------------------------------------------------------------------- */

    /**
     * Narrow operational task shape. It has no wire representation for report
     * text, reporter data, media, notes, or precise coordinates/geohashes.
     */
    VolunteerTask: a.customType({
      reportId: a.id().required(),
      status: a.string().required(),
      category: a.string(),
      urgency: a.string(),
      priorityScore: a.float(),
      priorityBand: a.string(),
      summary: a.string(),
      regionId: a.id(),
      createdAt: a.datetime(),
      assignmentId: a.id(),
      assignmentStatus: a.string(),
      teamId: a.id(),
      teamName: a.string(),
      column: a.string().required(),
    }),

    listVolunteerTasks: a
      .query()
      .returns(a.ref('VolunteerTask').array().required())
      .handler(a.handler.function(listVolunteerTasksFn))
      .authorization((allow) => [allow.groups(['VOLUNTEER', 'RESPONDER', 'COORDINATOR', 'ADMIN'])]),

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
     * Internal fan-out mutation for driving subscriptions (§5.3, ADR-0009,
     * ADR-0030). AppSync subscriptions fire on mutations, not on raw DynamoDB
     * writes, so the async triage worker writes the report durably and then calls
     * this to fan the redacted update out to subscribers — keeping the durable
     * write independent of AppSync availability.
     *
     * AUTH (ADR-0030, superseding ADR-0029): the intended caller is the
     * `classify-report` worker over IAM, granted at the SCHEMA level via
     * `allow.resource(classifyReportFn).to(['mutate'])` (see the schema
     * `.authorization()` below). But Amplify Gen 2 requires every Lambda-backed
     * custom operation to declare its OWN per-operation auth rule: a schema-level
     * `allow.resource` grant is siphoned into function-access wiring and does NOT
     * count as the operation's auth, so a rule-less operation fails synthesis with
     * `InvalidSchemaError: ...requires both an authorization rule and a handler
     * reference` (ADR-0029's rule-less design was never deployable — its own
     * "validation owed on deploy" caveat is what this ADR discharges). The
     * narrowest operation-level rule Amplify offers is a group gate, so we
     * reinstate `allow.groups(['ADMIN'])`: the worker still calls over IAM via the
     * resource grant, and only the trusted internal ADMIN role has a client-facing
     * door onto the channel.
     *
     * The argument list is exactly the public fields, so PII has no wire
     * representation on this path — the type system is the redaction guarantee,
     * not a runtime filter (§5.6).
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

    /**
     * CRIS-28 real-time read paths (ADR-0048). Every event is the redacted
     * `PublicReport` returned by `publishReportUpdate`; raw report text and
     * reporter data have no representation on this channel. The custom AppSync
     * JS handlers are required by Amplify Gen 2. Region/status variants install
     * enhanced subscription filters at registration time.
     *
     * These subscriptions deliberately use Cognito User Pool authentication.
     * Identity Pool guest auth is unsupported for `a.handler.custom`, and the
     * public `/map` still has neither a baseline public query nor incident
     * markers. Public subscription auth is deferred until that complete read
     * path can be introduced and operated together.
     */
    onReportUpdate: a
      .subscription()
      .for(a.ref('publishReportUpdate'))
      .handler(a.handler.custom({ entry: './subscriptions/on-report-update.js' }))
      .authorization((allow) => [allow.authenticated()]),

    onReportUpdateByRegion: a
      .subscription()
      .for(a.ref('publishReportUpdate'))
      .arguments({ regionId: a.id().required() })
      .handler(a.handler.custom({ entry: './subscriptions/by-region.js' }))
      .authorization((allow) => [allow.authenticated()]),

    onReportUpdateByStatus: a
      .subscription()
      .for(a.ref('publishReportUpdate'))
      .arguments({ status: a.string().required() })
      .handler(a.handler.custom({ entry: './subscriptions/by-status.js' }))
      .authorization((allow) => [allow.authenticated()]),
  })
  /**
   * Schema-level function access (CRIS-19, ADR-0029). `allow.resource` can ONLY
   * be declared here, not on an individual model or operation — Amplify grants a
   * function access to the API surface, then scopes it by operation *type*. We
   * grant both direct DynamoDB writers `mutate` so they can call the internal
   * `publishReportUpdate` after their durable writes: the classify worker and
   * the human transition resolver (CRIS-28, ADR-0048).
   *
   * Consequence to accept: these are API-wide `mutate` grants, so either trusted
   * function role could technically call other mutations over IAM — Amplify
   * offers no field-scoped function grant. Production code calls only
   * `publishReportUpdate`, and guarded model mutations retain their own checks.
   * Revisit if a tighter per-field grant appears.
   *
   * All models and custom operations — including `publishReportUpdate`, which
   * declares its own `allow.groups(['ADMIN'])` rule (ADR-0030) — carry their own
   * per-op rules, so this schema-level rule is NOT a client-facing default. It
   * only attaches function IAM `mutate` access to the API surface; both direct
   * writers call `publishReportUpdate` with `authMode: 'iam'` on that grant.
   */
  .authorization((allow) => [
    allow.resource(classifyReportFn).to(['mutate']),
    allow.resource(transitionReportFn).to(['mutate']),
  ]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
