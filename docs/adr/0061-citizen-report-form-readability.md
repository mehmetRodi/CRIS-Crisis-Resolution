# ADR-0061: Citizen report form readability

- **Status:** Accepted
- **Date:** 2026-09-05
- **Scope:** CRIS-6 report form presentation and CRIS-27 accessibility

## Context

Following the citizen landing-page refresh, the report form still used small
choice targets, translucent cards, and urgency colors that resembled the system's
incident priority bands. Offline confirmation also implied delivery could proceed
with the browser closed, although queue retries run in the mounted app.

## Decision

Retain the single-page form and existing required/optional groups. Use solid cards,
sentence-case headings, explicit optional labels, and explanatory text beside the
required fields. Category and urgency choices have at least 44px height and a
checkmark in addition to their selected styling. Urgency uses the interaction
accent, consistent with the shared design package's distinction between reported
urgency and calculated incident priority.

Use 16px text and larger text-input targets on the citizen form without changing
shared controls used in dense operational views. Keep existing ARIA labels,
submission gates, live regions, and confirmation focus handling.

Distinguish queued confirmation with a cloud-off icon and warning tone from the
success treatment for server-accepted reports. Tell users to keep the page open or
reopen the app online for retries. Submission, persistence, and retry logic remain
unchanged.

## Consequences

The form takes slightly more vertical space in exchange for larger touch targets
and more legible choices. Supporting sections remain visible and optional; no new
wizard, state persistence, or dependencies are introduced.
