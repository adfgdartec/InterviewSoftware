import postgres from 'postgres';
import { appUrl, ownerUrl } from './env.js';

export type Sql = ReturnType<typeof postgres>;

/**
 * Application connection: the loopcraft_app role, which is subject to RLS. Every query made
 * through this client is filtered by the policies in migration 0002, so a missing WHERE
 * clause degrades to "no rows" rather than to a cross-tenant read.
 */
export function appClient(url: string = appUrl()): Sql {
  return postgres(url, { max: 10, onnotice: () => {}, connection: { search_path: 'public' } });
}

/**
 * Owner connection: bypasses RLS. Only migrations, seeds, retention jobs and first-signup
 * provisioning may use it.
 *
 * `max` is a parameter because the callers want very different things. A migration wants a
 * few connections; per-request provisioning wants exactly ONE, because it opens a pool, runs
 * a single short transaction and closes it again. Opening four for that exhausted the
 * Supabase session pooler (15 clients) under a burst of sign-ins -- observed as
 * `EMAXCONNSESSION` taking down every route, not just the one provisioning.
 */
export function ownerClient(url: string = ownerUrl(), max = 4): Sql {
  return postgres(url, { max, onnotice: () => {}, connection: { search_path: 'public' } });
}

/** One connection, for a single short transaction on a request path. */
export function provisioningClient(): Sql {
  return ownerClient(ownerUrl(), 1);
}

/**
 * Runs `fn` inside a transaction bound to `userId`, which is what every RLS policy reads.
 * The id is set with set_config(..., true) so it is scoped to the transaction and cannot
 * leak onto the next request that borrows the same pooled connection.
 */
export async function asUser<T>(
  sql: Sql,
  userId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.current_user_id', ${userId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}
