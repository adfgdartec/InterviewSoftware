import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE, appClient, ownerClient } from '@loopcraft/db';
import { ITEM_BANK, findBannedTokensInText, findClaimViolations, itemsFor, loopTemplateById, rubricById } from '@loopcraft/core';
import type { GraderSampler } from '@loopcraft/scoring';
import { postgresEntitlementStore } from '../src/server/entitlement-store.js';
import { FixedWindowRateLimiter } from '../src/server/rate-limit.js';
import { postDebrief, postSession, postTurn, type RouteDeps } from '../src/server/routes.js';
import { demoGenerator } from '../src/server/demo.js';

/**
 * The full demo deliverable: a five-round senior ML systems loop, graded, ending in a
 * debrief packet with uncertainty intervals -- driven entirely through the API routes with
 * every provider mocked.
 */

const TEMPLATE = loopTemplateById('frontier-lab-ml-systems')!;
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

/**
 * Deterministic grader. Returns a level derived from the rubric's own dimension list so the
 * demo produces a varied, reproducible profile rather than a flat score, and varies by
 * sample index so the n=3 spread is real rather than always unanimous.
 */
function demoSampler(): GraderSampler {
  return {
    sample: async (prompt, _temperature, sampleIndex) => {
      const rubricId = /Rubric (\S+) /.exec(prompt)?.[1] ?? '';
      const rubric = rubricById(rubricId);
      if (rubric === undefined) return {};

      // A REAL span of the candidate's answer, lifted out of the prompt the sampler was
      // given. This fixture used to fabricate `I would start by establishing the constraints
      // for ${d.id}` -- text that appeared nowhere in the transcript -- and the debrief then
      // rendered it under "Quoted from your answer". The grader contract now rejects a quote
      // it cannot find in the answer, so a fixture that invents one no longer passes, which
      // is the point: the double has to satisfy the same contract the real grader does.
      const answer = (prompt.split('Transcript:\n')[1] ?? '')
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('Q:'))
        .map((line) => line.replace(/^\s*A:\s*/, ''))
        .join(' ')
        .trim();
      const sentences = answer.split(/(?<=[.!?])\s+/).filter((x) => x.trim().length > 0);

      return {
        dimensions: rubric.dimensions.map((d, i) => ({
          dimension: d.id,
          level: Math.min(5, Math.max(1, 3 + ((i + sampleIndex) % 3) - 1)),
          // Rotate through the answer's own sentences so different dimensions cite
          // different evidence, as a real grader would.
          evidenceQuote: sentences[i % Math.max(1, sentences.length)] ?? answer,
        })),
      };
    },
  };
}

function deps(overrides: Partial<RouteDeps> = {}): RouteDeps {
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
    graderSampler: demoSampler(),
    ...overrides,
  };
}

const post = (body: unknown): Request =>
  new Request('https://loopcraft.test/api/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(body),
  });

interface View { sessionId: string; status: string; pendingTurnId: string | null }

async function runFullLoop(d: RouteDeps): Promise<string> {
  const created = await postSession(post({ loopTemplateId: TEMPLATE.id, levelBand: 'L5' }), d);
  let view = (await created.json()) as View;
  for (let i = 0; i < TEMPLATE.rounds.length; i += 1) {
    const res = await postTurn(
      post({
        turnId: view.pendingTurnId,
        transcript:
          'I would start by pinning down the constraints: request volume and the p99 budget. ' +
          'At 40k writes a second the single-node option is out. The failure I would watch ' +
          'for is a hot shard under key skew, which shows as rising queue depth.',
      }),
      view.sessionId, d,
    );
    view = (await res.json()) as View;
  }
  expect(view.status).toBe('completed');
  return view.sessionId;
}

