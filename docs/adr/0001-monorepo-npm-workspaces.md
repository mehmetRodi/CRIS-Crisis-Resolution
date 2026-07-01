# ADR-0001: Monorepo with npm workspaces

- **Status:** Accepted
- **Date:** 2026-07-01
- **Deciders:** Team (scaffolding)

## Context

CrisisMap AI spans a React frontend, an Amplify/CDK backend definition, shared domain types,
and (later) Lambda workers — all TypeScript. We want one repo so shared types stay in sync and
changes are atomic across layers. We need a package/workspace strategy. The team is new to
this stack, so tooling simplicity matters.

## Options considered

- **npm workspaces** — built into npm, zero extra tooling. Simpler mental model; slower
  installs and no build-task caching.
- **pnpm workspaces + Turborepo** — fast, disk-efficient, task caching. Extra tools to learn
  and a separate package manager to install.
- **Nx** — powerful generators and dependency graph, but heavier and more opinionated.

## Decision

Use **npm workspaces** with `packages/*` and `apps/*`.

## Tradeoffs & consequences

- **Gain:** no extra tooling; one `npm install` at the root wires everything; lowest learning
  curve for a team new to AWS/TS monorepos.
- **Give up:** build-task caching and the fastest installs. At current repo size this is
  negligible.
- **Commits us to:** listing `packages/*` before `apps/*` in `workspaces` so dependency order
  is sane, and consuming internal packages from source (see ADR-0004) to avoid build-ordering
  pain. If CI build times grow, we can layer Turborepo on top without restructuring.
