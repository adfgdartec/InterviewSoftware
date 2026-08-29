import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  MissingIdempotencyKeyError,
  RateLimitedError,
  UnauthorizedError,
  ValidationError,
  assertNoForbiddenFields,
  guard,
  toErrorResponse,
  type GuardPorts,
} from '../src/server/guards.js';
import {
  EntitlementDeniedError,
  assertFeature,
  assertSessionQuota,
  resolveEntitlement,
  type EntitlementStore,
  type PlanRow,
} from '../src/server/entitlements.js';

const PRO: PlanRow = {
  id: 'pro-monthly',
  name: 'Pro (monthly)',
  priceCents: 4_900,
  includedSessions: 8,
  includedAsrMinutes: 400,
  allowsLoopSimulation: true,
  allowsCodeExecution: true,
  allowsVideo: false,
};

const FREE: PlanRow = {
  id: 'free',
  name: 'Free',
  priceCents: 0,
  includedSessions: 2,
  includedAsrMinutes: 20,
  allowsLoopSimulation: false,
  allowsCodeExecution: false,
  allowsVideo: false,
};

const NOW = new Date('2026-08-29T12:00:00Z');

function store(overrides: Partial<EntitlementStore> = {}, plan: PlanRow = PRO, sessionsUsed = 0): EntitlementStore {
  return {
    activeEntitlement: async () => ({
      orgId: 'org-a',
      planId: plan.id,
      status: 'active' as const,
      currentPeriodStart: new Date('2026-08-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-09-01T00:00:00Z'),
    }),
    plan: async (id) => (id === plan.id ? plan : null),
    usage: async () => ({ sessionsThisPeriod: sessionsUsed, asrMinutesThisPeriod: 0 }),
    ...overrides,
  };
}

describe('entitlement resolution is server-side only (guardrail 5)', () => {
  it('resolves the plan from the org, never from the request', async () => {
    const resolved = await resolveEntitlement(store(), 'org-a', NOW);
    expect(resolved.plan.id).toBe('pro-monthly');
    expect(resolved.sessionsRemaining).toBe(8);
  });

  it.each([
    ['canceled' as const, 'subscription_not_current'],
    ['past_due' as const, 'subscription_not_current'],
    ['expired' as const, 'subscription_not_current'],
  ])('denies a %s subscription', async (status, code) => {
    const s = store({
      activeEntitlement: async () => ({
        orgId: 'org-a',
        planId: PRO.id,
        status,
        currentPeriodStart: new Date('2026-08-01T00:00:00Z'),
        currentPeriodEnd: new Date('2026-09-01T00:00:00Z'),
      }),
    });
    await expect(resolveEntitlement(s, 'org-a', NOW)).rejects.toMatchObject({ code });
  });

  it('denies when there is no subscription at all', async () => {
    const s = store({ activeEntitlement: async () => null });
    await expect(resolveEntitlement(s, 'org-a', NOW)).rejects.toMatchObject({
      code: 'no_active_subscription',
    });
  });

  it('denies outside the current billing period, at both edges', async () => {
    const before = new Date('2026-07-31T23:59:59Z');
    const after = new Date('2026-09-01T00:00:00Z');
    await expect(resolveEntitlement(store(), 'org-a', before)).rejects.toThrow(EntitlementDeniedError);
    await expect(resolveEntitlement(store(), 'org-a', after)).rejects.toThrow(EntitlementDeniedError);
  });

  it('denies when the entitlement names a plan absent from the catalog', async () => {
    const s = store({ plan: async () => null });
    await expect(resolveEntitlement(s, 'org-a', NOW)).rejects.toMatchObject({
      code: 'no_active_subscription',
    });
  });

  it('clamps remaining volume at zero rather than reporting a negative balance', async () => {
    const resolved = await resolveEntitlement(store({}, PRO, 99), 'org-a', NOW);
    expect(resolved.sessionsRemaining).toBe(0);
  });

  it('gates features on the plan row (spec §4 Free excludes loops and execution)', async () => {
    const free = await resolveEntitlement(store({}, FREE), 'org-a', NOW);
    expect(() => assertFeature(free, 'loop_simulation')).toThrow(/does not include/);
    expect(() => assertFeature(free, 'code_execution')).toThrow(/does not include/);
    const pro = await resolveEntitlement(store(), 'org-a', NOW);
    expect(() => assertFeature(pro, 'loop_simulation')).not.toThrow();
    // Video is off by default on every plan (spec §5.1).
    expect(() => assertFeature(pro, 'video_processing')).toThrow(/does not include/);
  });

  it('refuses a session once included volume is spent', async () => {
    const spent = await resolveEntitlement(store({}, FREE, 2), 'org-a', NOW);
    expect(() => assertSessionQuota(spent)).toThrow(/includes 2 sessions/);
  });
});

describe('server-authoritative fields cannot be supplied by a client', () => {
  it.each(['planId', 'usageCount', 'score', 'orgId', 'itemId', 'question', 'theta'])(
    'rejects a body carrying %s',
    (field) => {
      expect(() => assertNoForbiddenFields({ [field]: 'anything' })).toThrow(ValidationError);
    },
  );

  it('allows an ordinary body', () => {
    expect(() => assertNoForbiddenFields({ templateId: 'frontier-lab', levelBand: 'L5' })).not.toThrow();
  });

  it('tolerates non-object bodies', () => {
    expect(() => assertNoForbiddenFields(null)).not.toThrow();
    expect(() => assertNoForbiddenFields('string')).not.toThrow();
  });
});

