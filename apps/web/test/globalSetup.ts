import { migrate, ownerClient, resetDatabase, seedFullCatalog, seedTwoTenants } from '@loopcraft/db';
import { ITEM_BANK, LOOP_TEMPLATES, RUBRICS, TRACKS } from '@loopcraft/core';

/**
 * The session-engine and route suites run against a real Postgres with RLS on, seeded with
 * the real authored catalog rather than a hand-made double. A durable session that only
 * survives an in-memory fake proves nothing about acceptance criterion 1, and a loop driven
 * by a two-item fixture bank proves nothing about acceptance criterion 2.
 */
export default async function setup(): Promise<void> {
  await resetDatabase();
  await migrate();
  const sql = ownerClient();
  try {
    await seedFullCatalog(sql, {
      tracks: TRACKS,
      rubrics: RUBRICS,
      templates: LOOP_TEMPLATES,
      items: ITEM_BANK,
    });
    await seedTwoTenants(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
