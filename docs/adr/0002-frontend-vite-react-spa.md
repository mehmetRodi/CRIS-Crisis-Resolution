# ADR-0002: Frontend — Vite + React SPA

- **Status:** Partially superseded by
  [ADR-0020](0020-react-native-mobile-app-for-citizen-reporting.md) — the web SPA stands for
  coordinator/responder/volunteer surfaces, but citizen reporting moved to a React Native app
- **Date:** 2026-07-01
- **Deciders:** Team (scaffolding)

## Context

The frontend serves authenticated, highly interactive surfaces — a citizen submission form and
coordinator/volunteer/map dashboards driven by **real-time GraphQL subscriptions** (design doc
§2.4, §6). The design doc names "React + AWS Amplify Hosting" and "Next.js/React SPA". We need
to pick a concrete framework.

## Options considered

- **Vite + React SPA** — fast client-rendered SPA, trivial to deploy to Amplify Hosting,
  minimal config. No SSR (not needed for an authenticated, subscription-driven app).
- **Next.js** — routing/SSR/RSC built in and more structure, but SSR adds real complexity for
  an app that is mostly behind auth and updates over persistent WebSocket subscriptions, where
  server rendering buys little.

## Decision

Use **Vite + React SPA** (TypeScript) with Tailwind CSS, deployed via Amplify Hosting.

## Tradeoffs & consequences

- **Gain:** fastest scaffold and dev server, simplest deploy, no SSR/hydration complexity for
  real-time authenticated views.
- **Give up:** built-in SSR/SEO and file-system routing. SEO is irrelevant for the operator
  console; the public reporting entry point is a single page. We'll add a client-side router
  (e.g. React Router) when multiple routes land (CRIS-6/12/13).
- **Commits us to:** client-side data loading and the Amplify JS client for GraphQL +
  subscriptions.
