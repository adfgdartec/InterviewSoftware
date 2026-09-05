import type { Sql } from '@loopcraft/db';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthedUser } from './guards.js';
import { findIdentity, provisionUser } from './provisioning.js';

/**
 * The seam. `RouteDeps.authenticate` is the entire interface between identity and the rest
 * of the product: the guard chain, `asUser`, and every RLS policy sit below this line and
 * are unchanged by real auth arriving.
 *
 * The one correctness detail worth naming: this calls `getUser()`, which validates the token
 * against the Auth server, and never `getSession()`, which decodes the cookie without
 * verifying it. Reversing those two is the standard Supabase SSR vulnerability -- a forged
 * cookie authenticates -- and it type-checks and passes every functional test. A test in
 * auth.test.ts asserts the call site for exactly that reason.
 */

export const TERMS_VERSION = '2026-09-04';
export const PRIVACY_VERSION = '2026-09-04';

export interface AuthPorts {
  /** Supabase client bound to this request's cookies. */
  readonly supabase: Pick<SupabaseClient['auth'], 'getUser'> | SupabaseClient['auth'];
  /** RLS-scoped app connection, for reading the caller's own membership. */
  readonly sql: Sql;
  /** Owner connection factory, used only when a verified identity has no rows yet. */
  readonly owner: () => Sql;
  /** Plan a newly provisioned account starts on. */
  readonly planId: string;
}

interface SupabaseUserShape {
  readonly id: string;
  readonly email?: string | null;
  readonly user_metadata?: Record<string, unknown> | null;
  readonly app_metadata?: Record<string, unknown> | null;
}

function str(source: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = source?.[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Returns the authenticated user, or null. Null is not an error here: the guard chain turns
 * it into the same 401 it already produced for an unauthenticated caller, so nothing
 * downstream needed to change.
 */
export async function authenticateWith(ports: AuthPorts): Promise<AuthedUser | null> {
  const { data, error } = await ports.supabase.getUser();
  if (error !== null || data.user === null || data.user === undefined) return null;
  const user = data.user as unknown as SupabaseUserShape;
  if (typeof user.id !== 'string' || user.id === '') return null;

  const existing = await findIdentity(ports.sql, user.id);
  if (existing !== null) return existing;

  // A verified identity with no rows: either a Google sign-in landing for the first time, or
  // an email confirmation completing after signUp. Provision from the metadata the signup
  // form attached. Age and jurisdiction are re-gated inside provisionUser, so a Google user
  // who never answered them is refused rather than admitted with `unknown`.
  const email = user.email ?? null;
  if (email === null) return null;

  const meta = user.user_metadata ?? null;
  const provider = str(user.app_metadata ?? null, 'provider') === 'google' ? 'google' : 'password';

  const owner = ports.owner();
  try {
    return await provisionUser(owner, {
      userId: user.id,
      email,
      displayName: str(meta, 'display_name') ?? str(meta, 'full_name'),
      ageBand: str(meta, 'age_band') ?? 'unknown',
      jurisdiction: str(meta, 'jurisdiction') ?? 'unknown',
      authProvider: provider,
      termsVersion: str(meta, 'terms_version') ?? TERMS_VERSION,
      privacyVersion: str(meta, 'privacy_version') ?? PRIVACY_VERSION,
      planId: ports.planId,
    });
  } catch {
    // A refused signup (age/region) or a provisioning failure must read as "not signed in",
    // never as a 500 that leaves a half-made account looking usable.
    return null;
  } finally {
    await owner.end({ timeout: 5 });
  }
}
