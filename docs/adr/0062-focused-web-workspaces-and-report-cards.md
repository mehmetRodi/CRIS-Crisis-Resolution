# ADR-0062: Focused web workspaces and report cards

- **Status:** Accepted
- **Date:** 2026-09-05
- **Scope:** CRIS-6/27 reporting, CRIS-22/23 incident workspace, CRIS-33 task flow
- **Supersedes in part:** ADR-0054/0055/0060/0061 presentation decisions

## Context

The user requested a coherent dashboard language inspired by the Synthex analytics
reference, a report form presented one card at a time, interactive volunteer tasks,
and adjustable incident panels. On reviewing the initial implementation, they
explicitly requested top navigation in place of a left sidebar.

## Decision

Use a shared mint-neutral canvas, white cards, deeper teal controls, and existing
severity colours. Maintain the design-package/CSS token contract. Both clients
inherit the palette; the new flows target the web application.

Keep operational destinations in compact top navigation. On desktop the incident
list, map, and overview/detail panel can be toggled independently, retaining at
least one panel. Pointer and keyboard dividers resize adjacent panels within
bounded widths; Reset restores the default. Smaller screens show one selectable
list/map pane and an incident detail sheet. ResizeObserver keeps maps sized when
panels change. Map startup failures remain contained to the map.

The report form shows Situation, Location, Details, and Review cards. Draft and
uploaded-media state survive navigation. Continue validates the current step;
Send validates the complete shared draft, returning focus to missing fields.
Only Review can send. The location map mounts only on its card. Existing offline
queueing, idempotency, anonymous/contact handling, and upload guards are retained.

Volunteer tasks open a keyboard-accessible detail sheet. Region, team, category,
urgency, search, and active/completed filters narrow the feed. Location comes only
from the existing public query, matched to the selected report. Missing or
unconfirmed coordinates are explained. Never fall back to the staff Report model.

Add public About, Help, Privacy, and Terms of use pages through shared navigation.
Information pages describe actual application behaviour and point to the deployment
operator for organisation-specific policies; they do not invent an operator,
retention policy, service guarantee, or jurisdiction.

## Consequences

No backend authorization is weakened to supply a map. Task locations are available
only when the existing public projection publishes them. Current filter/panel
preferences are scoped to the mounted workspace. Sharing and persisting layouts
are future work. Claiming and progress updates are a separate decision (ADR-0063).
