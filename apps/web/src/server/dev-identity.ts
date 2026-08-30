import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { ownerClient, type Sql } from '@loopcraft/db';
import { DEV_PLAN_ID } from '@loopcraft/db';
import type { AuthedUser } from './guards.js';

/**
 * Dev-mode identity. There is no login UI or Supabase auth wired yet (recorded as a known
 * gap in docs/DELIVERY.md); this is what lets a browser actually use the product without
 * one. It is not fake auth: the cookie names a REAL row in `users`, a REAL row in `orgs`,
 * and a REAL active entitlement, provisioned once per browser. Every session, RLS check and
 * entitlement resolution downstream is exercised for real against that row -- only the
 * "how do you prove who you are" step is a cookie instead of a password.
 *
 * Provisioning runs on the owner connection because inserting a brand-new user's own first
 * rows is exactly the boundary case RLS cannot authorize yet (there is no membership row to
 * check against until this function creates one) -- the same reason a real auth webhook
 * runs with elevated privileges on signup.
 */

const COOKIE_NAME = 'lc_uid';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;

async function provision(sql: Sql): Promise<AuthedUser> {
  const userId = randomUUID();
  const orgId = randomUUID();
  const periodStart = new Date();
  const periodEnd = new Date(periodStart.getTime() + 30 * 86_400_000);

  await sql`insert into orgs (id, name, slug) values (${orgId}, 'Demo workspace', ${'demo-' + orgId.slice(0, 8)})`;
  await sql`insert into users (id, email, display_name) values (${userId}, ${userId + '@demo.loopcraft.local'}, 'Demo candidate')`;
  await sql`insert into memberships (org_id, user_id, role) values (${orgId}, ${userId}, 'owner')`;
  await sql`
    insert into entitlements (org_id, plan_id, status, current_period_start, current_period_end)
    values (${orgId}, ${DEV_PLAN_ID}, 'active', ${periodStart}, ${periodEnd})`;

  return { userId, orgId };
}

async function findExisting(sql: Sql, userId: string): Promise<AuthedUser | null> {
  const rows = await sql<{ org_id: string }[]>`
    select org_id from memberships where user_id = ${userId} limit 1`;
  const orgId = rows[0]?.org_id;
  return orgId === undefined ? null : { userId, orgId };
}

/**
 * Reads the identity cookie, provisions a fresh demo user+org if it is missing or stale,
 * and (re)sets the cookie. Safe to call on every request; provisioning only runs once.
 */
export async function demoIdentity(): Promise<AuthedUser> {
  const jar = await cookies();
  const existingId = jar.get(COOKIE_NAME)?.value;

  const sql = ownerClient();
  try {
    if (existingId !== undefined) {
      const found = await findExisting(sql, existingId);
      if (found !== null) return found;
    }
    const created = await provision(sql);
    jar.set(COOKIE_NAME, created.userId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: COOKIE_MAX_AGE_SECONDS,
    });
    return created;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
