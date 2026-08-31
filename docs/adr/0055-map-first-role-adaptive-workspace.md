# ADR-0055: Map-first, role-adaptive workspace replaces the per-role dashboards

- **Status:** Accepted
- **Date:** 2026-08-31
- **Deciders:** Product owner + implementation (CRIS-54 UI/UX rebuild)

## Context

Operational users reached the product through a landing page that listed "surfaces" as cards
labelled with Jira ticket numbers (`CRIS-12`, `CRIS-33`) beside a raw dump of the `ReportStatus`
enum. From there they chose between three unrelated screens: `/coordinator` (a 1377-line component
rendering a grid of ticket-tagged panels), `/volunteer` (a separate board), and `/map` (a base map
rendering **no incident data at all** — markers had never been built).

The consequences were structural, not cosmetic:

- **The map was decorative.** A crisis is spatial; "what else is happening near this collapsed
  bridge" is not a question a table answers. The map occupied a panel in a grid and showed nothing.
- **Roles had no home.** `RESPONDER` and `ADMIN` had no surface of their own — responders borrowed
  the volunteer board, admins borrowed the coordinator dashboard. Which controls a role got was
  decided by four different inline `role === 'X'` checks.
- **Panels competed for the same space.** Incident detail, live activity, and the category
  breakdown each held a permanent panel, so the detail view — the thing a coordinator actually
  works in — was one narrow column among several.

The product owner chose a map-first workspace with role-adaptive panels, and a citizen flow kept
entirely separate from it.

## Options considered

- **Redesign the three dashboards in place.** Smallest change, keeps every URL. But it preserves
  the split that caused the drift, and leaves the map decorative.
- **Auto-route each role to a dedicated workspace.** Clear and conventional. But each role still
  gets its own screen, so shared context (the map, the queue) is duplicated per role and drifts.
- **One shell, one map, role-adaptive panels.** Every operational role lands in the same
  furniture; only the contents change. Most work, and requires the map to actually render data.
  Chosen.

## Decision

1. **One workspace shell** (`shell/AppShell.tsx`) for every operational role, at `/workspace/*`.
   Top bar, navigation, connection status, and account menu are identical regardless of role. A
   role change reads as a change of contents, not a change of product.
2. **`lib/capabilities.ts` is the single answer to "what does this role get?"** Every surface reads
   its flags instead of testing role names inline. Each flag mirrors a gate the SERVER already
   enforces; the module is presentation only, and if it ever disagrees with the server the server
   wins and the user sees an error — the correct failure direction.
3. **The map renders the incident feed.** Severity-coloured, clustered points; selection shared
   with the queue and the detail rail. A cluster takes the colour of the **most severe** incident
   inside it, never an average — a cluster containing one P0 must never render as routine grey.
4. **The queue is the accessible twin of the map, and is always mounted at `lg` and above.** A
   WebGL canvas cannot be made keyboard-navigable; its content is pixels. Rather than fake a focus
   ring, the map is labelled honestly, carries a live region describing what it holds (including
   how many incidents have no coordinates and are therefore absent), and names the queue as the
   operable path. A map-first product whose only accessible view is behind a toggle is not
   accessible.
5. **The volunteer centre pane is a stage board, not a map.** The `VolunteerTask` projection is
   redacted server-side and carries no coordinates at all (ADR-0042) — there is nothing to plot.
   An empty map would read as "no incidents nearby" rather than "not shown to you", which is a
   dangerous thing to imply during a crisis.
6. **Layout branches in JavaScript, not CSS.** The detail rail is a real third column at `xl` and
   an overlay sheet below it. Rendering both and hiding one with `lg:hidden` would put the panel in
   the DOM twice, duplicating its heading id, live regions, and focus targets — so `useMediaQuery`
   picks one and exactly one instance mounts.
7. **Citizen surfaces do not use this shell.** `/`, `/report`, and `/map` are public and mount
   `CitizenShell`: no navigation, no role chip, no connection indicator, no account menu. Someone
   filing a report is doing one thing, once, under stress.
8. **Two route components, not one branching component.** `useLiveReports` and `useVolunteerTasks`
   each query on mount and hooks cannot be conditional, so a single branching component would send
   every volunteer's browser at the staff-only `Report` read on each visit — a guaranteed
   authorization failure and a wasted round trip.
9. **`/coordinator` and `/volunteer` become permanent redirects.** They were the shipped URLs and
   are exactly the kind of link that ends up bookmarked or pasted into an incident channel.
   Breaking them during a crisis is not an acceptable cost of a rename.

## Tradeoffs & consequences

**Gained.** The map is a working surface rather than decoration. One spatial picture is shared by
everyone who can see coordinates. Role capability is decided in one file that mirrors the server.
`RESPONDER` and `ADMIN` have a real home. The citizen path is uncluttered by operational chrome.

**Given up.** The old dashboard and board components and their tests are deleted rather than
migrated; their coverage is re-established against the new panels. Layout now depends on
`matchMedia`, which jsdom does not implement — `vitest.setup.ts` stubs it to report the narrow
layout, so a test wanting the wide layout must say so explicitly. Below `lg` the map and queue
share one pane behind a segmented switch, which is a real downgrade on a phone; that is accepted
because operational work on a phone is secondary to citizen reporting on a phone.

**Committed to.** Selection state stays at the route level, because it drives both presentation and
a data read (the per-incident timeline). Anything added to the workspace must decide which of the
three panes it belongs in rather than claiming a new one — the failure mode of the old grid.

**Watch.** `transitionsFor` faithfully mirrors `canActorTransition`, which grants `ADMIN` **every**
structurally legal move — including the SYSTEM-only `NEW → PROCESSING`. The UI therefore offers an
administrator a button that hand-drives the classification pipeline and races the worker. That is
the shared domain model's rule and the resolver would accept it, so the UI does not diverge; whether
`ADMIN` should hold pipeline transitions is a question for `TRANSITION_ROLES`, not for the buttons.
Pinned by a test in `lib/capabilities.test.ts`.
