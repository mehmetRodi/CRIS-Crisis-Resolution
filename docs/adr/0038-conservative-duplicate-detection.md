# ADR-0038: Conservative duplicate detection (CRIS-31)

- **Status:** Accepted
- **Date:** 2026-07-31
- **Deciders:** Team (CRIS-31)
- **Refines:** ADR-0010 (classification contract + scoring), ADR-0013 (async classification
  pipeline), ADR-0026 (Bedrock Triage Agent), ADR-0027 (geocoding + shared geohash)

> **Numbering note.** Originally drafted as `0037`, renumbered to `0038` when CRIS-27 merged
> first and took that number. On `main`: 0034 is CRIS-16 (GPS/map-pin input), 0036 and 0037 are
> the CRIS-27 accessibility pair. 0035 is an unused gap — left alone rather than backfilled,
> since CRIS-17 (PR #21) is still in review and also currently claims a colliding `0034`.

## Context

Design doc §1 opens on the problem: "reports are duplicated". §1.1 promises coordinators "a
single, de-duplicated, priority-ordered view". Until now that promise was unimplemented — the
`duplicateGroupId` field and its GSI existed in the schema (ADR-0006), and `DUPLICATE_LINKED`
existed in `ReportEventType`, but nothing ever wrote them. ADR-0013 recorded dedupe as a
"clearly-marked seam"; this ADR closes it.

§5.4.3 specifies the algorithm:

> Nearby recent reports of a compatible category are scored for similarity
> (`Ds = 0.40·L + 0.25·T + 0.20·G + 0.15·E`); ≥ 0.80 creates a strong duplicate link,
> 0.65 – 0.79 a coordinator review suggestion. Reports are grouped, never auto-deleted,
> preserving evidence. For MVP, text similarity uses keyword/entity overlap to avoid an
> embedding dependency.

Three things the spec leaves open, which this ADR decides:

1. **It never expands `L`/`T`/`G`/`E`.**
2. **It gives no radius or time window** — only "nearby" and "recent".
3. **It does not define "compatible category"**.

The governing asymmetry: wrongly merging two distinct emergencies can hide an incident from
responders; failing to merge two reports of one incident costs a coordinator a second look.
The errors are not equally bad, and the section is titled _conservative_ for that reason.

## Options considered

- **Embedding-based text similarity (Bedrock Titan / OpenSearch k-NN).** Much better recall on
  paraphrased reports. Rejected — §5.4.3 explicitly excludes it for MVP, and it puts another
  external dependency on a path that §1 requires to survive degradation.
- **Score on write, in the classification worker.** The worker already has the classified
  category, resolved location, and extracted entities in hand; no second pass, no new
  trigger. Bounded to one geohash-cell query per report.
- **A separate periodic reconciliation job.** Sees the whole corpus, so it catches pairs the
  online path misses (notably across cell boundaries). Rejected _for now_ as a second moving
  part with its own scheduling and failure modes; the online path is the smaller first step
  and this remains the natural follow-up.

## Decision

**1. Read the formula as Location / Text / time Gap / Entity.** This is the only reading under
which every concept §5.4.3 names — "nearby", "recent", "text similarity", "entity overlap" —
is a scored component. The alternative reading (`T` = Time, `G` = cateGory) would leave text
similarity unscored despite the section explicitly discussing it, and would double-count
category, which is already a gate. The mapping is confined to `DUPLICATE_WEIGHTS` and four
`similarity*` functions in `@crisismap/shared/duplicate.ts`, so correcting it is a small,
local change if the doc's author intended otherwise.

**2. Every unknown resolves away from "duplicate".** A missing location scores `L = 0`, an
unparseable timestamp `G = 0`, absent text or entities `0`. Two empty token sets score 0, not
1 — "we know nothing about either" must never read as "these are identical". This yields a
useful structural property: **an unlocated report can never be auto-grouped**, because
`0.25 + 0.20 + 0.15 = 0.60` caps it below the 0.65 review band. That is a consequence of the
weights, not a special case, and it is asserted in a test.

**3. Category is a gate, not a weighted term.** Incompatible categories short-circuit to
`Ds = 0`, so a very close location can never outvote a category mismatch. "Compatible" means
_identical_ for MVP: §5.4.3 does not define a compatibility relation, and the conservative
reading of an undefined relation is the strictest one. A cross-category matrix can be added
later and only ever widens what groups.

**4. Parameters: 2 km radius, 60-minute window.** Neither is in the design doc. 2 km sits
between the precision-7 geohash cell (~153 m) and the precision-5 candidate partition
(~4.9 km), so candidates drawn from one partition span the full range of `L` instead of
clustering near 1. 60 minutes matches the span over which independent reports of one incident
realistically arrive. Both are exported constants.

**5. Grouping is best-effort and runs after the durable write.** Same contract as the
`publishReportUpdate` fan-out (ADR-0009): the classification is already committed, so a dedup
failure is logged and swallowed rather than thrown. Throwing would re-drive the SQS message
and reclassify an already-classified report — wasteful, and eventually a DLQ entry for a
report that was in fact processed correctly.

**6. Group membership converges rather than pairing off, and is written atomically.** If any
strong match already belongs to a group, the report joins it; only when no match is grouped is
a new id minted. **Every ungrouped strong match joins in the same pass**, not just the report
being classified — linking only the subject would strand a third report of the same incident
while the first two paired off, which is the opposite of converging.

All of it goes through a single `TransactWriteItems` — every member's version-checked update
plus its audit append, all-or-nothing. Independent conditional writes are not sufficient here,
and the failure is not hypothetical: with two reports A and B of one incident classified
concurrently, A links peer B while B links peer A, then _both_ self-links fail their version
check. The result is A alone in B's group and B alone in A's — both flagged as duplicates,
neither grouped with its actual duplicate, permanently, because classification is one-shot and
idempotency-gated. Atomicity makes that state unrepresentable: the whole grouping lands or none
of it does, and "none" is safe because a later report into the cell re-evaluates.

The transaction caps at 100 items, so at 2 items per member the ceiling is
**50 reports per link** (`DUPLICATE_GROUP_MAX_MEMBERS`). Truncation always keeps the report
being classified and drops the weakest joiners, and logs `dedupe.membersCapped` — a silently
short group would read as "these are all the duplicates".

**Not decided here: merging two existing groups.** When strong matches span two different
groups, the report joins one and the groups stay split. Merging means rewriting every member of
the losing group under its own version condition — unbounded write amplification, and a partial
merge leaves exactly the split it was fixing. Deferred to a reconciliation pass.

**7. The review band is recorded, never applied.** 0.65–0.79 matches are logged as
`dedupe.suggest` and returned to the caller; they never write `duplicateGroupId`. Auto-grouping
at that confidence is precisely the merge-two-real-incidents failure this design avoids.

**8. Reports are never merged or deleted.** `duplicateGroupId` is a pointer. Every original
submission survives intact as evidence (§5.4.3).

**9. Bands are decided on the raw score; rounding is for display only.** `Ds` is rounded to 2dp
for storage and for the coordinator UI, but `verdictForScore` sees the unrounded value.
Rounding first would make `round2(0.795) = 0.80` a STRONG link, moving the published threshold
down by half a hundredth — small, but in the one direction decision 2 says this design must
never drift.

**10. Duplicate links share the report's `version` counter.** Linking bumps `version`, the same
counter `transition-report` locks on, so a background grouping can fail a coordinator's
in-flight status change with a `CONFLICT` they did not cause. Kept deliberately: the bump is
load-bearing. A stale GSI read carries a stale `version` _and_ a stale `duplicateGroupId`
together, so the version condition is exactly what stops the worker acting on outdated group
state — the staleness check is self-correcting only because the two travel as a pair. Dropping
the bump would need a separate guard (`attribute_not_exists(duplicateGroupId)` or similar) and
would break the `ReportEvent.version` invariant of "the report version _after_ this event". The
exposure is a seconds-wide window right after classification, on a report a coordinator has
usually not opened yet, and a `CONFLICT` is recoverable by refetch-and-retry. Revisit if
coordinators report unexplained conflicts.

## Tradeoffs & consequences

**What we gain.** The §1.1 de-duplication promise has an implementation, with an explainable
per-component breakdown persisted on the `DUPLICATE_LINKED` audit event, so a coordinator can
see _why_ two reports linked. The scoring is pure and lives in `@crisismap/shared`, so the
score a reviewer sees is the score that grouped the report.

**What we give up.**

- **Recall.** Keyword overlap misses paraphrase ("blaze" vs "fire") entirely. Conservative
  thresholds plus a strict category gate mean genuine duplicates will be missed. That is the
  intended direction of error, not an oversight.
- **Cell-boundary blindness.** Candidates come from the report's own precision-5 partition, so
  two reports of one incident that straddle a cell boundary are never compared. Querying the
  eight neighbouring cells would fix it at 9× the read cost; deferred.
- **Dense-cell recall loss — currently silent.** The GSI sorts by `geohash`, not time, and
  DynamoDB applies `Limit` _before_ `FilterExpression`. So `DUPLICATE_CANDIDATE_LIMIT` (100)
  bounds worst-case reads by returning the 100 spatially-lowest items in the cell — not the
  most recent, and not the nearest. `Report` has no TTL, so cells accumulate indefinitely and
  expected recall degrades roughly as `100/N`, fastest in dense urban cells, which is exactly
  where duplicates concentrate. Nothing detects or logs this today: the store discards `Count`
  / `ScannedCount` / `LastEvaluatedKey`, and the only count logged (`dedupe.none`) is
  post-filter. Surfacing `ScannedCount` is the cheap first step; a real fix needs a
  time-ordered candidate index or pagination until `since` is satisfied.
- **First-report asymmetry.** A report is only ever compared against reports that already
  exist. The first report of an incident is grouped retroactively, when the second arrives.

**The GSI name is derived, not guessed.** `findDuplicateCandidates` is the first raw DynamoDB
GSI query in the codebase. This ADR originally assumed Amplify names a secondary index
`<partitionKey>-<sortKey>-index` and set `REPORT_GEO_INDEX_NAME` accordingly — that was wrong,
and review caught it before merge. When `@index` carries no explicit `name` (and
`data/resource.ts` passes only `.sortKeys()` / `.queryField()`), the transformer derives it as
`${toLower(pluralize(model))}By${[field, ...sortKeys].map(toUpper).join('And')}`
(`graphql-index-transformer.js` `getOrGenerateDefaultName` → `utils.js`
`generateKeyAndQueryNameForConfig`) and passes it to `addGlobalSecondaryIndex({ indexName })`.
For `Report` / `geohashPrefix` / `geohash` that is **`reportsByGeohashPrefixAndGeohash`**.

`.queryField('reportsByGeohash')` renames the *GraphQL query field* only — the index name and
the query field are derived independently, which is what made the original guess plausible.
Projection is `ALL` by default (`getOrGenerateDefaultProjection`), so `text`, `entities`,
`version` and `duplicateGroupId` are all readable from the index.

Per ADR-0011 and `docs/conventions.md` → Testing, **unit tests still cannot prove this against
a real table** — `store.test.ts` pins only that the injected name is passed through verbatim.
A sandbox check remains worthwhile. Because grouping is best-effort, a wrong name degrades to
"dedup never links anything" and logs `dedupe.failed`; it does not break classification, which
is precisely why it went unnoticed and why the value is derived from the transformer source
rather than assumed.

**Audit appends carry an `eventId`.** `ReportEvent.eventId` is `.required()`. The worker writes
events with a raw `PutCommand`, so DynamoDB accepts a row without it — but AppSync then fails
non-null resolution on `eventsByReport`, taking down the *entire* coordinator timeline for that
report (the same failure mode `useIncidentTimeline` documents for `updatedAt`). Each link
therefore derives `` `${streamEventId}#dup#${reportId}` ``: scoped by report so the self-link
and peer-link of one classification do not collide, and deterministic so a redelivery
re-appends the same event rather than a second one (§5.4.4).

**The Stream→SQS hop gets its own dead-letter queue.** CRIS-31 also owns DLQ and idempotency;
both were already in place for the paths that had them (`ClassificationDlq` with
`maxReceiveCount: 3` covers SQS→Lambda, ADR-0013; `lastProcessedEventId` and
`IdempotencyRecord` cover redelivery, ADR-0007). The gap was the EventBridge Pipe, which had no
failure configuration at all: a record that repeatedly failed to reach SQS would retry until
the stream retention expired, and because DynamoDB streams are ordered per shard it would
head-of-line-block every report behind it. The pipe now carries `maximumRetryAttempts`,
`maximumRecordAgeInSeconds`, `onPartialBatchItemFailure: AUTOMATIC_BISECT` and a
`deadLetterConfig`.

That DLQ is a **separate queue** from `ClassificationDlq`, not a reuse. Its messages are stream
records, not the worker's `{reportId, streamEventId}` message shape, so redriving them into the
classification queue would hand the worker bodies it cannot parse — turning a recoverable
failure into poison. The alarm text and the runbook both say so explicitly, because the
redrive-into-the-obvious-queue reflex is exactly what would go wrong at 3 a.m.

**Follow-ups.**

- Confirm the index name and projection against a sandbox — no longer blocking, but the only
  check that closes the ADR-0011 gap for raw GSI queries.
- Surface `duplicateGroupId` and the review-band suggestions in the coordinator UI — the
  grouping is currently written and audited but not displayed (E4). Note the review band is
  **log-only** today: `dedupe.suggest` goes to CloudWatch and the result is discarded by the
  handler, so surfacing it needs somewhere to persist it first.
- A reconciliation pass. It is now the single answer to four deferred cases: merging split
  groups, neighbouring-cell candidates, the first-report asymmetry, and dense-cell misses.
- Log `ScannedCount` from the candidate query so dense-cell truncation stops being invisible.
- Revisit the 2 km / 60 min parameters against real report density once there is traffic.
