# ADR-0020: Coordinator dashboard shell + interim router-free surface switch

- **Status:** Accepted
- **Date:** 2026-07-15
- **Deciders:** Team (CRIS-12)
- **Refines:** ADR-0002 (Vite + React SPA)

## Context

CRIS-12 delivers the **coordinator dashboard shell** — the real-time command view
coordinators work from (design doc §2.4, Fig 1 & Fig 11). The design doc composes this
screen from several regions, each of which is owned by a _different, later_ ticket:
filters (CRIS-22), the live map (CRIS-13), the priority-ordered incident queue (CRIS-22),
incident detail (CRIS-23), guarded response actions (CRIS-32), recent activity and the
live-update connection (CRIS-28). The scaffold discipline (CLAUDE.md) is to keep each
epic feature in its owning ticket and not build ahead.

Two questions had to be settled:

1. **How much does the shell contain?** It must establish the layout and the named
   regions without implementing any region's feature.
2. **How is the surface reached?** The app is currently a single static landing page
   (`App.tsx`); there is no router. ADR-0002 anticipated adding React Router "when
   multiple routes land (CRIS-6/12/13)", but `App.tsx` assigns routing **and** auth/
   role-gating to CRIS-7. Adding a router now would pull CRIS-7's decisions (dependency
   choice, route structure, auth-gated redirects) into CRIS-12.

## Options considered

- **Add React Router now.** Matches ADR-0002's anticipation, but couples CRIS-12 to
  CRIS-7's routing/auth work and adds a runtime dependency + route structure that should
  be decided alongside auth-gating. Rejected — crosses the scaffold boundary.
- **Ship the component untethered (no way to reach it).** Keeps App untouched, but the
  shell can't be viewed or manually verified, only unit-tested. Rejected.
- **Router-free in-app surface switch (chosen).** A `useState<View>` in `App.tsx` swaps
  the landing for the dashboard and back. No dependency, no route structure, no auth
  claims — a demoable seam that CRIS-7 replaces wholesale with a real router.

## Decision

1. **Shell only.** `CoordinatorDashboard` (`apps/web/src/surfaces/coordinator/`) lays out
   the command bar, the priority-band metric strip, and every Fig 11 region as a
   **labeled placeholder that names its owning ticket**. Nothing fetches data, renders a
   map, or drives an action. Domain vocabulary (priority bands, categories, statuses)
   comes from `@crisismap/shared`, never inline literals (per conventions).
2. **Router-free surface switch.** `App.tsx` holds a `View` state; surfaces whose shell
   exists expose an `opens` target and become buttons. The coordinator dashboard is the
   first; the citizen/map/volunteer cards stay static until their shells land.

## Tradeoffs & consequences

- **Gain:** the shell is viewable and manually verifiable today; CRIS-12 stays inside its
  boundary; no premature dependency or auth coupling.
- **Give up:** no deep-linking, no browser history/back-button, no role-gating — the
  switch is in-memory only. Acceptable for a scaffold seam.
- **Commits us to:** replacing the `useState` switch with a real client-side router and
  Cognito role-gating in **CRIS-7**, at which point each placeholder region is filled by
  its owning ticket (CRIS-13/22/23/28/32). This ADR does **not** supersede ADR-0002's
  intent to adopt a router — it defers that adoption to CRIS-7 as `App.tsx` already states.
