import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { assertMigrationTargetAllowed, ownerUrl } from './env.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export interface AppliedMigration {
  readonly name: string;
  readonly skipped: boolean;
}

/** Applies every unapplied .sql file in order, each in its own transaction. */
export async function migrate(url: string = ownerUrl()): Promise<AppliedMigration[]> {
  assertMigrationTargetAllowed(url);
  // search_path is pinned for the same reason the migrations pin it: the database role and
  // the internal schema are both named "loopcraft", so the default '"$user", public' would
  // put schema_migrations in the wrong schema once 0000 has run once.
  const sql = postgres(url, {
    max: 1,
    onnotice: () => {},
    connection: { search_path: 'public' },
  });
  const applied: AppliedMigration[] = [];
  try {
    await sql`create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`;
    const done = new Set(
      (await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name),
    );
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      if (done.has(file)) {
        applied.push({ name: file, skipped: true });
        continue;
      }
      const body = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into schema_migrations (name) values (${file})`;
      });
      applied.push({ name: file, skipped: false });
    }
    return applied;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith('migrate.ts');
if (invokedDirectly) {
  const target = ownerUrl();
  const results = await migrate(target);
  for (const r of results) {
    process.stdout.write(`${r.skipped ? 'skip' : 'APPLIED'}  ${r.name}\n`);
  }
  process.stdout.write(`\n${results.filter((r) => !r.skipped).length} migration(s) applied to ${new URL(target).hostname}\n`);
}
