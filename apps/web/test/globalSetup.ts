import { migrate, ownerClient, resetDatabase, seedTwoTenants } from '@loopcraft/db';

/**
 * The session-engine suite runs against a real Postgres with RLS on, not a fake. A durable
 * session that only survives an in-memory double proves nothing about acceptance criterion 1.
 */
export default async function setup(): Promise<void> {
  await resetDatabase();
  await migrate();
  const sql = ownerClient();
  try {
    await seedTwoTenants(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