describe('the graded demo loop ends in a debrief packet', () => {
  it('grades every round and returns a packet with intervals', async () => {
    const d = deps();
    const sessionId = await runFullLoop(d);
    const res = await postDebrief(post({}), sessionId, d);
    expect(res.status).toBe(200);
    const packet = await res.json();

    expect(packet.sessionId).toBe(sessionId);
    expect(packet.trackId).toBe('ml-systems');
    expect(packet.levelBand).toBe('L5');
    expect(packet.roundCount).toBe(5);
    expect(packet.attributes.length).toBeGreaterThan(0);

    for (const attribute of packet.attributes) {
      expect(attribute.display).toMatch(/^\d\.\d ± \d\.\d$/);
      expect(attribute.score.intervalHigh).toBeGreaterThan(attribute.score.intervalLow);
      expect(attribute.quote.length).toBeGreaterThan(0);
    }
    expect(packet.overallDisplay).toMatch(/^\d\.\d ± \d\.\d$/);
    expect(packet.calibrationLink).toBe('/calibration');
    expect(packet.practiceFocus.length).toBeGreaterThan(0);
  });

  it('persists the grade, so a second request re-reads rather than re-grades', async () => {
    const d = deps();
    const sessionId = await runFullLoop(d);
    const first = await (await postDebrief(post({}), sessionId, d)).json();

    let calls = 0;
    const counting = deps({
      graderSampler: {
        sample: async (...args) => {
          calls += 1;
          return demoSampler().sample(...args);
        },
      },
    });
    const second = await (await postDebrief(post({}), sessionId, counting)).json();
    expect(calls).toBe(0);
    expect(second.overallDisplay).toBe(first.overallDisplay);
    expect(second.attributes.length).toBe(first.attributes.length);
  });

  it('writes grader_runs, scores and score_dimensions rows', async () => {
    const d = deps();
    const sessionId = await runFullLoop(d);
    await postDebrief(post({}), sessionId, d);

    const owner = ownerClient();
    try {
      const [scores] = await owner<{ n: number }[]>`
        select count(*)::int as n from scores s
        join rounds r on r.id = s.round_id where r.session_id = ${sessionId}`;
      const [dims] = await owner<{ n: number }[]>`
        select count(*)::int as n from score_dimensions d
        join scores s on s.id = d.score_id
        join rounds r on r.id = s.round_id where r.session_id = ${sessionId}`;
      const [runs] = await owner<{ n: number }[]>`
        select count(*)::int as n from grader_runs g
        join rounds r on r.id = g.round_id where r.session_id = ${sessionId}`;
      expect(scores?.n).toBe(5);
      expect(dims?.n).toBeGreaterThan(10);
      expect(runs?.n).toBe(15); // five rounds x three samples
    } finally {
      await owner.end({ timeout: 5 });
    }
  });

  it('refuses to grade a loop that is not complete', async () => {
    const d = deps();
    const created = await postSession(post({ loopTemplateId: TEMPLATE.id, levelBand: 'L5' }), d);
    const view = (await created.json()) as View;
    const res = await postDebrief(post({}), view.sessionId, d);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'conflict' });
  });

  it('reports 503 rather than an empty packet when grading is unconfigured', async () => {
    const d = deps();
    const sessionId = await runFullLoop(d);
    const res = await postDebrief(post({}), sessionId, deps({ graderSampler: null }));
    expect(res.status).toBe(503);
  });

  it("another tenant cannot fetch the packet", async () => {
    const d = deps();
    const sessionId = await runFullLoop(d);
    await postDebrief(post({}), sessionId, d);
    const other = deps({
      authenticate: async () => ({ userId: FIXTURE.userB, orgId: FIXTURE.orgB }),
      entitlements: postgresEntitlementStore(sql, FIXTURE.userB),
    });
    const res = await postDebrief(post({}), sessionId, other);
    expect([404, 409]).toContain(res.status);
  });

  it('says nothing the claims policy forbids and nothing about internal states', async () => {
    const d = deps();
    const sessionId = await runFullLoop(d);
    const packet = await (await postDebrief(post({}), sessionId, d)).json();

    const strings: Record<string, string> = {
      methodNote: packet.methodNote,
      overall: packet.overallDisplay,
    };
    for (const a of packet.attributes) {
      strings[`attr.${a.dimension}.name`] = a.name;
      strings[`attr.${a.dimension}.quote`] = a.quote;
    }
    expect(findClaimViolations(strings)).toEqual([]);
    const affect = Object.entries(strings)
      .filter(([, v]) => findBannedTokensInText(v).length > 0)
      .map(([k]) => k);
    expect(affect).toEqual([]);
  });
});
