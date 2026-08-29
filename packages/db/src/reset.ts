import postgres from 'postgres';
import { assertMigrationTargetAllowed, isLocal, ownerUrl } from './env.js';

/**
 * Drops and recreates the schema, then leaves it empty for the migration runner.
 * Refuses to run against anything but a local database regardless of override flags:
 * an accidental reset is not recoverable, so this one has no escape hatch.
 */
export async function resetDatabase(url: string = ownerUrl()): Promise<void> {
  assertMigrationTargetAllowed(url);
  if (!isLocal(url)) {
    throw new Error(`resetDatabase refuses to run against non-local host ${new URL(url).hostname}`);
  }
  const sql = postgres(url, { max: 1, onnotice: () => {}, connection: { search_path: 'public' } });
  try {
    await sql.unsafe(`
      drop schema if exists public cascade;
      drop schema if exists loopcraft cascade;
      create schema public;
      grant all on schema public to public;
    `);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
