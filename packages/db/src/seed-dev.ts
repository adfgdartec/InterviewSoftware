import type { Sql } from './client.js';

/**
 * Dev-only plan row. Test fixtures (seed-fixtures.ts) seed 'pro-monthly'; this seeds a
 * zero-price, generous-limit plan so a fresh dev database can serve real traffic without
 * anyone having to fill in billing numbers first. Auto-renews is false, so it never trips
 * the renewal-consent constraint trigger (spec §5.4).
 */
export const DEV_PLAN_ID = 'demo-free';

export async function seedDevPlan(sql: Sql): Promise<void> {
  await sql`
    insert into plans (id, name, price_cents, billing_period, included_sessions,
                       included_asr_minutes, allows_loop_simulation, allows_code_execution,
                       allows_video, auto_renews)
    values (${DEV_PLAN_ID}, 'Demo', 0, 'free', 100, 400, true, false, false, false)
    on conflict (id) do update set
      included_sessions = excluded.included_sessions,
      allows_loop_simulation = excluded.allows_loop_simulation`;
}
