import type { RateLimiter } from './guards.js';

/**
 * Fixed-window limiter keyed on the authenticated user. In-process by design for now: it is
 * correct for a single node and honest about it. A multi-node deployment must swap this for
 * the Postgres-backed implementation before the limiter is load-bearing, which is recorded
 * in docs/DELIVERY.md under Known Gaps rather than as a comment pretending to be done.
 */
export class FixedWindowRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    if (limit < 1) throw new RangeError('limit must be >= 1');
    if (windowMs < 1) throw new RangeError('windowMs must be >= 1');
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
