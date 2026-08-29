import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE, appClient, ownerClient, seedItems } from '@loopcraft/db';
import type { Item, LoopTemplate } from '@loopcraft/core';
import { postgresEntitlementStore } from '../src/server/entitlement-store.js';
import { FixedWindowRateLimiter } from '../src/server/rate-limit.js';
import { getSession, postSession, postTurn, type RouteDeps } from '../src/server/routes.js';

/**
 * Integration layer from spec §3.5: full loop, resume-after-refresh, entitlement denial --
 * against real Postgres with RLS on and a mocked generator. Requests are real Request
 * objects so the guard chain, the engine and the store are exercised together.
 */

const TEMPLATE: LoopTemplate = {
  id: FIXTURE.templateId,
  name: 'Frontier lab ML systems loop',
  trackId: FIXTURE.trackId,
  levelBand: 'L5',
  sourceUrls: ['https://example.test/careers/interview-process'],
  modeledOnNote: 'Modeled on publicly reported interview formats.',
  rounds: [
    { position: 1, roundType: 'warmup', persona: 'Recruiter screen', rubricId: FIXTURE.rubricId, minutes: 5 },
    { position: 2, roundType: 'domain', persona: 'Staff ML systems engineer', rubricId: FIXTURE.rubricId, minutes: 45 },
  ],
};

// The prompt deliberately does not embed the item id: the client-projection test asserts the
// id never reaches the browser, and a fixture that leaks it into the prompt would fake a pass.
function bankItem(id: string, roundType: Item['roundType'], b: number): Item {
  return {
    id, trackId: FIXTURE.trackId, rubricId: FIXTURE.rubricId, roundType,
    prompt: `Catalog ${roundType} prompt: describe your approach in detail.`,
    provenance: 'rubric_generated', provenanceNote: `Generated against ${FIXTURE.rubricId}`,
    generatorRubricVersion: 1, difficultyB: b, discriminationA: 1.0, levelBands: ['L5'],
  };
}

const BANK: Item[] = [
  bankItem('11111111-1111-4111-8111-111111111111', 'warmup', -1),
  bankItem('22222222-2222-4222-8222-222222222222', 'domain', 0.2),
];

const sql = appClient();

/**
 * Setup mutations must go through the owner connection. The app client is subject to RLS and
 * has no acting user bound outside asUser, so a setup UPDATE through it silently affects
 * zero rows and the test then asserts against unchanged state.
 */
async function withOwner<T>(fn: (o: ReturnType<typeof ownerClient>) => Promise<T>): Promise<T> {
  const owner = ownerClient();
  try {
    return await fn(owner);
  } finally {
    await owner.end({ timeout: 5 });
  }
}

// turns.item_id is a foreign key into `items`, so a bank that exists only in TypeScript
// cannot be recorded against a turn. Seeding through the owner client mirrors how the real
// catalog is loaded at boot.
beforeAll(async () => {
  await withOwner((o) => seedItems(o, BANK));
});

