import { defineConfig } from 'vitest/config';

/**
 * Post-deploy smoke suite (CRIS-35, ADR-0051). Runs against the environment
 * `amplify_outputs.json` points at — normally invoked by `deploy.yml` right
 * after `ampx pipeline-deploy`. Opt-in via CRISISMAP_SMOKE_TARGET=deployed;
 * `npm test` never picks these up (vite.config.ts excludes `*.smoke.test.ts`).
 * The long timeout covers the async classification pipeline plus cold starts.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/smoke/**/*.smoke.test.ts'],
    testTimeout: 240_000,
    hookTimeout: 120_000,
    sequence: { concurrent: false },
  },
});
