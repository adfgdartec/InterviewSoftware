import type { Sql } from '@loopcraft/db';
import type { RateLimiter } from './guards.js';

/**
 * Fixed-window limiter keyed on the authenticated user.
 *
 * Two implementations, one interface. `guards.ts` calls `check(key)` and neither knows nor
 * cares which one it holds.
 */

function windowError(limit: number, windowMs: number): void {
  if (limit < 1) throw new RangeError('limit must be >= 1');
  if (windowMs < 1) throw new RangeError('windowMs must be >= 1');
}

/**
 * In-process, for tests and single-node local development.
 *
 * Deliberately NOT the production limiter any more: it keeps counters in a Map inside one
 * process, so on Workers -- which run many isolates -- every isolate starts at zero and the
 * limit is never reached. It is kept because it needs no database, which is exactly what a
 * unit test wants.
 */
export class FixedWindowRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    windowError(limit, windowMs);
  }

  async check(key: string): Promise<number | null> {
    const t = this.now();
    const existing = this.hits.get(key);
    if (existing === undefined || t - existing.windowStart >= this.windowMs) {
      this.hits.set(key, { count: 1, windowStart: t });
      return null;
    }
    if (existing.count < this.limit) {
      existing.count += 1;
      return null;
    }
    return Math.ceil((existing.windowStart + this.windowMs - t) / 1_000);
  }
}

interface RateLimitRow {
  readonly hits: number;
  readonly retry_after_seconds: number;
}

/**
 * Postgres-backed, shared across every process and isolate. This is the production limiter.
 *
 * The whole check is ONE statement. An upsert that both rolls the window and increments the
 * counter is atomic under Postgres' row lock, so two concurrent requests for the same key
 * cannot both read `hits = limit - 1` and both decide they may proceed -- which is exactly
 * the race a read-then-write pair would lose, and the race that matters when the thing being
 * guarded costs money per call.
 *
 * It runs on the app connection but deliberately NOT inside `asUser`: this table is in the
 * `loopcraft` schema and has no RLS policy to satisfy, and wrapping it in a transaction would
 * pin a pooled connection for the duration of a check that has to be cheap. Isolation comes
 * from the key, which guards.ts builds from the authenticated user id.
 *
 * A database failure DENIES the request rather than allowing it. A limiter that fails open is
 * not a limiter -- an outage would become an unmetered window on billable providers.
 */
export class PostgresRateLimiter implements RateLimiter {
  constructor(
    private readonly sql: Sql,
    private readonly limit: number,
    private readonly windowMs: number,
  ) {
    windowError(limit, windowMs);
  }

  async check(key: string): Promise<number | null> {
    const windowSeconds = this.windowMs / 1_000;
    try {
      const rows = await this.sql<RateLimitRow[]>`
        insert into loopcraft.rate_limits (bucket_key, window_start, hits)
        values (${key}, now(), 1)
        on conflict (bucket_key) do update set
          hits = case
            when loopcraft.rate_limits.window_start
                 < now() - make_interval(secs => ${windowSeconds})
            then 1
            else loopcraft.rate_limits.hits + 1
          end,
          window_start = case
            when loopcraft.rate_limits.window_start
                 < now() - make_interval(secs => ${windowSeconds})
            then now()
            else loopcraft.rate_limits.window_start
          end
        returning
          hits,
          ceil(extract(epoch from (
            window_start + make_interval(secs => ${windowSeconds}) - now()
          )))::int as retry_after_seconds`;

      const row = rows[0];
      if (row === undefined) return null;
      if (row.hits <= this.limit) return null;
      // A window that has just rolled can compute a non-positive remainder; never hand the
      // client a Retry-After of 0, which reads as "try again immediately".
      return Math.max(1, row.retry_after_seconds);
    } catch (error) {
      console.error('[rate-limit] check failed; denying the request', error);
      return Math.ceil(windowSeconds);
    }
  }

  /**
   * Drops windows that have already expired. Nothing reads them -- the upsert resets a stale
   * row in place -- so this is housekeeping to keep the table bounded, not correctness.
   */
  async sweep(olderThanMs = this.windowMs): Promise<number> {
    const seconds = olderThanMs / 1_000;
    const rows = await this.sql<{ id: string }[]>`
      delete from loopcraft.rate_limits
      where window_start < now() - make_interval(secs => ${seconds})
      returning bucket_key as id`;
    return rows.length;
  }
}
