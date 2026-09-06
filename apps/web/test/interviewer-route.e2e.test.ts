import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { appClient, ownerClient, FIXTURE } from '@loopcraft/db';
import { loopTemplateById, itemsFor } from '@loopcraft/core';
import { postgresEntitlementStore } from '../src/server/entitlement-store.js';
import { FixedWindowRateLimiter } from '../src/server/rate-limit.js';
import { postSession, postTurn, type RouteDeps } from '../src/server/routes.js';
import { heuristicGraderSampler } from '../src/server/heuristic-grader.js';
import { ollamaReachable } from '@loopcraft/providers';

/**
 * The real back-and-forth (spec §2.2), driven through the actual HTTP route with
 * interviewerEnabled: true, against real Ollama. Requires `ollama serve` with
 * llama3.2:latest pulled -- fails rather than skips if it is not reachable, same principle
 * as the sandbox escape suite: a conversational-interviewer test that quietly no-ops proves
 * nothing about whether the interviewer works.
 */

const TEMPLATE = loopTemplateById('team-owned-domain-loop')!; // 4 short rounds
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

function deps(overrides: Partial<RouteDeps> = {}): RouteDeps {
  return {
    authenticate: async () => ({ userId: FIXTURE.userA, orgId: FIXTURE.orgA }),
    entitlements: postgresEntitlementStore(sql, FIXTURE.userA),
    rateLimiter: new FixedWindowRateLimiter(1_000, 60_000),
    templates: { byId: loopTemplateById },
    items: { itemsFor },
    generator: null,
    sql,
    turnsPerRound: 1,
    costCeilingCents: 400,
    generationTimeoutMs: 20_000,
    graderSampler: heuristicGraderSampler(),
    owner: async (fn) => {
      const o = ownerClient();
      try {
        return await fn(o);
      } finally {
        await o.end({ timeout: 5 });
      }
    },
    interviewerEnabled: true,
    ...overrides,
  };
}

const post = (body: unknown): Request =>
  new Request('https://loopcraft.test/api/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify(body),
  });

interface View { sessionId: string; question: string | null; pendingTurnId: string; currentRoundPosition: number }

it('requires a reachable Ollama to test the real interviewer', async () => {
  expect(await ollamaReachable(), 'Run `ollama serve` with llama3.2:latest pulled.').toBe(true);
}, 5_000);

describe('the real interviewer keeps a weak answer\'s round open', () => {
  it('does not advance the round on a one-word answer, and the follow-up is real', async () => {
    const d = deps();
    const created = await postSession(post({ loopTemplateId: TEMPLATE.id, levelBand: 'L4' }), d);
    expect(created.status).toBe(201);
    const view = (await created.json()) as View;
    const startingPosition = view.currentRoundPosition;

    const res = await postTurn(
      post({ turnId: view.pendingTurnId, transcript: 'Fine.' }),
      view.sessionId, d,
    );
    expect(res.status).toBe(200);
    const after = (await res.json()) as View;

    // The round must NOT have advanced -- the interviewer should be following up, not
    // accepting a one-word non-answer and moving the candidate to the next round.
    expect(after.currentRoundPosition).toBe(startingPosition);
    expect(after.question).not.toBeNull();
    expect(after.question).not.toBe('Fine.');
    expect(after.question!.length).toBeGreaterThan(10);
  }, 30_000);

  it('does eventually advance once the candidate gives real content', async () => {
    const d = deps();
    const created = await postSession(post({ loopTemplateId: TEMPLATE.id, levelBand: 'L4' }), d);
    const view = (await created.json()) as View;
    const startingPosition = view.currentRoundPosition;

    const followUp = await postTurn(
      post({ turnId: view.pendingTurnId, transcript: 'idk' }), view.sessionId, d,
    );
    const afterVague = (await followUp.json()) as View;
    expect(afterVague.currentRoundPosition).toBe(startingPosition);

    const strong = await postTurn(
      post({
        turnId: afterVague.pendingTurnId,
        transcript:
          'The project I would point to is a checkpointing rewrite for large distributed ' +
          'training runs, because I traced a network-saturation stall to full optimizer-state ' +
          'writes and fixed it by sharding writes across replicas, cutting write volume 8x.',
      }),
      view.sessionId, d,
    );
    expect(strong.status).toBe(200);
    const afterStrong = (await strong.json()) as View;
    expect(afterStrong.currentRoundPosition).toBeGreaterThan(startingPosition);
  }, 40_000);
});
