# ADR-0020: Cross-platform clients — React Native (Expo) mobile app for citizen reporting

- **Status:** Accepted (partially supersedes [ADR-0002](0002-frontend-vite-react-spa.md))
- **Date:** 2026-07-15
- **Deciders:** Team

## Context

ADR-0002 made the Vite + React SPA the single client, including the citizen submission form
(CRIS-6). The product direction has since firmed up: citizens report from the field, on
phones — often mid-incident, one-handed, with camera and (later, CRIS-16) GPS in the loop.
The team decided the platform must be **cross-platform**: a native mobile app for citizen
submission, and a web UI for coordinators, responders, and volunteers.

We share one language (TypeScript), one component model (React), and one domain vocabulary
(`@crisismap/shared`) across the repo, so the mobile stack should reuse them rather than
introduce a second ecosystem.

## Options considered

- **React Native via Expo (managed workflow)** — same React + TS skill set, first-class
  camera/location/push modules (`expo-image-picker`, `expo-location`, `expo-notifications`),
  EAS for builds/OTA updates, no native projects checked in. Recommended default in the RN
  docs for new apps.
- **React Native bare** — full native control, but we own Xcode/Gradle projects and native
  upgrades with no current need for custom native code.
- **PWA (keep everything in the web SPA)** — no new app, but degraded camera/GPS/push
  reliability (especially iOS), no store presence, weaker offline story (offline capture is
  CRIS-26 scope).
- **Flutter / native Swift+Kotlin** — a second language and component model; splits the team
  and duplicates the shared domain layer.

## Decision

1. **Citizen reporting (CRIS-6 scope) is a React Native app** at `apps/mobile`
   (`@crisismap/mobile`), built on **Expo (managed workflow)**, living in the same npm
   workspace monorepo.
2. **The web SPA (`apps/web`) remains** as decided in ADR-0002, but its scope narrows to the
   coordinator/responder/volunteer surfaces (dashboard, live map, task board). The `/citizen`
   route and web `ReportForm` are removed.
3. **Platform-agnostic form logic lives in `@crisismap/shared`** (`report-form.ts`): draft
   shape, length limits, validation, and submission-payload shaping (including the rule that
   anonymity strips contact PII). UI layers stay thin; any future surface (web fallback form,
   SMS intake) reuses the same contract, as will the `submitReport` resolver validation.
4. Both clients talk to the **same Amplify/AppSync backend** — the backend definition stays
   under `apps/web/amplify/` (unchanged by this ADR; relocating it to a neutral home can be a
   future ADR if it becomes confusing).

## Tradeoffs & consequences

- **Gain:** real native camera/GPS/push and offline potential for the highest-stakes user
  (the citizen in the field); one language and one domain package across all clients; store
  distribution.
- **Give up:** a second app to build, test, and release (EAS builds, store review); Metro +
  Expo added to the toolchain; some UI duplication between RN and web (mitigated by keeping
  logic in `@crisismap/shared` — only presentation is duplicated).
- **Commits us to:** Expo SDK upgrade cadence; `expo-*` modules for device capabilities
  (CRIS-16 location → `expo-location`, CRIS-17 media → `expo-image-picker` + presigned S3);
  keeping form/domain rules out of UI packages.
- **CI:** the mobile workspace participates in the repo-wide lint/typecheck/test scripts. It
  has no `build` script (nothing to bundle in CI yet); EAS build/release wiring is future
  work with its own ticket/ADR.