describe('the guard chain runs in the order spec §3.3 requires', () => {
  const schema = z.object({ templateId: z.string().min(1) });
  let calls: string[];

  function ports(overrides: Partial<GuardPorts> = {}): GuardPorts {
    return {
      authenticate: async () => {
        calls.push('auth');
        return { userId: 'user-a', orgId: 'org-a' };
      },
      entitlements: {
        activeEntitlement: async (orgId) => {
          calls.push(`entitlement:${orgId}`);
          return {
            orgId,
            planId: PRO.id,
            status: 'active' as const,
            currentPeriodStart: new Date('2026-08-01T00:00:00Z'),
            currentPeriodEnd: new Date('2026-09-01T00:00:00Z'),
          };
        },
        plan: async () => PRO,
        usage: async () => ({ sessionsThisPeriod: 0, asrMinutesThisPeriod: 0 }),
      },
      rateLimiter: {
        check: async (key) => {
          calls.push(`rate:${key}`);
          return null;
        },
      },
      ...overrides,
    };
  }

  function post(body: unknown, headers: Record<string, string> = { 'Idempotency-Key': 'k-1' }): Request {
    return new Request('https://loopcraft.test/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    calls = [];
  });

  it('authenticates, then entitles, then rate-limits, then validates', async () => {
    const result = await guard(post({ templateId: 'frontier-lab' }), ports(), {
      schema,
      mutating: true,
      rateLimitBucket: 'sessions.create',
    }, NOW);
    expect(calls).toEqual(['auth', 'entitlement:org-a', 'rate:sessions.create:user-a']);
    expect(result.body.templateId).toBe('frontier-lab');
    expect(result.user.orgId).toBe('org-a');
  });

  it('rate-limits on the authenticated user, not on anything the client sent', async () => {
    await guard(post({ templateId: 'x' }), ports(), {
      schema, mutating: true, rateLimitBucket: 'sessions.create',
    }, NOW);
    expect(calls.at(-1)).toBe('rate:sessions.create:user-a');
  });

  it('rejects an unauthenticated request before touching entitlements', async () => {
    await expect(
      guard(post({ templateId: 'x' }), ports({ authenticate: async () => null }), {
        schema, mutating: true, rateLimitBucket: 'sessions.create',
      }, NOW),
    ).rejects.toThrow(UnauthorizedError);
    expect(calls).toEqual([]);
  });

  it('does not validate the body of an unauthenticated request', async () => {
    await expect(
      guard(post({ nonsense: true }), ports({ authenticate: async () => null }), {
        schema, mutating: true, rateLimitBucket: 'sessions.create',
      }, NOW),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('surfaces the rate limiter retry hint', async () => {
    const p = ports({ rateLimiter: { check: async () => 30 } });
    await expect(
      guard(post({ templateId: 'x' }), p, { schema, mutating: true, rateLimitBucket: 'b' }, NOW),
    ).rejects.toMatchObject({ retryAfterSeconds: 30 });
  });

  it('requires an Idempotency-Key on every mutating route (spec §3.2)', async () => {
    await expect(
      guard(post({ templateId: 'x' }, {}), ports(), {
        schema, mutating: true, rateLimitBucket: 'b',
      }, NOW),
    ).rejects.toThrow(MissingIdempotencyKeyError);
  });

  it('rejects a blank Idempotency-Key as firmly as a missing one', async () => {
    await expect(
      guard(post({ templateId: 'x' }, { 'Idempotency-Key': '   ' }), ports(), {
        schema, mutating: true, rateLimitBucket: 'b',
      }, NOW),
    ).rejects.toThrow(MissingIdempotencyKeyError);
  });

  it('reports every validation issue, and rejects malformed JSON', async () => {
    await expect(
      guard(post({ templateId: '' }), ports(), { schema, mutating: true, rateLimitBucket: 'b' }, NOW),
    ).rejects.toThrow(ValidationError);

    const bad = new Request('https://loopcraft.test/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'k' },
      body: '{not json',
    });
    await expect(
      guard(bad, ports(), { schema, mutating: true, rateLimitBucket: 'b' }, NOW),
    ).rejects.toThrow(ValidationError);
  });

  it('refuses a body that tries to set its own plan', async () => {
    await expect(
      guard(post({ templateId: 'x', planId: 'enterprise' }), ports(), {
        schema, mutating: true, rateLimitBucket: 'b',
      }, NOW),
    ).rejects.toThrow(/resolved server-side/);
  });
});

describe('error responses leak nothing (audit defects 5 and 12)', () => {
  it.each([
    [new UnauthorizedError(), 401, 'unauthorized'],
    [new EntitlementDeniedError('session_quota_exhausted', 'Out of sessions.'), 402, 'session_quota_exhausted'],
    [new RateLimitedError(10), 429, 'rate_limited'],
    [new MissingIdempotencyKeyError(), 400, 'idempotency_key_required'],
    [new ValidationError(['a: required']), 400, 'invalid_request'],
  ])('maps %s correctly', (error, status, code) => {
    const out = toErrorResponse(error, 'err-1');
    expect(out.status).toBe(status);
    expect(out.body.code).toBe(code);
  });

  it('collapses an unexpected error to an opaque body with no path or stack', () => {
    const boom = new Error('ENOENT: /Users/someone/uploads/interview.webm not found');
    const out = toErrorResponse(boom, 'err-2');
    expect(out.status).toBe(500);
    const serialized = JSON.stringify(out.body);
    expect(serialized).not.toContain('/Users/');
    expect(serialized).not.toContain('ENOENT');
    expect(serialized).not.toContain('stack');
    expect(out.body.errorId).toBe('err-2');
  });
});