// Each test starts from a clean quota. Without this the suite exhausts the fixture plan's
// eight included sessions partway through and every later test 402s -- which is the
// entitlement gate working, but it would mask whatever those tests were meant to check.
beforeEach(async () => {
  await withOwner(async (o) => {
    await o`delete from usage_ledger`;
    await o`update entitlements set status = 'active'`;
    await o`update plans set allows_loop_simulation = true, included_sessions = 8
            where id = ${FIXTURE.planId}`;
  });
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

function deps(
  userId: string = FIXTURE.userA,
  orgId: string = FIXTURE.orgA,
  overrides: Partial<RouteDeps> = {},
): RouteDeps {
  return {
    authenticate: async () => ({ userId, orgId }),
    entitlements: postgresEntitlementStore(sql, userId),
    rateLimiter: new FixedWindowRateLimiter(1_000, 60_000),
    templates: { byId: (id) => (id === TEMPLATE.id ? TEMPLATE : undefined) },
    items: { itemsFor: (_t, roundType) => BANK.filter((i) => i.roundType === roundType) },
    generator: null,
    sql,
    turnsPerRound: 1,
    costCeilingCents: 400,
    generationTimeoutMs: 50,
    graderSampler: null,
    ...overrides,
  };
}

function req(body: unknown, headers: Record<string, string> = { 'Idempotency-Key': 'k-1' }): Request {
  return new Request('https://loopcraft.test/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
const getReq = (): Request => new Request('https://loopcraft.test/api/sessions/x');

async function startLoop(d = deps()): Promise<{ sessionId: string; turnId: string }> {
  const res = await postSession(req({ loopTemplateId: TEMPLATE.id, levelBand: 'L5' }), d);
  expect(res.status).toBe(201);
  const view = (await res.json()) as { sessionId: string; pendingTurnId: string };
  return { sessionId: view.sessionId, turnId: view.pendingTurnId };
}

describe('POST /api/sessions', () => {
  it('creates a loop and issues its first question', async () => {
    const res = await postSession(req({ loopTemplateId: TEMPLATE.id, levelBand: 'L5' }), deps());
    expect(res.status).toBe(201);
    const view = await res.json();
    expect(view).toMatchObject({
      status: 'in_progress',
      trackId: FIXTURE.trackId,
      levelBand: 'L5',
      roundCount: 2,
      currentRoundPosition: 1,
      currentRoundType: 'warmup',
      persona: 'Recruiter screen',
      answeredTurnCount: 0,
    });
    expect(view.question).toContain('Catalog warmup prompt');
  });

  it('never returns an item id or storage key to the client', async () => {
    const res = await postSession(req({ loopTemplateId: TEMPLATE.id, levelBand: 'L5' }), deps());
    const serialized = JSON.stringify(await res.json());
    expect(serialized).not.toContain('itemId');
    expect(serialized).not.toContain('storage');
    expect(serialized).not.toContain(BANK[0]!.id);
  });

  it('404s an unknown template without leaking which templates exist', async () => {
    const res = await postSession(req({ loopTemplateId: 'does-not-exist', levelBand: 'L5' }), deps());
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'not_found' });
  });

  it('400s without an Idempotency-Key', async () => {
    const res = await postSession(req({ loopTemplateId: TEMPLATE.id, levelBand: 'L5' }, {}), deps());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'idempotency_key_required' });
  });

  it('401s an unauthenticated caller', async () => {
    const d = deps();
    const res = await postSession(req({ loopTemplateId: TEMPLATE.id, levelBand: 'L5' }), {
      ...d, authenticate: async () => null,
    });
    expect(res.status).toBe(401);
  });

  it('400s a body that supplies its own plan id (guardrail 5)', async () => {
    const res = await postSession(
      req({ loopTemplateId: TEMPLATE.id, levelBand: 'L5', planId: 'enterprise' }),
      deps(),
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('resolved server-side');
  });

  it('400s an invalid level band', async () => {
    const res = await postSession(req({ loopTemplateId: TEMPLATE.id, levelBand: 'L99' }), deps());
    expect(res.status).toBe(400);
  });

  it('429s past the rate limit and reports a retry hint', async () => {
    const d = deps(FIXTURE.userA, FIXTURE.orgA, {
      rateLimiter: new FixedWindowRateLimiter(1, 60_000),
    });
    expect((await postSession(req({ loopTemplateId: TEMPLATE.id, levelBand: 'L5' }), d)).status).toBe(201);
    const second = await postSession(req({ loopTemplateId: TEMPLATE.id, levelBand: 'L5' }), d);
    expect(second.status).toBe(429);
    expect(await second.json()).toMatchObject({ code: 'rate_limited' });
  });
});

describe('entitlement denial (spec §3.5 integration gate)', () => {
  it('402s when the subscription is canceled', async () => {
    await withOwner((o) => o`update entitlements set status = 'canceled' where org_id = ${FIXTURE.orgA}`);
    const res = await postSession(req({ loopTemplateId: TEMPLATE.id, levelBand: 'L5' }), deps());
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: 'subscription_not_current' });
  });

  it('402s when the plan does not include loop simulation', async () => {
    await withOwner((o) => o`update plans set allows_loop_simulation = false where id = ${FIXTURE.planId}`);
    try {
      const res = await postSession(req({ loopTemplateId: TEMPLATE.id, levelBand: 'L5' }), deps());
      expect(res.status).toBe(402);
      expect(await res.json()).toMatchObject({ code: 'feature_not_in_plan' });
    } finally {
      await withOwner((o) => o`update plans set allows_loop_simulation = true where id = ${FIXTURE.planId}`);
    }
  });

  it('402s once the included session volume is spent', async () => {
    await withOwner((o) => o`update plans set included_sessions = 0 where id = ${FIXTURE.planId}`);
    try {
      const res = await postSession(req({ loopTemplateId: TEMPLATE.id, levelBand: 'L5' }), deps());
      expect(res.status).toBe(402);
      expect(await res.json()).toMatchObject({ code: 'session_quota_exhausted' });
    } finally {
      await withOwner((o) => o`update plans set included_sessions = 8 where id = ${FIXTURE.planId}`);
    }
  });
});

