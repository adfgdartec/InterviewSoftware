import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Database-backed suites only. The accessibility suite renders components and needs no
    // Postgres, so it runs from vitest.a11y.config.ts rather than paying for this setup --
    // and, more importantly, so it is not skipped when the database is unavailable.
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['test/globalSetup.ts'],
    // The db-backed suites share one database; parallel files would race on the fixture.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
