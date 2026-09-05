# ADR-0060: Clearer citizen entry and navigation

- **Status:** Accepted
- **Date:** 2026-09-05
- **Scope:** Citizen web entry and shared citizen shell; refinement of CRIS-54 UI

## Context

The landing page placed report submission alongside decorative statistics, animated
status imagery, and unverified speed and privacy guarantees. Background artwork
also appeared behind citizen forms, reducing visual separation. The citizen header
balanced its logo with a fixed spacer that did not match every back-link width.

## Decision

Keep the existing semantic palette and button primitives. Place one prominent report
action first, followed by practical reporting guidance, a secondary public map entry,
and a short explanation of triage and coordinator review. Use solid surfaces for the
landing page and citizen shell. Omit unverified numerical guarantees and describe
available actions without promising response times or deployment health.

On narrow screens, reporting precedes supporting content. Provide a keyboard skip
link on the landing page and a minimum 44px back-link target in the citizen shell.
Centre the shell logo using equal flexible columns rather than an estimated spacer.
Operational role redirects and existing destination routes are preserved.

## Consequences

The citizen entry is easier to scan and uses the existing design system without
adding dependencies or loading map code. The landing page intentionally contains no
live incident preview; visitors open the existing public map to see incident data.
The operational workspace and native mobile UI retain their current layouts.
