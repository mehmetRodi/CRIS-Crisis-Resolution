# ADR-0021: Web emergency-fallback citizen report form

- **Status:** Accepted (partially supersedes [ADR-0020](0020-react-native-mobile-app-for-citizen-reporting.md))
- **Date:** 2026-07-15
- **Deciders:** Team

## Context

ADR-0020 made the React Native app the citizen submission channel and, in doing so, removed
the `/citizen` route and web `ReportForm` — narrowing the web SPA to
coordinator/responder/volunteer surfaces. That reasoning still holds for the _primary_
channel: field reporting is best on a phone with camera and (CRIS-16) GPS.

But an emergency is exactly when a person may not have our app installed, may be on someone
else's device, or may be at a desktop. Requiring a store download before a citizen can report
a fire or a trapped neighbour is a reachability failure that cuts against the platform's whole
purpose — staying available when things are degraded (design-doc availability goals).

ADR-0020 anticipated this: it kept all form rules in `@crisismap/shared` (`report-form.ts`)
precisely so "any future surface — web fallback form, SMS intake, kiosk — reuses the same
contract." This ADR exercises that seam. The backend already authorizes guest submission
(`submitReport` allows `allow.guest()`), so no backend change is required.

## Options considered

- **Web fallback form reusing `@crisismap/shared`** — add `/report` to the web SPA; a thin
  Tailwind presentation layer over the same draft/validation/submission core the mobile form
  uses. Zero backend change; zero domain-logic duplication (only presentation). Widest
  reachability (any browser, no install).
- **Keep mobile-only (status quo, ADR-0020)** — simplest, but leaves citizens without the app
  unable to report — the reachability gap above.
- **PWA / installable web app** — richer than a plain form but heavier to build, and the
  citizen device-capability story (camera/GPS/push) was already judged weaker on web in
  ADR-0020; overkill for a fallback whose job is reachability, not capability.
- **SMS / phone intake** — valuable for no-data situations but a separate, larger channel with
  its own ticket; orthogonal to this decision.

## Decision

1. **Reinstate a citizen report form on the web SPA** at the `/report` route
   (`apps/web/src/screens/ReportPage.tsx` + `components/ReportForm.tsx`), positioned as an
   **emergency fallback** — the mobile app (ADR-0020) remains the primary citizen channel.
2. **No form logic is duplicated.** The web form consumes the same
   `@crisismap/shared/report-form` core (draft shape, length limits, `validateReportDraft`,
   `toReportSubmission` including the anonymity→contact-PII strip) as the mobile form. This
   file is presentation only; the two forms are behavioural twins.
3. **Guest submission via per-operation auth mode.** The web `submitReport` call overrides
   `authMode` to `identityPool` per request rather than switching the shared client's default,
   so the authenticated coordinator/responder surfaces keep the Cognito user-pool default.
4. **Media parity deferred with mobile.** The optional photo input holds a filename only and
   uploads nothing yet — same `TODO(CRIS-17)` as mobile; presigned S3 upload lands for both
   surfaces together.

This reverses ADR-0020 decision point 2 ("the `/citizen` route and web `ReportForm` are
removed") only. ADR-0020's core decision — mobile is the primary citizen channel, shared form
logic, one backend — stands.

## Tradeoffs & consequences

- **Gain:** a citizen with only a browser can report in an emergency; broader reachability and
  resilience; near-zero incremental logic (the shared core did the heavy lifting).
- **Give up:** a second presentation layer to keep in visual/behavioural step with mobile
  (mitigated — all rules live in `@crisismap/shared`, so only markup diverges); the web form
  lacks native camera/GPS, by design for a fallback.
- **Commits us to:** keeping the two report forms in step as the shared contract evolves;
  wiring CRIS-17 media upload for both surfaces; folding `/report` into the CRIS-7 auth story
  so it stays reachable as a guest route once auth guards land on the coordinator surfaces.
