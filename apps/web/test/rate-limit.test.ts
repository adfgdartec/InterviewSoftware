import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { appClient } from '@loopcraft/db';
import { FixedWindowRateLimiter, PostgresRateLimiter } from '../src/server/rate-limit.js';

const sql = appClient();
afterAll(async () => {
  await sql.end({ timeout: 5 });
});

const KEY = 'test-bucket:00000000-0000-4000-8000-00000000rate';

beforeEach(async () => {
  await sql`delete from loopcraft.rate_limits where bucket_key like ${'test-bucket:%'}`;
});

describe('PostgresRateLimiter', () => {
  it('allows up to the limit and then refuses', async () => {
    const limiter = new PostgresRateLimiter(sql, 3, 60_000);
    expect(await limiter.check(KEY)).toBeNull();
    expect(await limiter.check(KEY)).toBeNull();
    expect(await limiter.check(KEY)).toBeNull();

    const wait = await limiter.check(KEY);
    expect(wait).not.toBeNull();
    expect(wait!).toBeGreaterThan(0);
    expect(wait!).toBeLessThanOrEqual(60);
  });

  /**
   * The reason this class exists. Two limiter instances stand in for two Worker isolates or
   * two Node processes: they share no memory, only the database. The old in-memory limiter
   * passes every other test in this file and fails this one, because each instance would
   * start its own count at zero.
   */
  it('counts across independent instances that share no memory', async () => {
    const a = new PostgresRateLimiter(sql, 3, 60_000);
    const b = new PostgresRateLimiter(sql, 3, 60_000);

    expect(await a.check(KEY)).toBeNull();
    expect(await b.check(KEY)).toBeNull();
    expect(await a.check(KEY)).toBeNull();

    // Fourth request against a limit of three, arriving at the instance that has only seen
    // two of them. It must still be refused.
    expect(await b.check(KEY)).not.toBeNull();
  });

  it('keeps separate keys separate', async () => {
    const limiter = new PostgresRateLimiter(sql, 1, 60_000);
    expect(await limiter.check('test-bucket:one')).toBeNull();
    expect(await limiter.check('test-bucket:two')).toBeNull();
    expect(await limiter.check('test-bucket:one')).not.toBeNull();
  });

  it('rolls the window, so a refusal is temporary', async () => {
    // A 1ms window is expired by the time the second call runs, which is the point.
    const limiter = new PostgresRateLimiter(sql, 1, 1);
    expect(await limiter.check(KEY)).toBeNull();
    await new Promise((r) => setTimeout(r, 25));
    expect(await limiter.check(KEY)).toBeNull();
  });

  it('never returns a retry-after of zero', async () => {
    // A window on the cusp of rolling can compute a non-positive remainder; handing that to
    // a client reads as "retry immediately", which is the opposite of what was decided.
    const limiter = new PostgresRateLimiter(sql, 1, 1_000);
    await limiter.check(KEY);
    for (let i = 0; i < 5; i++) {
      const wait = await limiter.check(KEY);
      if (wait !== null) expect(wait).toBeGreaterThanOrEqual(1);
    }
  });

  it('holds the limit under concurrent requests for the same key', async () => {
    // The race a read-then-write limiter loses: ten simultaneous callers each reading a
    // count below the limit and each concluding they may proceed. The upsert is atomic under
    // Postgres' row lock, so exactly `limit` of them are allowed.
    const limiter = new PostgresRateLimiter(sql, 4, 60_000);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => limiter.check(KEY)),
    );
    expect(results.filter((r) => r === null)).toHaveLength(4);
    expect(results.filter((r) => r !== null)).toHaveLength(6);
  });

  it('denies rather than allows when the database is unreachable', async () => {
    // A limiter that fails open is not a limiter: an outage would become an unmetered
    // window on two billable providers. The stand-in throws the moment it is used as a
    // tagged template, which is what a dead connection does.
    const unreachable = (() => {
      throw new Error('connection refused');
    }) as unknown as typeof sql;

    const limiter = new PostgresRateLimiter(unreachable, 5, 60_000);
    const wait = await limiter.check(KEY);
    expect(wait).not.toBeNull();
    expect(wait!).toBeGreaterThan(0);
  });

  it('rejects a nonsense configuration rather than accepting it', () => {
    expect(() => new PostgresRateLimiter(sql, 0, 60_000)).toThrow(RangeError);
    expect(() => new PostgresRateLimiter(sql, 5, 0)).toThrow(RangeError);
  });

  it('sweeps expired windows and leaves live ones alone', async () => {
    const live = new PostgresRateLimiter(sql, 5, 60_000);
    await live.check('test-bucket:live');

    await sql`
      insert into loopcraft.rate_limits (bucket_key, window_start, hits)
      values ('test-bucket:stale', now() - interval '2 hours', 9)`;

    const removed = await live.sweep(60_000);
    expect(removed).toBeGreaterThanOrEqual(1);

    const remaining = await sql<{ bucket_key: string }[]>`
      select bucket_key from loopcraft.rate_limits where bucket_key like ${'test-bucket:%'}`;
    expect(remaining.map((r) => r.bucket_key)).toContain('test-bucket:live');
    expect(remaining.map((r) => r.bucket_key)).not.toContain('test-bucket:stale');
  });
});

describe('FixedWindowRateLimiter (in-process, tests and local dev only)', () => {
  it('still enforces a limit within one instance', async () => {
    const limiter = new FixedWindowRateLimiter(2, 60_000, () => 1_000);
    expect(await limiter.check('k')).toBeNull();
    expect(await limiter.check('k')).toBeNull();
    expect(await limiter.check('k')).not.toBeNull();
  });

  it('demonstrably does NOT count across instances, which is why it is not the production one', async () => {
    const a = new FixedWindowRateLimiter(1, 60_000, () => 1_000);
    const b = new FixedWindowRateLimiter(1, 60_000, () => 1_000);
    expect(await a.check('k')).toBeNull();
    // Same key, limit of one, already spent -- and yet allowed, because `b` has its own Map.
    // This is the exact failure mode that made it unusable on Workers.
    expect(await b.check('k')).toBeNull();
  });
});
