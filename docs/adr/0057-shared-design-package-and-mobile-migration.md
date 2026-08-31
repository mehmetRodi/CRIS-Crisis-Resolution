# ADR-0057: Shared design package, and migrating the Expo app onto it

- **Status:** Accepted
- **Date:** 2026-08-31
- **Deciders:** Product owner + implementation (CRIS-57)

## Context

ADR-0054 rebuilt the web client on a semantic token layer and named the follow-up explicitly:
_"the mobile app still carries its own `theme.ts` mirroring the OLD slate/blue palette. The two
surfaces now look like different products; extracting the tokens into a shared package is the
follow-up."_

That divergence was not only cosmetic. Three concrete problems existed across the two clients:

1. **Two palettes.** `apps/mobile/src/theme.ts` was 34 lines of hex values copied by hand out of
   Tailwind's slate/blue scale, with comments naming the steps (`// slate-500`). It could not
   follow a web palette change, and it did not — it sat on the old colours through the whole web
   redesign.
2. **Two vocabularies.** Each client formatted the shared domain enums itself. Mobile rendered
   categories with `category.replace(/_/g, ' ')`, so `STRUCTURAL_DAMAGE` displayed as
   "STRUCTURAL DAMAGE" while web said "Structural damage".
3. **Two accessibility standards.** ADR-0037 established that a gated control must stay reachable
   and say why. Web implemented it; mobile's submit button was plainly `disabled`, which in React
   Native removes it from the accessibility tree entirely — a citizen tapped it, nothing happened,
   and nothing could explain why.

## Options considered

- **Copy the new tokens into `mobile/theme.ts`.** Cheapest, and re-creates exactly the drift that
  caused this. Rejected.
- **Put tokens in `@crisismap/shared`.** No new workspace. But `shared` is the DOMAIN package —
  what the system is and which operations are legal. Colour is not domain vocabulary, and mixing
  the two makes it unclear which changes are safe.
- **A new `@crisismap/design` workspace.** One more package to wire. Chosen: it draws the honest
  boundary — `shared` owns behaviour, `design` owns presentation — and it is the extraction
  ADR-0054 already named.

## Decision

1. **`packages/design` holds the palette and the wording.** Source-only, framework-free: no React,
   no Tailwind class names, no icon imports. Web and Expo have incompatible styling and icon
   layers, so anything platform-specific stays in each client's own `domain-display` module, which
   re-exports from here.
2. **Tokens are bare HSL triples** (`'184 82% 28%'`). Web composes them as
   `hsl(var(--token) / <alpha-value>)` so Tailwind opacity modifiers keep working — a complete
   colour function cannot support that. React Native calls `color()` to assemble a literal string.
3. **`tokens.css` still restates the values, and a test guards the duplication.** A browser needs
   the palette as literal CSS custom properties, and no import bridges TypeScript into a
   stylesheet. `apps/web/src/styles/tokens.test.ts` parses the real file and asserts it matches the
   shared module in BOTH directions — a token missing from the CSS, and a token present only in
   the CSS (which React Native would never see). The duplication is unavoidable; the drift is not.
4. **The design package ships colour INTENTS, not colours, for domain values.** A `Tone`
   (`'p0' | 'warning' | …`) is resolved by each client against its own styling layer. Both
   resolutions are total `Record<Tone, …>` maps, so a new intent is a compile error rather than an
   untinted badge at runtime.
5. **Mobile uses the SYSTEM font, not Inter.** This is a deliberate divergence from the web
   decision. Matching Inter would mean `expo-font`, a bundled family, and a font-load gate in
   front of first paint — on the screen most likely to be opened one-handed, under stress, during
   an actual emergency. San Francisco and Roboto need no loading step and are what users read
   everything else in. The part of the web decision that DOES carry over is tabular numerals
   (`theme.numeric`), so counters and coordinates do not jitter as they change.
6. **`react-native-svg` + `lucide-react-native` are added** so both clients draw the same glyph for
   the same category, and so the logo mark can be a real vector. This is a NATIVE dependency: the
   custom Expo dev-client build must be rebuilt before the app will start (see below).
7. **Mobile is brought up to the ADR-0037 bar.** `Button` distinguishes `blocked` (styled as
   unavailable, still pressable and announced) from `disabled` (genuinely inert, removed from the
   accessibility tree). The report form now validates through `validateReportDraft` like web,
   surfaces the outstanding reason on a blocked press, and moves focus to the field at fault —
   `TextInput.focus()` for text fields, `AccessibilityInfo.setAccessibilityFocus` for the chip
   groups, which have no focusable control of their own.
8. **The operational workspace stays web-only.** Mobile remains the citizen channel (ADR-0020).
   The public incident map is not ported; see below.

## Tradeoffs & consequences

**Gained.** One palette and one set of words across both clients, with a test that fails if they
diverge. Mobile stops rendering raw enum values. The mobile submit button explains itself, closing
the half of the ADR-0037 gap that was still open. A dark theme remains a change to one token file
on web.

**Given up — and this one has a workflow cost.** `react-native-svg` is a native module, so
**every developer and every installed dev-client must run `eas build --profile development` again
before the app will start.** A JS-only reload will fail with an unresolved native module. That
cost was weighed against a typographic, icon-free mobile design and accepted deliberately in order
to keep the two clients visually the same product.

**Committed to.** New colours go in `packages/design/src/tokens.ts` and then into `tokens.css`,
where the drift test checks them. New shared enum values need a label in the design package or the
build fails. Mobile colour values are resolved at MODULE LOAD, so a dark theme on mobile will need
a provider and re-derived styles — it cannot be a stylesheet swap the way it can on web.

**Watch — the mobile app still has no test harness.** The behavioural change in decision 7 is
therefore unasserted: it is verified only by a successful Metro bundle and by review, whereas its
web twin has `ReportForm.a11y.test.tsx` covering exactly this path. This is the pre-existing gap
recorded in `docs/conventions.md` → Accessibility, and CRIS-57 widened what rests on it. Adding
`jest-expo` + `@testing-library/react-native` is the outstanding follow-up.

**Not done.** The public incident map (ADR-0056) has no mobile equivalent, so a citizen on the app
cannot check what is already known nearby before reporting — the duplicate-suppression benefit is
web-only today. The map library and the backend query both already exist, so this is a screen, not
an architecture change.
