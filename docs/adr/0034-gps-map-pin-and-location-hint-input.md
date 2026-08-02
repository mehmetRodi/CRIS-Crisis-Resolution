# ADR-0034: GPS, map-pin, and location-hint input (CRIS-16)

- **Status:** Accepted
- **Date:** 2026-07-19
- **Deciders:** Team

## Context

CRIS-16 owns citizen-side location capture for the report form (design doc §2.2, §5.2).
The backend write path already has everything it needs: `submitReport` accepts optional
`lat`/`lng` arguments and validates their ranges (`apps/web/amplify/functions/submit-report/core.ts`),
and the `Report` model's `geohash`/`geohashPrefix` are explicitly filled in later by the
geocode/classification pipeline (CRIS-21), not by the client. So this ticket is client-side
only: capture a coordinate (or a free-text fallback) and hand it to the existing mutation —
no backend schema change, no geohashing here.

Citizens have three ways to give a location, each covering a case the others don't:
GPS (fastest, but needs a permission grant and a good fix), a map-pin (works when GPS is
denied/inaccurate, or the incident isn't where the reporter is standing), and a text hint
(works with neither, e.g. "3rd floor, west stairwell" alongside or instead of a coordinate).

Two platform constraints shaped the decision:

1. **Mobile ran via Expo Go** (`expo start --go`, no custom dev client). A map view needs
   native code, which Expo Go cannot load.
2. **Web already has a merged MapLibre precedent** — CRIS-13 added `maplibre-gl` with a free,
   no-API-key demo style behind `resolveMapStyle` (ADR-0025), anticipating Amazon Location
   Service auth arriving with CRIS-7/CRIS-24.

## Options considered

- **GPS + text hint only, no map (either platform)** — simplest, fully Expo-Go-compatible,
  but citizens who deny GPS or need to correct a bad fix have no way to place a report
  precisely.
- **Web map-pin (reusing CRIS-13's approach) + mobile GPS/hint only** — closes the gap on
  web; mobile stays deferred until an actual dev-client workflow is adopted.
- **Full map-pin on both platforms now, using MapLibre everywhere** — chosen. Consistent with
  the design doc's MapLibre + Amazon Location stack (§4) on both surfaces, and reuses the same
  free demo-style pattern rather than introducing a second map vendor (e.g. `react-native-maps`,
  which is Google/Apple Maps-backed and diverges from ADR-0003).

## Decision

1. **`@crisismap/shared/report-form.ts`** gains `ReportDraft.location: { lat, lng } | null` and
   `ReportDraft.locationHint: string`, both optional — a report is never blockable by a denied
   permission or a bad GPS fix. `toReportSubmission` maps `location` straight to the
   submission's `lat`/`lng` (passed through to the existing mutation arguments unchanged) and
   trims `locationHint` to null-or-string. `locationHint` is folded into the free-text hint
   block by `toSubmissionText` (`[Citizen selections — ...; location hint: ...]`), the same
   pattern already used for category/urgency/subcategory — no new mutation argument needed.
2. **Web**: `apps/web/src/components/LocationPicker.tsx` — a MapLibre GL JS map (click or drag
   a marker to place/move it) plus a "Use my location" button (`navigator.geolocation`).
   It renders from CRIS-13's existing `apps/web/src/surfaces/map/mapStyle.ts` rather than a
   second copy, so `resolveMapStyle` stays the single seam where the tile source is chosen and
   the eventual ALS cutover is one edit. That shared constant is upgraded here from MapLibre's
   own `demotiles.maplibre.org` (country outlines only, no place names — fine for CRIS-13's
   scaffold base map, unusable for placing a pin near a named location) to OpenFreeMap's
   "Liberty" style (`tiles.openfreemap.org`): full OSM data with place labels down to village
   level, free and keyless, no rate limit. Both web maps therefore change tile source together,
   which is the intended behaviour — one basemap for the product.
   Because OpenFreeMap serves OpenStreetMap data under ODbL, **attribution is mandatory**: both
   maps keep MapLibre's `attributionControl` (compact form). Disabling it would be a licence
   violation, not a style choice.
3. **Mobile**: `apps/mobile/src/components/LocationPicker.tsx` — `@maplibre/maplibre-react-native`,
   same OpenFreeMap style as web, plus `expo-location` for GPS. The map centre carries a
   **crosshair that only previews a coordinate**; a separate "Use this location" button commits
   it. Panning alone never writes to the draft. An earlier revision committed the map centre on
   every `onRegionDidChange` with `userInteraction`, which fires for pinch-zoom and rotate as
   well as pan — so a citizen who merely zoomed in to orient themselves silently attached the
   default mid-Atlantic centre to their report. On a dispatch queue a confidently wrong
   coordinate is worse than an absent one, so the commit is explicit. The committed pin renders
   as a real `Marker` at its own coordinate, so it stays put while the crosshair moves and
   disappears on Clear. Aiming happens by panning rather than dragging the pin because this
   library's `Marker` has no drag handle (unlike the web `maplibregl.Marker`).
   **This moves mobile off plain Expo Go**: MapLibre RN needs native code, so the mobile app now
   requires a custom Expo dev-client build (EAS Build or a local `expo run:android`/`expo run:ios`)
   to run at all, not just to test this feature. `expo install` already added the
   `@maplibre/maplibre-react-native` config plugin and an `expo-location` permission-string
   plugin to `app.json`.
4. **No geohashing on the client.** `lat`/`lng` ride through exactly as `submitReport` already
   accepts them; `geohash`/`geohashPrefix` remain server/pipeline-owned (CRIS-21).

## Tradeoffs & consequences

- **Gain:** citizens get a precise, correctable location on both platforms without waiting on
  Amazon Location Service; location capture never blocks submission.
- **Give up:** the tile URL still lives in two places — `resolveMapStyle` for web and a local
  `DEMO_MAP_STYLE` constant in mobile's `LocationPicker.tsx`. These genuinely cannot share one
  module: `@maplibre/maplibre-react-native` and `maplibre-gl` are different libraries in
  different workspaces, and `apps/mobile` does not import from `apps/web`. Hoisting the URL into
  `@crisismap/shared` was considered and rejected — a tile endpoint is client configuration, not
  domain vocabulary, and web resolves it from `VITE_MAP_STYLE_URL` at build time while mobile
  will need an Expo config value. Mobile's pin also can't be dragged, only re-aimed by panning.
- **Give up (mobile UX):** committing the pin takes an extra tap versus pan-and-go. That is the
  deliberate price of not fabricating coordinates; see Decision 3.
- **Commits us to:** mobile development now requires a dev-client build (EAS or local Android/iOS
  toolchain) instead of the Expo Go app from the store — a real workflow change for anyone
  running the mobile app, not just for testing this feature. `apps/mobile`'s `start`/`android`/
  `ios` scripts use `--dev-client`, and the prerequisite is documented in `CLAUDE.md`.
- **Commits us to:** showing map attribution wherever OpenFreeMap/OSM tiles render, for as long
  as the demo style is the fallback.
- **Left open:** `app.json` carries no `owner`/`extra.eas.projectId`, so each developer runs
  `eas init` to link their own EAS project. Committing one contributor's account would bind the
  shared repo to a personal Expo account; a team Expo organization is the real fix, and until
  one exists there is no reproducible team build.
