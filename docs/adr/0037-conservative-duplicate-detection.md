# ADR-0037: Conservative duplicate detection (CRIS-31)

- **Status:** Accepted
- **Date:** 2026-07-31
- **Deciders:** Team (CRIS-31)
- **Refines:** ADR-0010 (classification contract + scoring), ADR-0013 (async classification
  pipeline), ADR-0026 (Bedrock Triage Agent), ADR-0027 (geocoding + shared geohash)

> **Numbering note.** 0034/0035 are reserved for CRIS-16 and CRIS-17 (both in review, both
> currently adding a `0034`); 0036 is the CRIS-27 accessibility baseline.

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

**6. Group membership converges rather than pairing off.** If any strong match already belongs
to a group, the report joins it. Only when no match is grouped is a new id minted — and then
the peer is written _first_: if that conditional write loses its race, the grouping is
abandoned rather than leaving this report alone in a group nothing else points at.

**7. The review band is recorded, never applied.** 0.65–0.79 matches are logged as
`dedupe.suggest` and returned to the caller; they never write `duplicateGroupId`. Auto-grouping
at that confidence is precisely the merge-two-real-incidents failure this design avoids.

**8. Reports are never merged or deleted.** `duplicateGroupId` is a pointer. Every original
submission survives intact as evidence (§5.4.3).

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
- **Dense-cell cost.** The GSI sorts by `geohash`, not time, so the recency window can only be
  applied after reading. `DUPLICATE_CANDIDATE_LIMIT` (100) bounds worst-case reads; hitting it
  is logged rather than silently truncating.
- **First-report asymmetry.** A report is only ever compared against reports that already
  exist. The first report of an incident is grouped retroactively, when the second arrives.

**Risk to watch — the GSI name is unverified.** `findDuplicateCandidates` is the first raw
DynamoDB GSI query in the codebase. Amplify names a secondary index
`<partitionKey>-<sortKey>-index`, so `REPORT_GEO_INDEX_NAME` is set to
`geohashPrefix-geohash-index` in `backend.ts`. Per ADR-0011 and `docs/conventions.md` →
Testing, **unit tests cannot catch this** — a wrong name (or a GSI projection narrower than
`ALL`) fails only in a deployed environment. It is injected as an environment variable rather
than hardcoded in the worker so it is a one-line correction. **Confirm against
`npx ampx sandbox` before treating CRIS-31 as done.** Because grouping is best-effort, a wrong
name degrades to "dedup never links anything" and logs `dedupe.failed` — it does not break
classification.

**Follow-ups.**

- Verify the index name and projection against a sandbox (blocking for "done").
- Surface `duplicateGroupId` and the review-band suggestions in the coordinator UI — the
  grouping is currently written and audited but not displayed (E4).
- Neighbouring-cell candidate queries, and/or a periodic reconciliation pass, to recover the
  boundary and first-report cases.
- Revisit the 2 km / 60 min parameters against real report density once there is traffic.
