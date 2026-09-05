import type { Sql } from '@loopcraft/db';
import { asUser } from '@loopcraft/db';
import type { AuthedUser } from './guards.js';
import { signupPermitted } from './signup-gate.js';

/**
 * Turns a freshly authenticated Supabase identity into the four rows this product needs:
 * a `users` row whose id equals the Supabase auth user id, an `orgs` row, a `memberships`
 * row, and a trial `entitlements` row.
 *
 * This is the same set `demoIdentity` created from a cookie, now behind a real identity and
 * carrying the age, jurisdiction and consent the signup form collected.
 *
 * It runs on the Postgres OWNER connection, for the same reason `demoIdentity` did: RLS
 * cannot authorize a brand-new user's own first rows, because there is no membership row to
 * check against until this function creates one. That is the boundary a real auth webhook
 * runs at. It is the database owner role -- there is no Supabase service-role key anywhere
 * in this flow.
 */

export class SignupNotPermittedError extends Error {
  readonly httpStatus = 403;
  constructor() {
    super('This account is not permitted under the age and region policy.');
    this.name = 'SignupNotPermittedError';
  }
}

export interface ProvisionInput {
  /** The Supabase auth user id. Becomes `users.id` so RLS resolves through either branch. */
  readonly userId: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly ageBand: string;
  readonly jurisdiction: string;
  readonly authProvider: 'password' | 'google';
  readonly termsVersion: string;
  readonly privacyVersion: string;
  /**
   * The plan a new account starts on. Explicit rather than a hardcoded constant: the id that
   * exists differs between the seeded test database and a real deployment, and silently
   * inserting an entitlement against a plan that does not exist fails on a foreign key at
   * signup -- the worst possible moment to discover it.
   */
  readonly planId: string;
}

const TRIAL_DAYS = 14;

interface MembershipRow {
  readonly org_id: string;
}

/**
 * Idempotent: a second sign-in for an already-provisioned identity returns the existing
 * org rather than creating a duplicate. Sign-in runs this on every request path that can
 * follow a callback, so "already exists" is the common case, not the edge case.
 */
export async function provisionUser(owner: Sql, input: ProvisionInput): Promise<AuthedUser> {
  const existing = await owner<MembershipRow[]>`
    select org_id from memberships where user_id = ${input.userId} limit 1`;
  const existingOrgId = existing[0]?.org_id;
  if (existingOrgId !== undefined) return { userId: input.userId, orgId: existingOrgId };

  // The gate is enforced in the Server Action before signUp is called, so a refused account
  // never reaches Supabase at all. Re-checked here because provisioning is the last place
  // that can refuse, and a bypass of the first check must not silently create an account.
  if (!signupPermitted({ ageBand: input.ageBand, jurisdiction: input.jurisdiction })) {
    throw new SignupNotPermittedError();
  }

  const periodStart = new Date();
  const periodEnd = new Date(periodStart.getTime() + TRIAL_DAYS * 86_400_000);

  return owner.begin(async (tx) => {
    const orgRows = await tx<{ id: string }[]>`
      insert into orgs (name, slug)
      values (${'Workspace'}, ${'w-' + input.userId.slice(0, 12)})
      returning id`;
    const orgId = orgRows[0]!.id;

    await tx`
      insert into users (id, email, display_name, age_band, jurisdiction,
                         terms_accepted_at, terms_version, privacy_version, auth_provider)
      values (${input.userId}, ${input.email}, ${input.displayName},
              ${input.ageBand}, ${input.jurisdiction},
              ${periodStart}, ${input.termsVersion}, ${input.privacyVersion},
              ${input.authProvider})`;

    await tx`
      insert into memberships (org_id, user_id, role)
      values (${orgId}, ${input.userId}, 'owner')`;

    await tx`
      insert into entitlements (org_id, plan_id, status, current_period_start, current_period_end)
      values (${orgId}, ${input.planId}, 'trialing', ${periodStart}, ${periodEnd})`;

    return { userId: input.userId, orgId };
  }) as Promise<AuthedUser>;
}

/**
 * Resolves an already-provisioned identity, or null. Run on every request, so it uses the
 * RLS-scoped app connection rather than the owner one.
 *
 * It must go through `asUser`: every policy on `memberships` and `users` compares against
 * `loopcraft.current_user_id()`, which is NULL on a connection that has not set it -- so a
 * bare query returns zero rows for a user who plainly exists, and the caller concludes the
 * identity is new and tries to provision it a second time. The JWT has already told us who
 * this is; `asUser` is how we tell the database.
 */
export async function findIdentity(sql: Sql, userId: string): Promise<AuthedUser | null> {
  const rows = await asUser(sql, userId, async (tx) => tx<MembershipRow[]>`
    select m.org_id from memberships m
    join users u on u.id = m.user_id
    where m.user_id = ${userId} and u.deleted_at is null
    limit 1`);
  const orgId = rows[0]?.org_id;
  return orgId === undefined ? null : { userId, orgId };
}
