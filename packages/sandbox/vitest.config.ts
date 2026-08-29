import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Real containers: generous per-test timeouts, and no parallel files so a memory-bomb
    // test is not competing with a fork-bomb test for the same host resources.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
