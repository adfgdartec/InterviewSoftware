import type { Sql } from './client.js';

/**
 * Two isolated tenants used by the cross-tenant denial test and by demo mode. Ids are fixed
 * so a failing assertion names a recognisable row rather than a fresh uuid.
 */
export const FIXTURE = {
  orgA: '00000000-0000-4000-8000-0000000000a1',
  orgB: '00000000-0000-4000-8000-0000000000b1',
  userA: '00000000-0000-4000-8000-0000000000a2',
  userB: '00000000-0000-4000-8000-0000000000b2',
  sessionA: '00000000-0000-4000-8000-0000000000a3',
  sessionB: '00000000-0000-4000-8000-0000000000b3',
  planId: 'pro-monthly',
  trackId: 'ml-systems',
  rubricId: 'ml-systems.domain.v1',
  templateId: 'frontier-lab-ml-systems',
  periodStart: new Date('2026-08-01T00:00:00Z'),
  periodEnd: new Date('2027-08-01T00:00:00Z'),
} as const;


/**
 * Inserts the two-tenant fixture. Runs on the owner connection, which bypasses RLS.
 * Each statement is issued separately: the extended protocol postgres.js uses for
 * parameterised queries accepts one command per message.
 */
export async function seedTwoTenants(sql: Sql): Promise<void> {
  await sql`
    insert into orgs (id, name, slug) values
      (${FIXTURE.orgA}, 'Org A', 'org-a'), (${FIXTURE.orgB}, 'Org B', 'org-b')
      on conflict (id) do nothing`;

  await sql`
    insert into users (id, email, display_name) values
      (${FIXTURE.userA}, 'a@example.test', 'Candidate A'),
      (${FIXTURE.userB}, 'b@example.test', 'Candidate B')
      on conflict (id) do nothing`;

  await sql`
    insert into memberships (org_id, user_id, role) values
      (${FIXTURE.orgA}, ${FIXTURE.userA}, 'owner'),
      (${FIXTURE.orgB}, ${FIXTURE.userB}, 'owner')
      on conflict (org_id, user_id) do nothing`;

  await sql`
    insert into plans (id, name, price_cents, billing_period, included_sessions,
                       included_asr_minutes, allows_loop_simulation, allows_code_execution,
                       auto_renews)
      values (${FIXTURE.planId}, 'Pro (monthly)', 4900, 'monthly', 8, 400, true, true, true)
      on conflict (id) do nothing`;

  await sql`
    insert into tracks (id, name, family, ship_order)
      values (${FIXTURE.trackId}, 'ML Systems', 'ai', 2) on conflict (id) do nothing`;

  await sql`
    insert into rubrics (id, track_id, round_type, name)
      values (${FIXTURE.rubricId}, ${FIXTURE.trackId}, 'domain', 'ML systems domain depth')
      on conflict (id) do nothing`;

  await sql`
    insert into loop_templates (id, name, track_id, level_band, source_urls, modeled_on_note)
      values (${FIXTURE.templateId}, 'Frontier lab ML systems loop', ${FIXTURE.trackId}, 'L5',
              ${sql.array(['https://example.test/careers/interview-process'])},
              'Modeled on publicly reported interview formats. Not affiliated with any employer.')
      on conflict (id) do nothing`;

  // Both orgs get a current Pro entitlement. pro-monthly is auto-renewing, so this also
  // exercises the spec §5.4 constraint trigger: the insert fails without recorded consent.
  await sql`
    insert into entitlements (org_id, plan_id, status, current_period_start, current_period_end,
                              renewal_consent_at, renewal_consent_version)
      values (${FIXTURE.orgA}, ${FIXTURE.planId}, 'active',
              ${FIXTURE.periodStart}, ${FIXTURE.periodEnd}, ${FIXTURE.periodStart}, 'arl-v1'),
             (${FIXTURE.orgB}, ${FIXTURE.planId}, 'active',
              ${FIXTURE.periodStart}, ${FIXTURE.periodEnd}, ${FIXTURE.periodStart}, 'arl-v1')
      on conflict do nothing`;

  await sql`
    insert into sessions (id, org_id, user_id, loop_template_id, track_id, level_band)
      values (${FIXTURE.sessionA}, ${FIXTURE.orgA}, ${FIXTURE.userA}, ${FIXTURE.templateId},
              ${FIXTURE.trackId}, 'L5'),
             (${FIXTURE.sessionB}, ${FIXTURE.orgB}, ${FIXTURE.userB}, ${FIXTURE.templateId},
              ${FIXTURE.trackId}, 'L5')
      on conflict (id) do nothing`;
}
