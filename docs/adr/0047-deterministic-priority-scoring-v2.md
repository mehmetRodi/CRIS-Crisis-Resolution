# ADR-0047: Deterministic priority scoring v2 (CRIS-30)

- **Status:** Accepted
- **Date:** 2026-08-14
- **Deciders:** Team (CRIS-30)
- **Supersedes:** ADR-0010's scoring formula only; its classification contract remains accepted
- **Refines:** ADR-0013 (async pipeline), ADR-0033 (score explanation UI), ADR-0038
  (duplicate detection)

> **Numbering note.** ADRs 0044–0046 landed on `main` after this branch started, so this decision
> takes the next available number, 0047.

## Context

The product design (§5.4.2) requires a deterministic, versioned, explainable score in `[0, 10]`:

`P = clamp(U + C + A + V + R + D − S, 0, 10)`

It names urgency, impact/category, affected population, verification, recency, duplicate
corroboration, uncertainty, and staleness as the inputs. ADR-0010 established the safety boundary
(the model never emits the priority) and a v1 formula, but v1 combined verification and duplicates
into one corroboration term, omitted affected population and uncertainty/staleness, and included an
unwired manual adjustment. The classify worker also supplied only urgency and category, causing
age to default optimistically to a fresh report.

CRIS-20 now provides `entities.peopleAffected`, CRIS-31 provides conservative strong duplicate
links, and `Report` already persists `scoreVersion` plus a JSON breakdown. CRIS-30 can therefore
align the executable formula with the product design without trusting another model output.

## Options considered

- **Keep v1 and wire its existing optional inputs.** Smallest change, but it preserves the mismatch
  with the design formula and leaves population and uncertainty unused.
- **Make `CategoryConfig` override code weights at runtime.** Operationally flexible, but the model
  has no configuration version. Two identical inputs could produce different scores while both say
  `scoreVersion = 2`, breaking reproducibility and auditability.
- **Continuously recompute age-based scores.** Keeps recency exact, but requires a periodic scan or
  a new time-indexed work queue. A table scan does not fit the 1,000-writes/min target, and the
  repository has no lifecycle for scheduled score jobs.
- **Use event-time snapshots.** Recompute on evidence-changing events and evaluate recency/staleness
  at that event's timestamp. This is bounded, version-checkable, and auditable.
- **Keep a coordinator manual adjustment.** Gives flexible control but creates a second priority
  authority and requires its own guarded, reasoned mutation. The approved v2 score remains
  evidence-derived; coordinators control operational status instead.

## Decision

### 1. Adopt formula version 2

`SCORE_VERSION` becomes `2`. Every factor is expressed in final score-points and rounded to two
decimals; only the final total is clamped to `[0, 10]`. Bands remain P0 `≥ 8`, P1 `≥ 6`, P2 `≥ 3`,
and P3 `< 3`.

| Factor                 | Version 2 rule                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| Urgency `U`            | CRITICAL 5.5, HIGH 4, MEDIUM 2, LOW 0.5                                                      |
| Category `C`           | Existing category ratios scaled to a 2-point maximum; medical/rescue highest, `OTHER` lowest |
| Affected people `A`    | `1.5 × n/(n+5)`; unknown or malformed evidence is zero                                       |
| Verification `V`       | Confirmed human records only, `1 × n/(n+1)`                                                  |
| Recency `R`            | `1 × 0.5^(ageMinutes/60)`                                                                    |
| Duplicate evidence `D` | Other reports strongly linked to the chosen group, `1.5 × n/(n+2)`                           |
| Uncertainty penalty    | Zero at confidence `≥ 0.8`; linear to 2 points at zero confidence                            |
| Staleness penalty      | Zero through six hours; then `1.5 × staleMinutes/(staleMinutes+720)`                         |

Unknown evidence never boosts priority. A malformed confidence is treated as zero confidence; a
missing or malformed timestamp is treated as maximally old. These conservative defaults make bad
data visible through penalties instead of silently ranking it as fresh and certain.

The agreed no-evidence calibration pins fresh, confident examples as follows: critical medical is
P0, high fire is P1, medium flood is P2, and low `OTHER` is P3.

### 2. Keep weights versioned in code

`CategoryConfig` does not override scoring until the configuration has its own version and an
explicit precedence/migration design. Changing any weight, curve, penalty, or band cutoff requires
a new `SCORE_VERSION` and ADR.

### 3. Persist event-time score snapshots

Initial classification scores use the report's age at worker processing time, validated model
confidence, and `entities.peopleAffected`. Verification and duplicate counts begin at zero when
the evidence does not exist.

After a successful strong duplicate-group transaction, the worker recomputes the newly classified
subject with the number of other reports confirmed in its chosen group. The follow-up score update
and `PRIORITY_SCORED` audit event are one version-checked DynamoDB transaction. If it loses a race
or DynamoDB is unavailable, the prior classification score remains durable and is what the worker
publishes; Bedrock work is not repeated.

Only the subject being classified is rescored in this online pass. Existing peers are not rewritten
as an unbounded group-wide side effect. They retain their prior snapshot until another explicit
evidence event or a future bounded reconciliation process rescores them.

The scoring contract accepts a confirmed-human-verification count, but verification-trigger wiring
is deferred until the repository has a guarded `verifyReport` operation. Generated model creates
are not promoted into a scoring authority. That future operation must persist the verification,
rescore the report, and append its audit event atomically or under one documented idempotency
boundary.

There is no periodic staleness scan in MVP. Recency and staleness are evaluated whenever a score is
created or refreshed. A future scheduling design must use bounded work partitions rather than a
full active-report table scan.

### 4. Replace the v1 explanation shape

The persisted v2 breakdown contains:

- `urgencyWeight`, `categoryWeight`, `affectedPeopleWeight`, `verificationWeight`;
- `recencyWeight`, `duplicateWeight`; and
- positive penalty magnitudes `uncertaintyPenalty`, `stalenessPenalty`.

The coordinator UI renders positive factors with `+` and penalties with `−`. The v1 manual
adjustment and notes fields are removed. Old `scoreVersion = 1` records keep their stored score and
band; their incompatible breakdown is omitted by the strict v2 parser until an explicit reprocess
is run. Source code does not imply or initiate a deployed-data backfill.

## Tradeoffs & consequences

- Scores are reproducible from versioned inputs and explain the product-design factors directly.
- Strong duplicate evidence raises priority only after durable grouping; review-band suggestions do
  not count.
- Saturating curves prevent large crowds or report floods from dominating without bound, while the
  final clamp still permits several urgent signals to reach P0.
- Event-time snapshots can become stale without a later evidence event. This is explicit and safer
  than an unbounded scheduled scan, but a bounded reconciliation design remains a future decision.
- Existing peers in a newly expanded duplicate group can temporarily carry a lower duplicate term
  than the new subject. A future reconciliation job may repair this asymmetry.
- Runtime category tuning and manual priority overrides remain unavailable until they can be
  versioned, guarded, and audited without creating a competing priority authority.
