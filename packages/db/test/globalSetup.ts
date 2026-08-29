import postgres from 'postgres';
import { migrate } from '../src/migrate.js';
import { resetDatabase } from '../src/reset.js';
import { ownerUrl } from '../src/env.js';
import { seedTwoTenants } from '../src/seed-fixtures.js';

/**
 * Every db test run starts from an empty database, so the migration set is proven to apply
 * in order from scratch on each CI run rather than only incrementally on a developer's box.
 */
export default async function setup(): Promise<void> {
  await resetDatabase();
  const applied = await migrate();
  const fresh = applied.filter((m) => !m.skipped).length;
  if (fresh !== applied.length) {
    throw new Error('Expected every migration to apply against a freshly reset database');
  }
  const sql = postgres(ownerUrl(), {
    max: 1,
    onnotice: () => {},
    connection: { search_path: 'public' },
  });
  try {
    await seedTwoTenants(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
