import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE, appClient, ownerClient } from '@loopcraft/db';
import { ITEM_BANK, LOOP_TEMPLATES, loopTemplateById, rubricById } from '@loopcraft/core';
import { postgresEntitlementStore } from '../src/server/entitlement-store.js';
import { FixedWindowRateLimiter } from '../src/server/rate-limit.js';
import { getSession, postSession, postTurn, type RouteDeps } from '../src/server/routes.js';
import { demoGenerator } from '../src/server/demo.js';
import { itemsFor } from '@loopcraft/core';

/**
 * The demo-mode walkthrough, end to end, on the real catalog: a five-round senior ML systems
 * loop driven entirely through the API routes with every provider mocked.
 *
 * This is the test that proves demo mode "exercises real code paths, not a separate mock
 * UI": the only thing swapped out is the generator, at the same seam a live provider
 * occupies. The guard chain, entitlements, RLS, the durable engine and the fallback path are
 * all the production ones.
 */

const TEMPLATE = loopTemplateById('frontier-lab-ml-systems');

const sql = appClient();
afterAll(async () => {
  await sql.end({ timeout: 5 });
});

beforeEach(async () => {
  const owner = ownerClient();
  try {
    await owner`delete from usage_ledger`;
  } finally {
    await owner.end({ timeout: 5 });
  }
});

function deps(): RouteDeps {
  return {
    authenticate: async () => ({ userId: FIXTURE.userA, orgId: FIXTURE.orgA }),
    entitlements: postgresEntitlementStore(sql, FIXTURE.userA),
    rateLimiter: new FixedWindowRateLimiter(1_000, 60_000),
    templates: { byId: loopTemplateById },
    items: { itemsFor },
    generator: demoGenerator(ITEM_BANK),
    sql,
    turnsPerRound: 1,
    costCeilingCents: 400,
    generationTimeoutMs: 200,
    graderSampler: null,
    owner: async (fn) => {
      const o = ownerClient();
      try {
        return await fn(o);
      } finally {
        await o.end({ timeout: 5 });
      }
    },
  };
}

const post = (body: unknown): Request =>
  new Request('https://loopcraft.test/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(body),
  });

interface View {
  sessionId: string;
  status: string;
  currentRoundType: string | null;
  persona: string | null;
  question: string | null;
  pendingTurnId: string | null;
  answeredTurnCount: number;
  roundCount: number;
  trackId: string;
  levelBand: string;
}

describe('the demo loop runs end to end on the real catalog', () => {
  it('is a five-round ml-systems L5 loop including coding and design', () => {
    expect(TEMPLATE).toBeDefined();
    expect(TEMPLATE?.rounds.map((r) => r.roundType)).toEqual([
      'warmup', 'domain', 'coding', 'design', 'behavioral',
    ]);
  });

  it('completes all five rounds through the real routes', async () => {
    const d = deps();
    const created = await postSession(post({ loopTemplateId: TEMPLATE!.id, levelBand: 'L5' }), d);
    expect(created.status).toBe(201);
    let view = (await created.json()) as View;

    expect(view).toMatchObject({
      status: 'in_progress', trackId: 'ml-systems', levelBand: 'L5', roundCount: 5,
      currentRoundType: 'warmup', persona: 'Recruiter screen',
    });

    const seen: { roundType: string; persona: string; question: string }[] = [];
    for (let i = 0; i < 5; i += 1) {
      expect(view.question, `round ${i + 1} had no question`).toBeTruthy();
      seen.push({
        roundType: view.currentRoundType!,
        persona: view.persona!,
        question: view.question!,
      });
      const res = await postTurn(
        post({ turnId: view.pendingTurnId, transcript: `Answer for round ${i + 1}. ` +
          'I would start by establishing the constraints, then trace the data path.' }),
        view.sessionId, d,
      );
      expect(res.status).toBe(200);
      view = (await res.json()) as View;
    }

    expect(view.status).toBe('completed');
    expect(view.answeredTurnCount).toBe(5);
    expect(view.question).toBeNull();

    expect(seen.map((s) => s.roundType)).toEqual([
      'warmup', 'domain', 'coding', 'design', 'behavioral',
    ]);
    // Five distinct interviewer personas, and five distinct questions.
    expect(new Set(seen.map((s) => s.persona)).size).toBe(5);
    expect(new Set(seen.map((s) => s.question)).size).toBe(5);
  });

  it('draws every question from the provenance-tagged bank', async () => {
    const d = deps();
    const created = await postSession(post({ loopTemplateId: TEMPLATE!.id, levelBand: 'L5' }), d);
    let view = (await created.json()) as View;
    const prompts = new Set(ITEM_BANK.map((i) => i.prompt));
    for (let i = 0; i < 5; i += 1) {
      expect(prompts.has(view.question!), `round ${i + 1} question not in the bank`).toBe(true);
      const res = await postTurn(
        post({ turnId: view.pendingTurnId, transcript: 'A sufficiently detailed answer.' }),
        view.sessionId, d,
      );
      view = (await res.json()) as View;
    }
  });

  it('resumes the demo loop mid-way from a fresh request', async () => {
    const d = deps();
    const created = await postSession(post({ loopTemplateId: TEMPLATE!.id, levelBand: 'L5' }), d);
    let view = (await created.json()) as View;
    for (let i = 0; i < 2; i += 1) {
      const res = await postTurn(
        post({ turnId: view.pendingTurnId, transcript: 'Answer.' }), view.sessionId, d,
      );
      view = (await res.json()) as View;
    }
    const resumed = await getSession(
      new Request('https://loopcraft.test/api/sessions/x'), view.sessionId, d,
    );
    const after = (await resumed.json()) as View;
    expect(after).toMatchObject({
      status: 'in_progress', currentRoundType: 'coding', answeredTurnCount: 2,
    });
  });

  it('every round of the demo loop resolves to a fully anchored rubric', () => {
    for (const round of TEMPLATE!.rounds) {
      const rubric = rubricById(round.rubricId);
      expect(rubric, `round ${round.position} rubric missing`).toBeDefined();
      for (const dim of rubric!.dimensions) {
        expect(dim.anchors).toHaveLength(5);
      }
    }
  });

  it('offers every published template through the same route', async () => {
    const d = deps();
    for (const template of LOOP_TEMPLATES) {
      const res = await postSession(
        post({ loopTemplateId: template.id, levelBand: template.levelBand }), d,
      );
      expect({ id: template.id, status: res.status }).toEqual({ id: template.id, status: 201 });
      const view = (await res.json()) as View;
      expect(view.question, `${template.id} issued no first question`).toBeTruthy();
    }
  });
});
