import { TRACKS, RUBRICS, LOOP_TEMPLATES, ITEM_BANK } from '@loopcraft/core';
import { ownerClient } from './client.js';
import { seedFullCatalog } from './seed-catalog.js';
import { seedDevPlan } from './seed-dev.js';

/** `pnpm run db:seed` — loads the real catalog and the dev plan into whatever DATABASE_URL points at. */
const sql = ownerClient();
try {
  await seedFullCatalog(sql, { tracks: TRACKS, rubrics: RUBRICS, templates: LOOP_TEMPLATES, items: ITEM_BANK });
  await seedDevPlan(sql);
  console.log(`Seeded ${TRACKS.length} tracks, ${RUBRICS.length} rubrics, ${LOOP_TEMPLATES.length} templates, ${ITEM_BANK.length} items, plan "demo-free".`);
} finally {
  await sql.end({ timeout: 5 });
}
