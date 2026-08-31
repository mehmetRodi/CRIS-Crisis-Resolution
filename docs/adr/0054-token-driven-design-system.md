# ADR-0054: Token-driven design system on Tailwind + Radix primitives

- **Status:** Accepted
- **Date:** 2026-08-31
- **Deciders:** Product owner + implementation (CRIS-54 UI/UX rebuild)

## Context

The web UI up to this point was explicitly a demo scaffold. Every surface styled itself inline
with raw Tailwind palette steps (`bg-slate-50`, `text-blue-600`, `border-red-200`), each screen
restated the same domain vocabulary in its own words, and there was no shared component layer at
all. Three concrete failures followed from that:

1. **Colour carried no meaning.** Priority bands, interactive elements, and error states all drew
   from the same undifferentiated palette. A `bg-blue-600` submit button and a low-priority
   incident were the same colour, on a product whose entire job is conveying urgency at a glance.
2. **Domain vocabulary drifted.** `NEEDS_VERIFICATION` rendered as raw `SCREAMING_SNAKE` in the
   coordinator queue, as "Verification needed" on the volunteer board, and as a hand-written
   string in the timeline — three spellings of one status, because each surface mapped it locally.
3. **Accessibility was re-solved per component.** Focus rings, disabled semantics, live regions,
   and dialog focus traps were hand-rolled at each call site. CRIS-27/ADR-0036/ADR-0037 had already
   established the rules; nothing enforced them.

The product owner chose a light "civic trust" visual direction with a teal accent, Inter with
tabular numerics, and shipping light-only while keeping a dark theme reachable later.

## Options considered

- **Extend Tailwind, keep styling inline.** No new dependencies and no migration. But it fixes
  none of the three failures: raw palette steps stay reachable, so drift resumes immediately.
- **Full component library (Mantine, Chakra).** Fastest to a polished result, and brings charts
  and notifications along. But it introduces a second styling engine beside Tailwind, makes a
  distinctive look harder to reach, and puts a runtime dependency between us and every element.
- **Semantic token layer + copy-in Radix primitives (shadcn-style).** Tokens in CSS variables,
  Tailwind's palette REPLACED by semantic names, primitives vendored as editable source in the
  repo. More setup, and we own the primitive code. Chosen.

## Decision

1. **Every colour resolves through a semantic token** declared in `apps/web/src/styles/tokens.css`
   as bare HSL channel triples, composed by Tailwind as `hsl(var(--x) / <alpha-value>)` so opacity
   modifiers keep working.
2. **Tailwind's default colour scale is replaced, not extended** (`tailwind.config.js`). Naming a
   raw step (`slate-200`, `blue-600`) is a build error, not a review catch. Only `transparent`,
   `current`, `inherit`, `white`, and `black` survive, as structural rather than palette choices.
3. **Teal is the accent, and the warm spectrum belongs exclusively to severity.** P0–P3 own
   red → orange → amber → neutral. A warm or red accent would make an ordinary button read as a
   critical incident. `--info` (blue, 205°) sits close to the accent (184°) and is therefore
   reserved for passive informational surfaces and never used for an interactive element.
4. **P3 is chromatically neutral, and "unscored" is a fifth, distinct treatment.** Green would
   read as "resolved"; P3 is an open incident that merely ranks last. And a not-yet-classified
   report is not a P3 — rendering it as one would tell a coordinator the AI assessed it and found
   it routine, the opposite of the truth.
5. **Radix primitives are vendored under `src/components/ui/`** as editable source. They supply
   focus trapping, scroll locking, dismissal, typeahead, and correct ARIA roles — the parts a
   hand-rolled overlay reliably gets wrong.
6. **`src/lib/domain-display.ts` is the single presentation layer for shared domain enums.** Every
   map is a total `Record<Enum, …>`, so adding a status or category without a label is a compile
   error. `@crisismap/shared` keeps the vocabulary and the authority; this module owns only how it
   is shown, and may never change behaviour.
7. **Light-only ships; dark is a token-file change.** `tokens.css` carries a documented,
   deliberately empty seam. Because no component names a palette step, adding dark means
   redeclaring the token block under `:root[data-theme='dark']` and the `prefers-color-scheme`
   media query, and touching nothing else.

## Tradeoffs & consequences

**Gained.** Colour means one thing product-wide and is enforced by the compiler. Domain labels
have exactly one spelling. Accessibility behaviour is inherited rather than re-derived per screen.
A dark theme is now a bounded change rather than a rewrite.

**Given up.** New dependencies (Radix packages, `class-variance-authority`, `clsx`,
`tailwind-merge`, `lucide-react`, self-hosted Inter) — roughly +64 kB gzipped in the entry chunk
before the code-splitting work in ADR-0055 more than offset it. We own the vendored primitive
source and its upstream fixes. Contributors must learn the token names instead of reaching for
familiar Tailwind steps; that friction is the mechanism, not a side effect.

**Committed to.** New colours are added to `tokens.css`, never inline. New shared enum values must
be given a label in `domain-display.ts` or the build fails. MapLibre paint properties cannot use
CSS variables, so `mapColors.ts` and `LocationPickerMap.tsx` read the same tokens off the document
root at call time, with literal fallbacks for jsdom and pre-stylesheet paint — those fallbacks are
the one place values are duplicated by hand and must be kept in step.

**Watch.** The mobile app still carries its own `theme.ts` mirroring the OLD slate/blue palette
(ADR-0020). The two surfaces now look like different products; extracting the tokens into a shared
package is the follow-up (scoped as "web first, mobile after").
