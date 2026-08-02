# ADR-0039: Volunteers are a lower-trust tier than responders

- **Status:** Accepted
- **Date:** 2026-08-02
- **Deciders:** Team
- **Relates to:** ADR-0024 (optional auth + guest access), ADR-0035 (presigned S3 media
  upload), ADR-0008 (report transition engine)

## Context

CRIS-17 had to decide who may read report media in S3, and found no single answer in the
codebase — the three layers that express authorization disagree with each other about what a
volunteer is.

**The design doc is consistent and clear.** Volunteers are field contributors adjacent to
citizens, not junior responders:

- §1 enumerates "citizens, field volunteers, and on-scene **official** responders" — three
  tiers, with volunteers explicitly outside the official one.
- §2.5: "Citizens **and volunteers** can confirm reports they have witnessed independently,
  **official field responders** can confirm and progress the incidents assigned to their
  team." Volunteers corroborate what they personally saw; they do not drive incident state.
- §2.7 pushes proximity alerts "to citizens and volunteers" — again grouping them with
  citizens, as recipients of safety information.
- Figure 3 (volunteer task board) retains "volunteer **trust**, shift, **region**, and
  availability context" — volunteer trust is a first-class product concept, and the board is
  region-scoped.
- §5.6 names the enforcement dimensions: "schema, resolver (**ownership/region**/version), and
  projection layers."

**Two of the three code layers agree with the design doc:**

| Layer                                                  | Volunteer's standing                                       |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| `TRANSITION_ROLES` (`packages/shared/src/domain.ts`)   | **No authority at all** — `VOLUNTEER` does not appear once |
| `ROLE_RANK` (`functions/transition-report/handler.ts`) | `CITIZEN < VOLUNTEER < RESPONDER < COORDINATOR < ADMIN`    |
| **Schema authorization** (`amplify/data/resource.ts`)  | **`VOLUNTEER` ≡ `RESPONDER`, identically, on every model** |

The schema layer is the outlier. `Report`, `Assignment`, and `Team` all pair the two roles in
a single `allow.groups(['RESPONDER', 'VOLUNTEER'])` rule. Nothing recorded that as a decision;
it reads as convenience while the roles were being stubbed out.

## Options considered

- **Treat the schema layer as the norm and widen media read to volunteers.** Consistent with
  the code as it stands today, and CRIS-33's task board would need no backend change. But it
  ratifies the one layer that contradicts both the design doc and the transition engine, and
  it does so by extending it to a new resource — the most sensitive one.
- **Treat the design doc as the norm; keep new grants narrow and fix the schema layer
  separately** (chosen). Media read excludes volunteers now; the `Report`/`Assignment`/`Team`
  rules are corrected under CRIS-24, which owns Cognito roles and authorization.
- **Fix the schema layer inside CRIS-17.** Correct in principle, but it changes read paths the
  coordinator dashboard and queue depend on, with no integration coverage in this PR to catch
  a regression. Wrong ticket, wrong blast radius.

## Decision

1. **Volunteers rank below responders.** The design doc and `TRANSITION_ROLES` are
   authoritative. Where a new authorization rule must choose, volunteers are grouped with
   citizens rather than with official responders unless there is a stated reason otherwise.
2. **Report media read excludes `VOLUNTEER`** (ADR-0035 §4):
   `allow.groups(['RESPONDER', 'COORDINATOR', 'ADMIN']).to(['read'])`. This is a deliberate
   divergence from the `Report` model's own gate, and it is the narrow direction — widening
   later is a one-line change; retracting access volunteers have come to depend on is not.
3. **Volunteer access to media is earned per assignment, not per group.** The access the
   CRIS-33 task board actually needs is "media for incidents assigned to my team, in my
   region" — which an S3 bucket-prefix group rule structurally cannot express. It belongs with
   the deferred quarantine + signed-CloudFront-delivery work named in ADR-0035, where delivery
   is per-object and auditable.
4. **The following are recorded as defects for CRIS-24, not fixed here:**
   - **`Assignment` grants `['RESPONDER','VOLUNTEER'].to(['read','update'])` with no ownership,
     team, or region predicate.** Any volunteer can `updateAssignment` on **any** team's
     assignment through the generated model mutation — flipping another team's task to
     `COMPLETED` or `CANCELLED`. Design doc §2.5 scopes this to "the incidents assigned to
     their team"; nothing enforces that. This is the most serious of the three.
   - **`Report` carries `allow.authenticated().to(['read'])`** alongside its group rules, so
     any signed-in account — including a groupless self-signup — can read every report,
     including `reporterContact`. Locking S3 (Decision 2) closes the photo path but not this
     one.
   - **No region scoping exists anywhere**, though §5.6 names region as an enforcement
     dimension and the volunteer board is region-organized.

## Tradeoffs & consequences

- **Gain:** one stated answer to "what is a volunteer" that the design doc, the transition
  engine, and new authorization rules all share. The next person adding a rule has a
  precedent to follow instead of two contradictory ones to pick between.
- **Give up:** the media rule now differs from the `Report` model's rule, so the two must be
  read together to understand who sees what. That inconsistency is real, but it is the
  existing schema-layer bug showing through rather than a new one — and it resolves in
  CRIS-24's favour, not by being widened.
- **Commits us to:** CRIS-33 cannot ship a volunteer task board that displays report photos
  without first building per-assignment signed delivery. That work is already deferred in
  ADR-0035; this ADR makes it a prerequisite rather than an enhancement. If that proves too
  expensive, the honest move is a new ADR superseding this one — not quietly adding
  `VOLUNTEER` back to the storage rule.
- **Explicitly not decided here:** whether `CITIZEN` should ever read media (today it cannot),
  and how volunteer _trust level_ from Figure 3 maps onto Cognito groups. Both are CRIS-24's.
