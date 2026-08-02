# ADR-0037: Gated controls stay reachable; live regions outlive their content (CRIS-27)

- **Status:** Accepted
- **Date:** 2026-08-02
- **Deciders:** Team (CRIS-27)
- **Refines:** ADR-0036 (frontend accessibility baseline), ADR-0034 (GPS, map-pin and
  location-hint input)

## Context

ADR-0036 set an accessibility baseline for the web surfaces and locked it with assertions.
Reviewing that work against the merged CRIS-16 location picker surfaced two ways in which an
assertion can pass while the guarantee it stands for does not hold. Both are about the gap
between "the attribute is in the DOM" and "a person is actually told".

**1. A description on a `disabled` control is written for someone who can never reach it.**
ADR-0036's third guarantee — "an unavailable control says why" — was implemented by pointing a
`disabled` submit button at an explanation with `aria-describedby`. But `disabled` removes the
button from the tab order, and `aria-describedby` is announced when a control takes focus. The
keyboard user who most needs the reason is precisely the one who cannot get to it; in browse
mode, announcement of descriptions on disabled controls varies by screen reader. The test
passed because `toHaveAccessibleDescription` computes the description from the DOM without
regard to focusability — so it asserted the wiring, not the outcome.

**2. A live region inserted together with its text is commonly missed.** Assistive tech
reports changes to regions it is already observing. Mounting `role="status"` and its message
in the same render is one insertion, and NVDA and JAWS frequently say nothing. Three places
did this: the report form's confirmation (rescued by the focus move ADR-0036 already
mandates), the map's degraded-tiles notice (not rescued — so the one change whose entire
purpose was announcement was the least likely to work), and, once CRIS-16 merged, the
location picker's geolocation error.

The picker also arrived after the ADR-0036 audit was written, so it had never been held to the
baseline at all: a `📍` inside the accessible name of the GPS button, a `Clear` button with no
object, an unnamed map container, and a group heading that sat beside its controls as loose
text rather than naming them. ADR-0034 is silent on accessibility, so none of this was
recorded anywhere.

## Options considered

**For the gated control:**

- **Keep `disabled`, and make the reason visible copy for everyone.** Simplest, and it helps
  sighted users too. But it still leaves keyboard users unable to reach the control, and it
  puts permanent instructional text in a form that is otherwise clean until something is
  wrong.
- **Keep `disabled` and accept the limitation.** No churn. Rejected: it makes the ADR-0036
  guarantee a claim we cannot support.
- **`aria-disabled` with the control left focusable.** The button stays in the tab order, so
  the description is announced on focus. The cost is that a click now reaches the handler
  while the form is incomplete, which must be answered with something better than silence.

**For the live regions:**

- **Mount the region unconditionally and toggle only its content.** The region is registered
  before anything changes, which is what makes the announcement reliable. Costs a persistently
  rendered node, which has to be kept out of the layout while empty.
- **Rely on focus movement everywhere instead.** Correct where a region genuinely replaces
  another, but wrong for an incidental notice — yanking focus to a tile-failure banner
  interrupts whatever the person was doing.
- **`aria-live="assertive"` on the conditional node.** Improves the odds without fixing the
  cause, and makes non-urgent notices interrupt speech.

## Decision

**1. A control that is gated rather than inert uses `aria-disabled`, stays focusable, and
answers activation.** The report form's submit keeps `aria-disabled` plus an
`aria-describedby` reason, and pressing it while incomplete moves focus to the first
outstanding field. The gate itself lives in the submit handler, which is where it belongs —
the attribute was never the enforcement.

The same applies to a control that is temporarily busy rather than permanently unavailable.
The picker's GPS button previously set `disabled` while a fix was in flight, which drops focus
to the document body mid-interaction — the person who just pressed it loses their place.
It now carries `aria-disabled` plus `aria-busy`, with the re-entry guard in the handler.
`disabled` stays correct only for a control that is genuinely inert and has nothing to say
about why.

The announced reason is derived from `validateReportDraft` rather than restated in the
component, so the explanation cannot drift from the rule that actually blocks the submit.

**2. A live region is mounted before the content it announces, and only its content toggles.**
While empty it is held out of the layout with `sr-only` (clip-based, so it stays in the
accessibility tree — `display: none` would re-create the insertion problem). The exception is a
region that _replaces_ another wholesale, such as the report confirmation: there, ADR-0036's
focus move is the announcement mechanism and a persistent region would be meaningless.

**3. The CRIS-16 location picker is brought up to the ADR-0036 baseline**, with a co-located
`LocationPicker.a11y.test.tsx`: decorative emoji hidden from the accessible name, `aria-busy`
while a fix is pending, `Clear selected location` given an object, the map container named via
`role="application"`, the group named with `fieldset`/`legend` like Category and Urgency, and
both outcomes a non-sighted citizen cannot see — a captured fix and a denied permission —
announced through persistent regions.

Dropping a pin stays pointer-only. A keyboard-navigable coordinate entry is a real feature, not
an accessibility patch, and the escape hatches already exist: location is never required
(ADR-0034), the GPS button needs no pointer, and the free-text location hint accepts "near the
blue bridge" from anyone.

## Tradeoffs & consequences

**What we gain.** The two guarantees ADR-0036 stated are now true rather than merely wired,
and the surface CRIS-16 added to the emergency-fallback path meets the same bar as the rest of
it. Deriving the blocked-submit reason from the shared validator also removes a duplicated
statement of the submission rules from the web form.

**What we give up.** `aria-disabled` is the more demanding pattern: every gated control now
owes an answer to activation, and a future one that forgets will no-op silently — worse than
the dimmed button it replaced. Tests assert `aria-disabled` instead of `toBeDisabled()`, which
reads as a downgrade to anyone unaware of why. Persistent regions add nodes that look like
dead markup; both the components and their tests carry comments explaining why emptiness is
the assertion.

**What this commits us to.** New gated controls use `aria-disabled` plus a focus answer. New
announcements mount their region first. `docs/conventions.md` → Accessibility is updated for
both, superseding the `disabled`-plus-`aria-describedby` guidance ADR-0036 introduced there.

**Follow-ups.**

- **`apps/mobile`'s location picker has the same defects and is deliberately untouched.** It
  is the primary citizen surface, and the mobile workspace still exposes no test script, so
  any `accessibilityLabel` work there would be unverifiable — the same reasoning by which
  ADR-0036 deferred mobile. A mobile test harness remains the prerequisite, and remains open.
- **Chip groups are focusable at their first option only.** Arrow-key roving tabindex within
  Category and Urgency is the conventional pattern for a group of related options and is not
  implemented; every chip is a separate tab stop.
- The WCAG 2.1 AA audit ADR-0036 called for (contrast, zoom/reflow, real screen-reader passes)
  is still owed, and would be the thing to catch a third instance of this class of gap.
