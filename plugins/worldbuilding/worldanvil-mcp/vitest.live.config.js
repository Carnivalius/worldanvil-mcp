import { defineConfig } from 'vitest/config';

/**
 * Live World Anvil tests. Run ONLY via `npm run test:live` with WA_TEST_STAGE
 * set to read | create | update | delete. All traffic goes through the safety
 * harness in test/live/harness/, which reads credentials from .env.test itself.
 * This config deliberately does not load any .env file into process.env.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/live/**/*.live.test.js'],
    testTimeout: 180000,
    hookTimeout: 180000,
    fileParallelism: false,
    sequence: { concurrent: false },
    bail: 1,
    reporters: ['verbose'],
  },
});
