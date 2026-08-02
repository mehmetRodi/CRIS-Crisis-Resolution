# ADR-0036: Frontend accessibility baseline, asserted in unit tests (CRIS-27)

- **Status:** Accepted
- **Date:** 2026-07-31
- **Deciders:** Team (CRIS-27)
- **Refines:** ADR-0021 (web emergency-fallback report form), ADR-0022 (dashboard shell),
  ADR-0024 (optional auth + guest access), ADR-0025 (MapLibre base map)

> **Numbering note.** 0034 and 0035 are intentionally left free: CRIS-16
> (`cris16-location`) and CRIS-17 (`cris17-media-upload`) are both in review and both
> currently add a file numbered `0034`. Whichever merges second renumbers to 0035.

## Context

CrisisMap is used under duress — by a citizen reporting an emergency one-handed on a phone,
and by a coordinator triaging a queue for a long shift. Both are exactly the conditions where
accessibility stops being a compliance checkbox and becomes basic operability. The design doc
treats the citizen path as the availability-critical surface (§1, §3.2), and `/report` is the
web emergency fallback when the mobile app is unavailable (ADR-0021).

An audit of the shipped surfaces found the gaps were uneven. The coordinator dashboard was
already in reasonable shape (`aria-labelledby` regions, `aria-pressed` facets, `role="alert"`
/ `role="status"` for transition feedback). The auth forms and the citizen report form were
not:

1. **The three auth forms had decorative labels.** Every `<label>` in `LoginPage`,
   `SignupPage`, and `ConfirmSignupPage` was styling only — no `htmlFor`/`id` pairing. The
   fields were reachable by placeholder alone, which is not an accessible name: it vanishes
   on input and is skipped by some assistive tech. That the existing tests had to query with
   `getByPlaceholderText` was the tell.
2. **Required state was carried by a red asterisk.** A bare `*` announces as "star" or is
   skipped entirely, so "required" was a purely visual property.
3. **The disabled submit gave no reason.** It announces as "dimmed" with nothing explaining
   which of description / category / urgency is missing.
4. **Post-submit and degraded states were silent.** The report confirmation replaced the form
   in place, leaving focus on an unmounted button with nothing announced; the map's
   "tiles unavailable" notice rendered without being announced, so a failed base map was
   indistinguishable from a working one.

## Options considered

- **Add an automated audit (`jest-axe` / `axe-core`) and gate CI on it.** Broad rule coverage
  for little authoring effort. But it adds a dependency to the critical-path workspace, and
  axe is explicitly a detector of _machine-checkable_ violations — it cannot see that focus
  went nowhere after submit, or that a control's name is technically present but useless
  ("button, camera, click to add a photo, images help responders…"). It would have flagged
  gap 1 and none of 2–4.
- **Hand-written assertions in the existing Vitest + Testing Library suite.** No new
  dependency. Testing Library's `getByLabelText` / `toHaveAccessibleName` /
  `toHaveAccessibleDescription` resolve through the same accessible-name computation a screen
  reader uses, so the query _is_ the assertion. Covers focus management and announcement,
  which is where the real defects were. Costs more authoring per rule and covers only what we
  think to write.
- **Do nothing until a dedicated a11y pass late in the project.** Rejected: every surface
  built between now and then inherits the same defects, and retrofitting label association
  across grown forms is strictly more expensive than not regressing it.

## Decision

**Fix the four gaps above, and lock each one with a unit-test assertion in the existing
Vitest suite. No new testing dependency.**

The baseline every interactive surface is now expected to meet:

- Every form control has a programmatic label (`htmlFor`/`id`, or `aria-label` where no
  visible label exists). Placeholders are hints, never names.
- Required state is conveyed non-visually — `aria-required`, plus visually-hidden
  "(required)" text alongside the `aria-hidden` asterisk.
- A control that is unavailable says why, via `aria-describedby`.
- State changes that replace or degrade a region are announced (`role="alert"` for errors,
  `role="status"` for success and degradation) — and when a region is _replaced_, focus moves
  into its successor.
- Credential fields carry correct `autoComplete` values so password managers work; the
  verification code additionally requests `inputMode="numeric"`.

Tests live in `*.a11y.test.tsx` files co-located with the component, per
`docs/conventions.md` → Testing. Keeping them separate from behavioural tests makes the
contract legible as a checklist and keeps this ADR's scope reviewable in isolation.

## Tradeoffs & consequences

**What we gain.** The citizen emergency path and the auth wall in front of it are operable by
keyboard and screen reader. The assertions are regression locks, not documentation: dropping
an `htmlFor` breaks `getByLabelText` and fails CI, which is a far tighter loop than a periodic
manual audit.

**What we give up.** Coverage is only as broad as the assertions we wrote. This catches
naming, required state, description, announcement, and focus movement — it does **not** catch
colour contrast, reflow at 400% zoom, motion preferences, or full keyboard-trap analysis.
Those need a real audit against WCAG 2.1 AA with a live screen reader, which this does not
replace.

**What this commits us to.** New interactive surfaces are expected to ship with the same five
guarantees and their own `*.a11y.test.tsx`. The surfaces still outstanding — the volunteer
task board (CRIS-33) and the guarded coordinator actions (CRIS-32) — inherit this baseline.

**Follow-ups.**

- **Mobile is not covered.** `apps/mobile` has no test harness at all (`docs/conventions.md`
  → Testing), so the React Native surfaces have neither `accessibilityLabel` coverage nor a
  way to assert it. Wiring up a mobile harness is a prerequisite, and remains open.
- **A dedicated WCAG 2.1 AA audit** (contrast, zoom/reflow, real screen-reader passes) is
  still owed and is out of scope here.
- The `role="button"` landing cards in `App.tsx` are a valid ARIA pattern with keyboard
  handlers, but they remove those items from the list semantics of their `<ul>`. Worth
  revisiting if the landing page grows beyond a placeholder.
