# ADR-0022: Coordinator dashboard shell, mounted as a `/coordinator` route

- **Status:** Accepted
- **Date:** 2026-07-15
- **Deciders:** Team (CRIS-12)
- **Refines:** ADR-0002 (Vite + React SPA), ADR-0021 (web router)

## Context

CRIS-12 delivers the **coordinator dashboard shell** — the real-time command view
coordinators work from (design doc §2.4, Fig 1 & Fig 11). The design doc composes this
screen from several regions, each owned by a _different, later_ ticket: filters (CRIS-22),
the live map (CRIS-13), the priority-ordered incident queue (CRIS-22), incident detail
(CRIS-23), guarded response actions (CRIS-32), recent activity and the live-update
connection (CRIS-28). The scaffold discipline (CLAUDE.md) is to keep each epic feature in
its owning ticket and not build ahead.

Two questions had to be settled:

1. **How much does the shell contain?** It must establish the layout and the named regions
   without implementing any region's feature.
2. **How is the surface reached?** ADR-0021 introduced React Router into the web SPA for
   the `/report` emergency-fallback form, so the app already has a router and route table
   (`apps/web/src/Router.tsx`). The dashboard should join it as a first-class route rather
   than inventing a parallel navigation mechanism.

## Options considered

- **Router-free in-app view switch** (a `useState` in `App.tsx` that swaps the landing for
  the dashboard). This was viable _before_ ADR-0021, but now that a router exists it would
  create two competing navigation models — `/report` deep-links and updates history while
  the dashboard would not. Inconsistent and non-linkable. Rejected.
- **Ship the component untethered (no way to reach it).** Keeps routing untouched, but the
  shell can't be viewed or manually verified, only unit-tested. Rejected.
- **Mount as a `/coordinator` route (chosen).** Add one `Route` alongside `/report`. The
  landing cards become router links; the dashboard is deep-linkable and gets browser
  history/back for free, with no new navigation concept.

## Decision

1. **Shell only.** `CoordinatorDashboard` (`apps/web/src/surfaces/coordinator/`) lays out
   the command bar, the priority-band metric strip, and every Fig 11 region as a
   **labeled placeholder that names its owning ticket**. Nothing fetches data, renders a
   map, or drives an action. Domain vocabulary (priority bands, categories, statuses)
   comes from `@crisismap/shared`, never inline literals (per conventions).
2. **`/coordinator` route.** `Router.tsx` mounts the dashboard at `/coordinator`; `App.tsx`
   landing cards for surfaces whose shell exists navigate there via the router (the same
   pattern `/report` already uses). The dashboard's "← Overview" affordance navigates back
   to `/`.

## Tradeoffs & consequences

- **Gain:** the shell is deep-linkable and manually verifiable today; navigation reuses the
  one router (ADR-0021) instead of a bespoke switch; CRIS-12 stays inside its boundary with
  no premature data/map/action work.
- **Give up:** no auth/role-gating yet — any browser can open `/coordinator`. Acceptable
  for a scaffold seam.
- **Commits us to:** adding Cognito role-gating on this route in **CRIS-7**, at which point
  each placeholder region is filled by its owning ticket (CRIS-13/22/23/28/32).
