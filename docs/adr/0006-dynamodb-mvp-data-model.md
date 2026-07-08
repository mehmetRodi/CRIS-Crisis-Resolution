# ADR-0006: DynamoDB MVP data model

- **Status:** Accepted
- **Date:** 2026-07-06
- **Deciders:** Team (CRIS-8)

## Context

CRIS-8 replaces the single placeholder `Report` model with the real MVP data model
(design doc §5.1–5.3, §5.6). The model must support: the Report system-of-record with an
optimistic-lock `version`; the supporting entities (Verification, DuplicateGroup, Assignment,
Team, AlertSubscription, AlertDelivery, ReportEvent, Region, CategoryConfig,
IdempotencyRecord); six access patterns served by GSIs (region-by-priority, category filter,
status work-queues, map-viewport-by-geohash, duplicate-group lookup, team task board); and a
hard PII boundary — reporter identity/contact and internal notes must never reach guest/public
queries (§5.6). It is built on Amplify Gen 2 (`a.schema`, ADR-0003), whose type system and
DynamoDB mapping constrain how these are expressed. Resolvers, the async pipeline, scoring, and
auth wiring are owned by CRIS-9/10/11/7 respectively; this ADR covers only the model.

## Options considered

- **Table-per-entity (Amplify default) vs single-table design.** Single-table is the classic
  DynamoDB cost/perf optimization but requires heavy CDK escape-hatch custom resolvers,
  contradicting the managed on-ramp of ADR-0003. Table-per-entity maps 1:1 to `a.model()`,
  bills on-demand for bursty disaster traffic, and keeps the schema readable.
- **PublicReport as a separate projection table vs resolver-side redaction.** A separate
  guest-readable table physically excludes protected fields (nothing to leak, even if a rule is
  misconfigured) and is a pure data-model artifact CRIS-8 can fully ship; its cost is dual-write
  sync. Resolver redaction keeps one source of truth but concentrates PII-leak risk in resolver
  code (out of CRIS-8 scope — resolvers are CRIS-9) and doesn't get model subscriptions for the
  public live map.
- **Enum vs string for GSI key fields.** Amplify enum fields (`a.enum`) cannot serve as
  secondary-index keys (index keys must be scalar string/number). `Report.category` and
  `Report.status` are GSI partition keys, so they cannot be `a.enum`.
- **Client ULID vs Amplify's default server-generated id.** §5.2 mandates a ULID `reportId`;
  Amplify's default is a server KSUID.

## Decision

1. **Table-per-entity**, one `a.model()` per entity, on-demand billing.
2. **Separate `PublicReport` model** for the public/guest read path; `Report` grants guests
   `create` only (anonymous submission) and **no read**. Field-level authorization on
   `Report.reporterUserId/reporterName/reporterContact/internalNotes` restricts them to
   COORDINATOR/ADMIN as a second layer. The writer that keeps `PublicReport` in sync is
   CRIS-9 (submit) + CRIS-10 (pipeline).
3. **Derived key fields** `geohashPrefix` (first 4 chars of the precision-7 geohash, ~40 km
   bucket) and `statusUpdatedAt` exist solely to satisfy GSI key constraints; viewport reads
   query the covering `geohashPrefix` buckets, then range-scan `geohash`.
4. **`Report.category` and `Report.status` are stored as `a.string()`** (constrained to the
   `@crisismap/shared` Category / ReportStatus values by resolvers) because they are GSI
   partition keys. All other enum-typed fields remain `a.enum()`.
5. **Client-supplied ULID id** via `.identifier(['id'])` with `id: a.id().required()`.
6. **IAM-only internal tables** (`ReportEvent`, `IdempotencyRecord`, `AlertDelivery` writes)
   expose only ADMIN/COORDINATOR reads now; pipeline writes are granted via
   `allow.resource(...)` in CRIS-10. `ReportEvent` is immutable — no update/delete rules.
7. **Enum duplication reaffirmed**: values live once in `@crisismap/shared` and are inlined as
   literal arrays in the schema (a.enum requires literals), guarded by the "schema enum sync
   guard" test in `packages/shared/src/domain.test.ts`.

## Tradeoffs & consequences

- **Gain:** a readable, fully-managed schema; the strongest possible PII guarantee (protected
  fields don't exist in the guest table); six working GSIs; a client ULID that lets CRIS-9 make
  submission idempotent.
- **Give up / risks to watch:**
  - **Dual-write drift** between `Report` and `PublicReport` — the chief correctness risk;
    mitigation (transactional/idempotent self-healing writes) is owned by CRIS-9/CRIS-10.
  - **Weaker typing on `Report.category/status`** (string, not enum) — mitigated by resolver
    validation against the shared enums and the sync-guard test.
  - **Sparse GSIs**: reports are absent from priority/geohash/team indexes until the pipeline
    populates those keys. This is desirable (unclassified reports shouldn't hit the map/board)
    but CRIS-12/13 must not assume index completeness.
  - **Client ULID** bypasses server id generation — CRIS-9 must guarantee uniqueness via a
    conditional put on `attribute_not_exists`.
  - **Guest rules are inert** until CRIS-7 wires the identity pool's unauthenticated role.
  - **`geohashPrefix` length (4)** is a tunable: larger buckets mean more client-side filtering,
    smaller mean more parallel queries. Revisit with real map-usage data (would be a new ADR).
