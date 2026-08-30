/**
 * Database connection settings. Guardrail 9: migrations run against a local database unless
 * an operator sets LOOPCRAFT_ALLOW_REMOTE_MIGRATIONS explicitly, so a stray DATABASE_URL
 * pointing at production cannot be migrated by accident.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);

/**
 * Tests default to a SEPARATE database from the one the dev/demo server uses.
 * packages/db/test/globalSetup.ts and every db-backed test suite call resetDatabase(),
 * which drops and recreates the schema -- if that defaulted to the same database the app
 * points at, running `pnpm test` while the dev server is up destroys whatever a live demo
 * session was relying on. (It did, once, while building this: a mid-demo debrief 500'd
 * because a test run had just wiped the catalog and the seeded plan out from under it.)
 * The dev server opts INTO the real database explicitly via DATABASE_URL in
 * apps/web/.env.local; tests get the safe default.
 */
export const DEFAULT_LOCAL_URL =
  'postgres://loopcraft:loopcraft_local_dev@localhost:54329/loopcraft_test';

/** Connection used by the migration runner and seeds: owns the tables, bypasses RLS. */
export function ownerUrl(): string {
  return process.env['DATABASE_URL'] ?? DEFAULT_LOCAL_URL;
}

/**
 * Connection used by the application and by the RLS tests: a non-superuser, non-owner role,
 * so row-level policies actually apply to it.
 */
export function appUrl(): string {
  const explicit = process.env['DATABASE_APP_URL'];
  if (explicit !== undefined && explicit !== '') return explicit;
  const url = new URL(ownerUrl());
  url.username = 'loopcraft_app';
  url.password = 'loopcraft_app_local_dev';
  return url.toString();
}

export function isLocal(url: string): boolean {
  return LOCAL_HOSTS.has(new URL(url).hostname);
}

export function assertMigrationTargetAllowed(url: string): void {
  if (isLocal(url)) return;
  if (process.env['LOOPCRAFT_ALLOW_REMOTE_MIGRATIONS'] === '1') return;
  throw new Error(
    `Refusing to migrate non-local database ${new URL(url).hostname}. ` +
      'Set LOOPCRAFT_ALLOW_REMOTE_MIGRATIONS=1 to override (guardrail 9).',
  );
}
