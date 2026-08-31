/**
 * `@crisismap/design` — the shared VISUAL vocabulary (CRIS-57, ADR-0057).
 *
 * Sibling to `@crisismap/shared`, and the split between them is deliberate:
 *
 *   `@crisismap/shared`  — what the domain IS. Which statuses exist, which
 *                          transitions are legal, which roles hold authority.
 *                          Behaviour lives here.
 *   `@crisismap/design`  — how the domain LOOKS and READS. Colour tokens and
 *                          human labels. Nothing here may change behaviour.
 *
 * Source-only, like `shared`: consumers import TypeScript directly, so there is
 * no build step and no chance of a stale compiled artifact.
 *
 * This package is deliberately FRAMEWORK-FREE — no React, no Tailwind class
 * names, no `lucide` imports. Web and Expo have incompatible styling and icon
 * layers, so anything platform-specific belongs in the client's own
 * `domain-display` module, which re-exports from here and adds its icons.
 */
export * from './tokens';
export * from './domain-display';
