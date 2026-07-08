# ADR-0006: DynamoDB MVP data model

- **Status:** Accepted
- **Date:** 2026-07-06
- **Deciders:** Team (CRIS-8)
- **Ticket:** CRIS-8 (epic CRIS-E2)

## Context

The scaffold shipped a single minimal `Report` model. CRIS-8 turns that into the MVP data
model from design doc §5.1–5.3: the `Report` system of record plus its supporting entities
(Verification, DuplicateGroup, Assignment, Team, AlertSubscription, AlertDelivery,
ReportEvent, Region, CategoryConfig, IdempotencyRecord), the geospatial fields, and the
access-pattern indexes.

Constraints from the design doc:

- DynamoDB is the system of record; **one table per entity** for MVP clarity, on-demand
  billing for bursty disaster traffic (§5.2).
- `Report` is keyed by a `reportId` ULID, carries an optimistic-lock `version`, normalized
  classification, the derived `priorityScore`/`priorityBand`, and resolved location
  (lat/long + precision-7 `geohash` + `regionId`) (§5.2).
- **Six GSIs**: region dashboard by priority, category filter, status work-queues,
  map-viewport by geohash, duplicate-group lookup, team task board (§5.2).
- DynamoDB has no native radius query — viewport requests decompose into a bounded set of
  geohash prefixes queried in parallel, then filtered exactly (§5.2).
- Reporter identity/contact is PII and must never leak to public views or prompts (§5.6).

## Decisions

1. **Model per entity via Amplify `a.model()`.** Each `a.model()` provisions its own
   on-demand DynamoDB table, which matches the design's "separate tables per entity" directly.

2. **`reportId` ULID = Amplify `id`.** We reuse Amplify's primary-key `id` field as the ULID
   rather than adding a parallel key. The ULID is minted by the `submitReport` resolver
   (CRIS-9), keeping keys time-sortable without a second attribute.

3. **Plain reference fields + explicit GSIs instead of Amplify relationship directives.**
   Supporting entities reference the report by `reportId` (`a.id()`) and expose their own
   `secondaryIndexes(...)`, rather than `a.hasMany`/`a.belongsTo`. This keeps the physical
   access patterns explicit and hand-tuned (as §5.2 specifies) and avoids Amplify generating
   hidden connection fields/indexes we didn't design for.

4. **Six GSIs live on `Report`.** All six documented access patterns are served from the
   `Report` table, including the team task board (via an `assignedTeamId` field on the report,
   ordered by `priorityScore`). The `Assignment` entity additionally carries its own
   `assignmentsByTeam` index for assignment _lifecycle/history_; the report-side GSI is the
   coordinator/team "what should we work on next" board.

5. **Explicit `createdAt` on recency-sorted models.** Amplify's implicit `createdAt` is not
   eligible as a GSI sort key, so models whose indexes sort by recency
   (`Report`, `ReportEvent`, `Verification`, `Assignment`, `AlertDelivery`) declare an
   explicit `createdAt: a.datetime()` used as the sort key.

6. **Geohash stored at two precisions.** `geohash` (precision-7, ~153 m — the
   `GEOHASH_PRECISION` constant in `@crisismap/shared`) is the viewport GSI sort key;
   `geohashPrefix` (coarser) is its partition key, so a viewport is answered by querying the
   handful of prefix cells that cover it in parallel.

7. **PII stays on `Report`, redaction deferred to the projection.** `reporterId`,
   `reporterContact`, and internal `notes` live on the internal models. The redacted
   `PublicReport` projection and the guarantee that these never leak are implemented in
   CRIS-19; model-level auth here is a coarse role gate in the meantime.

## Tradeoffs & consequences

- **Gain:** a faithful, access-pattern-driven model the frontend and pipeline can code
  against now; indexes map 1:1 to the design's six patterns; geospatial and
  concurrency/idempotency fields are in place for CRIS-9/18/19.
- **Give up:** referential integrity between entities is application-enforced (no relational
  joins), consistent with a DynamoDB single-purpose-table design.
- **Deferred to owning tickets:** guarded write path + idempotency (CRIS-9), state-machine
  mutations + audit append (CRIS-18), `PublicReport` projection + IAM-only
  `publishReportUpdate` + subscriptions (CRIS-19). Enum allow-lists and scoring weights are
  finalized by the classification contract (CRIS-11).
- **Commits us to:** keeping the inline `a.enum([...])` arrays in `data/resource.ts` in sync
  with `@crisismap/shared` (see ADR-0004 and docs/conventions.md).
