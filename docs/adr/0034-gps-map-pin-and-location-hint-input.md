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

1. **Mobile runs via Expo Go** (`expo start --go`, no custom dev client). A map view needs
   native code, which Expo Go cannot load.
2. **Web already has an unmerged MapLibre precedent** — the CRIS-13 branch added
   `maplibre-gl` with a free, no-API-key demo style (`resolveMapStyle`), anticipating Amazon
   Location Service auth arriving with CRIS-7/CRIS-24.

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
   `apps/web/src/lib/mapStyle.ts` is the identical `resolveMapStyle` shape as CRIS-13's
   `surfaces/map/mapStyle.ts` — a deliberate, separate copy, not shared, to keep this ticket's
   diff scoped to its own files rather than editing CRIS-13's already-merged one; worth
   de-duping in a follow-up. This ticket's copy uses a better free tile source, OpenFreeMap's
   "Liberty" style (`tiles.openfreemap.org`) — full OSM data with place labels down to village
   level, free and keyless, no rate limit — instead of MapLibre's own bare `demotiles.maplibre.org`
   (what CRIS-13 shipped with, country outlines only, no place names, unusable for actually
   placing a pin near a named location). CRIS-13's copy is untouched; adopting the same
   upgrade there is a candidate for that follow-up too.
3. **Mobile**: `apps/mobile/src/components/LocationPicker.tsx` — `@maplibre/maplibre-react-native`,
   same OpenFreeMap style as web. The pin is fixed at the screen center; you pan/zoom the map
   underneath it rather than tapping an exact point or dragging a marker — this library's
   `Marker` has no drag handle (unlike the web `maplibregl.Marker`), and tap-to-place proved hard
   to fine-tune on a touchscreen. Plus `expo-location` for GPS.
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
- **Give up:** three independent copies of the same style-resolution shape now exist —
  `apps/web/src/lib/mapStyle.ts` (this ticket), `apps/web/src/surfaces/map/mapStyle.ts`
  (CRIS-13, untouched), and mobile's `DEMO_MAP_STYLE` constant in `LocationPicker.tsx` — a
  small, easy-to-notice duplication if a style URL ever needs to change everywhere at once.
  Web's two could share one helper; mobile can't share the same one regardless
  (`@maplibre/maplibre-react-native` and `maplibre-gl` are different libraries). Mobile's pin
  also can't be dragged, only repositioned by panning the map underneath it.
- **Commits us to:** mobile development now requires a dev-client build (EAS or local Android/iOS
  toolchain) instead of the Expo Go app from the store — a real workflow change for anyone
  running the mobile app, not just for testing this feature. Also commits to reconciling the
  web map-style helper with CRIS-13's `resolveMapStyle` at merge time (same shape, easy dedup).