describe('the full loop, and resuming it', () => {
  it('runs every round to completion', async () => {
    const d = deps();
    const { sessionId, turnId } = await startLoop(d);

    const afterFirst = await postTurn(
      req({ turnId, transcript: 'I have spent six years on distributed training systems.' }),
      sessionId, d,
    );
    expect(afterFirst.status).toBe(200);
    const mid = await afterFirst.json();
    expect(mid).toMatchObject({
      currentRoundPosition: 2, currentRoundType: 'domain', answeredTurnCount: 1,
      status: 'in_progress',
    });
    expect(mid.question).toContain('Catalog domain prompt');

    const afterSecond = await postTurn(
      req({ turnId: mid.pendingTurnId, transcript: 'I would shard the optimizer state first.' }),
      sessionId, d,
    );
    const done = await afterSecond.json();
    expect(done).toMatchObject({ status: 'completed', answeredTurnCount: 2, question: null });
  });

  it('resumes at the same turn from a fresh request (acceptance criterion 1)', async () => {
    const d = deps();
    const { sessionId, turnId } = await startLoop(d);
    await postTurn(req({ turnId, transcript: 'First answer.' }), sessionId, d);

    const resumed = await getSession(getReq(), sessionId, d);
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toMatchObject({
      sessionId, currentRoundPosition: 2, currentRoundType: 'domain', answeredTurnCount: 1,
      status: 'in_progress',
    });
  });

  it('rejects replaying an answer against an already-answered turn', async () => {
    const d = deps();
    const { sessionId, turnId } = await startLoop(d);
    await postTurn(req({ turnId, transcript: 'First answer.' }), sessionId, d);
    const replay = await postTurn(req({ turnId, transcript: 'Changed my mind.' }), sessionId, d);
    expect(replay.status).toBe(404);
  });
});

describe('cross-tenant isolation holds at the route layer', () => {
  it("user B cannot read user A's session", async () => {
    const { sessionId } = await startLoop(deps());
    const res = await getSession(getReq(), sessionId, deps(FIXTURE.userB, FIXTURE.orgB));
    expect(res.status).toBe(404);
  });

  it("user B cannot answer a turn in user A's session", async () => {
    const { sessionId, turnId } = await startLoop(deps());
    const res = await postTurn(
      req({ turnId, transcript: 'stolen' }), sessionId, deps(FIXTURE.userB, FIXTURE.orgB),
    );
    expect(res.status).toBe(404);
  });
});
