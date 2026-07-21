# ADR-0025: MapLibre base map, tile source behind an env seam, lazy-loaded

- **Status:** Accepted
- **Date:** 2026-07-15
- **Deciders:** Team (CRIS-13)
- **Refines:** ADR-0002 (Vite + React SPA), ADR-0021 (web router), ADR-0022 (dashboard shell)

## Context

CRIS-13 delivers the coordinator **live map** — but only its **base map** layer. The
design doc pairs **MapLibre GL** (the renderer) with **Amazon Location Service** (the tile
source) (design doc §4, §2.4). CRIS-12 left a labeled "Live map" placeholder region in the
coordinator dashboard for exactly this ticket (ADR-0022).

Three things had to be settled:

1. **Where do tiles come from today?** Amazon Location Service needs a deployed backend plus
   Cognito / API-key auth that this scaffold does not have yet — that work is CRIS-24 (security
   controls) and CRIS-7 (auth). Wiring ALS directly would mean the map cannot render at all
   until then, so the surface could not be built or manually verified now.
2. **How much does "base map" contain?** The scaffold discipline (CLAUDE.md) keeps each epic
   feature in its owning ticket. Incident markers, clustering, heatmaps, and viewport-driven
   fetching depend on report data and geospatial query paths owned by CRIS-22 (design doc §5.2).
3. **Where is the map reachable?** The dashboard needs it inline in the "Live map" region, and
   the App landing already advertises a "Live map" surface with no destination.

## Options considered

- **Amazon Location only (design-doc target).** Faithful, but the map renders nothing until a
  backend + auth land (CRIS-24/7). No live, verifiable surface in this ticket. Rejected for now.
- **Hard-code a public demo style.** Renders today, but bakes in a throwaway URL and offers no
  path to ALS without a code change. Rejected.
- **Tile source behind an env seam, public demo fallback (chosen).** `resolveMapStyle()` reads
  `VITE_MAP_STYLE_URL`; unset → a free, no-key public demo style so the map is real and
  verifiable today; set → the deployed Amazon Location style descriptor, with **no code change**
  when CRIS-24 lands. One seam owns the tile-source decision.

## Decision

1. **Base map only.** `IncidentMapView` (`apps/web/src/surfaces/map/`) renders an interactive,
   pannable MapLibre GL map with a navigation control and attribution. It renders **no incident
   data** — markers/clustering/viewport fetching are CRIS-22. A demo-tiles badge and an inline
   "map unavailable" notice (on a style/render error) keep the surface honest and degrade
   gracefully (design doc §1).
2. **Tile source is one seam.** `resolveMapStyle()` picks `VITE_MAP_STYLE_URL` when set,
   otherwise the public demo style, and reports which. Documented in `.env.example` and typed in
   `src/vite-env.d.ts`. Amazon Location plugs in here in **CRIS-24**.
3. **Lazy-loaded.** `maplibre-gl` is ~200 kB gzipped and appears only on coordinator surfaces.
   `IncidentMap` is a `React.lazy` boundary around `IncidentMapView`, so the map (and its CSS)
   splits into its own chunk and stays out of the initial bundle — the latency-critical citizen
   `/report` path (ADR-0021, design doc §3.2) does not pay for it. The main JS chunk drops from
   ~423 kB to ~135 kB gzipped as a result.
4. **Two mount points.** The dashboard's "Live map" region renders `<IncidentMap />` in place of
   its placeholder, and a new full-screen `/map` route (`MapPage`) gives it a deep-linkable home;
   the App landing "Live map" card now navigates there (the pattern `/report` and `/coordinator`
   already use).

## Tradeoffs & consequences

- **Gain:** a real, interactive, deep-linkable map today; the ALS switch is config-only (CRIS-24);
  the heavy renderer never burdens the citizen path.
- **Give up:** the demo style is not production tiles, and there is no incident data on the map
  yet — both are expected at this scaffold stage. No auth/role-gating on `/map` (any browser can
  open it), consistent with `/coordinator` (ADR-0022).
- **Commits us to:** setting `VITE_MAP_STYLE_URL` to the Amazon Location style in **CRIS-24**;
  plotting priority-coloured incident markers and viewport-driven fetching in **CRIS-22**;
  route-level role-gating in **CRIS-7**.
