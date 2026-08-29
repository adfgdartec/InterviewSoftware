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

/** Owner connection: bypasses RLS. Only migrations, seeds and retention jobs may use it. */
export function ownerClient(url: string = ownerUrl()): Sql {
  return postgres(url, { max: 4, onnotice: () => {}, connection: { search_path: 'public' } });
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
