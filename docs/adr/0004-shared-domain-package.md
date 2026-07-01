# ADR-0004: Source-only shared domain package

- **Status:** Accepted
- **Date:** 2026-07-01
- **Deciders:** Team (scaffolding)

## Context

The report lifecycle, roles, priority bands, and classification enums (design doc §5.1, §5.4.2,
§5.6) must be identical across the frontend, the Amplify data schema, and future Lambda
workers. We want one definition, imported everywhere, without ESM extension headaches or a
build-ordering dependency (build `shared` before `web`) that trips up `typecheck`/`dev`.

## Options considered

- **Source-only package** (`exports` → `./src/index.ts`) — consumers (Vite, tsc, esbuild)
  import the TypeScript source directly. No build step, no `dist`, no build ordering. Requires
  all consumers to be TS/bundler-based (they are).
- **Compiled package** (`tsc` → `dist`, `main`/`types` point at `dist`) — conventional for
  published libraries, but forces a build before typecheck/dev and reintroduces the ESM
  `.js`-extension-in-imports friction.

## Decision

Ship `@crisismap/shared` as a **source-only** package: `"exports": { ".": "./src/index.ts" }`,
extensionless relative imports, no build/`dist`.

## Tradeoffs & consequences

- **Gain:** zero build-ordering coupling; `typecheck`/`dev`/`test` work immediately after
  `npm install`; no `.js`/`.ts` extension gymnastics; changes to shared types are picked up
  instantly by consumers.
- **Give up:** the package is not independently consumable by a non-bundler/plain-Node runtime.
  That's fine — every consumer here is Vite, tsc, or esbuild (Lambda bundling).
- **Commits us to:** keeping consumers bundler-based. If we ever publish `shared` externally or
  run it under plain Node without bundling, revisit with a compiled build (new ADR).
