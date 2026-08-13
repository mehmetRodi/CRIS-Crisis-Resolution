import { defineConfig } from 'vitest/config';

/**
 * Opt-in tests against a deployed personal Amplify sandbox (ADR-0046).
 * Kept separate from vite.config.ts so `npm test` never needs AWS credentials.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.int.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    sequence: { concurrent: false },
  },
});
