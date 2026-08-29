import { defineConfig } from 'vitest/config';

/**
 * Accessibility and presentation suites. No database, no global setup: these render React to
 * static markup and audit it with axe-core in jsdom, which depends on nothing external.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['test/**/*.test.tsx'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
