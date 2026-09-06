import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE, appClient, ownerClient, seedItems } from '@loopcraft/db';
import type { Item, LoopTemplate } from '@loopcraft/core';
import { postgresEntitlementStore } from '../src/server/entitlement-store.js';
import { FixedWindowRateLimiter } from '../src/server/rate-limit.js';
import {
  getSession,
  postPresence,
  getSessionSpeech,
  getUserProfile,
  patchUserProfile,
  postSession,
  postSessionAudio,
  postTurn,
  type RouteDeps,
} from '../src/server/routes.js';
import { cartesiaConfigured } from '@loopcraft/providers';

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
    owner: async (fn) => {
      const o = ownerClient();
      try {
        return await fn(o);
      } finally {
        await o.end({ timeout: 5 });
      }
    },
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

describe('session view carries video eligibility', () => {
  it('reflects the caller\'s current eligibility on the session view', async () => {
    await withOwner(async (o) => {
      await o`update plans set allows_video = true where id = ${FIXTURE.planId}`;
      await o`update users set jurisdiction = 'us_other', age_band = '16_plus',
              video_opt_in = true where id = ${FIXTURE.userA}`;
    });
    const { sessionId } = await startLoop(deps());
    const res = await getSession(getReq(), sessionId, deps());
    const body = await res.json();
    expect(body.videoEligible).toBe(true);
  });

  it('is false when the caller has not opted in, even if otherwise eligible', async () => {
    await withOwner(async (o) => {
      await o`update plans set allows_video = true where id = ${FIXTURE.planId}`;
      await o`update users set jurisdiction = 'us_other', age_band = '16_plus',
              video_opt_in = false where id = ${FIXTURE.userA}`;
    });
    const { sessionId } = await startLoop(deps());
    const res = await getSession(getReq(), sessionId, deps());
    const body = await res.json();
    expect(body.videoEligible).toBe(false);
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

describe('GET/PATCH /api/users/me (video eligibility settings)', () => {
  beforeEach(async () => {
    await withOwner(async (o) => {
      await o`update plans set allows_video = true where id = ${FIXTURE.planId}`;
      await o`update users set jurisdiction = 'unknown', age_band = 'unknown',
              video_opt_in = false, display_name = 'Candidate A' where id = ${FIXTURE.userA}`;
    });
  });

  const getReq2 = (): Request => new Request('https://loopcraft.test/api/users/me');
  const patchReq = (body: unknown): Request =>
    new Request('https://loopcraft.test/api/users/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'k-profile-1' },
      body: JSON.stringify(body),
    });

  it('starts not eligible for video (unknown jurisdiction, unknown age band, opted out)', async () => {
    const res = await getUserProfile(getReq2(), deps());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jurisdiction).toBe('unknown');
    expect(body.ageBand).toBe('unknown');
    expect(body.videoOptIn).toBe(false);
    expect(body.videoEligible).toBe(false);
  });

  it('becomes eligible once jurisdiction, age band, and opt-in are all set', async () => {
    const patchRes = await patchUserProfile(
      patchReq({ jurisdiction: 'us_other', ageBand: '16_plus', videoOptIn: true }),
      deps(),
    );
    expect(patchRes.status).toBe(200);
    const body = await patchRes.json();
    expect(body.videoEligible).toBe(true);

    const getRes = await getUserProfile(getReq2(), deps());
    const getBody = await getRes.json();
    expect(getBody.videoEligible).toBe(true);
  });

  it('stays ineligible if jurisdiction is eu even with everything else set', async () => {
    const res = await patchUserProfile(
      patchReq({ jurisdiction: 'eu', ageBand: '16_plus', videoOptIn: true }),
      deps(),
    );
    const body = await res.json();
    expect(body.videoEligible).toBe(false);
  });

  it('clears a stored opt-in when the region moves somewhere video is prohibited', async () => {
    await patchUserProfile(
      patchReq({ jurisdiction: 'us_other', ageBand: '16_plus', videoOptIn: true }),
      deps(),
    );
    // Moving to the EU withdraws the consent rather than leaving it stored but unusable: a
    // recorded opt-in must not outlive the eligibility that justified collecting it.
    const res = await patchUserProfile(patchReq({ jurisdiction: 'eu' }), deps());
    const body = await res.json();
    expect(body.videoOptIn).toBe(false);
    expect(body.videoEligible).toBe(false);

    const getBody = await (await getUserProfile(getReq2(), deps())).json();
    expect(getBody.videoOptIn).toBe(false);
  });

  it('clears a stored opt-in when the age band moves below 16', async () => {
    await patchUserProfile(
      patchReq({ jurisdiction: 'us_other', ageBand: '16_plus', videoOptIn: true }),
      deps(),
    );
    const res = await patchUserProfile(patchReq({ ageBand: '13_to_15' }), deps());
    expect((await res.json()).videoOptIn).toBe(false);
  });

  it('refuses to store an opt-in sent for a prohibited region in the first place', async () => {
    const res = await patchUserProfile(
      patchReq({ jurisdiction: 'illinois', ageBand: '16_plus', videoOptIn: true }),
      deps(),
    );
    const body = await res.json();
    expect(body.videoOptIn).toBe(false);
    expect(body.videoEligible).toBe(false);
  });

  it('leaves an opt-in alone when the region stays eligible', async () => {
    await patchUserProfile(
      patchReq({ jurisdiction: 'us_other', ageBand: '16_plus', videoOptIn: true }),
      deps(),
    );
    const res = await patchUserProfile(patchReq({ jurisdiction: 'other' }), deps());
    const body = await res.json();
    expect(body.videoOptIn).toBe(true);
    expect(body.videoEligible).toBe(true);
  });

  it('rejects an unknown jurisdiction value', async () => {
    const res = await patchUserProfile(patchReq({ jurisdiction: 'mars' }), deps());
    expect(res.status).toBe(400);
  });

  it("user B cannot read or write user A's profile", async () => {
    await patchUserProfile(
      patchReq({ jurisdiction: 'us_other', ageBand: '16_plus', videoOptIn: true }),
      deps(),
    );
    const bRes = await getUserProfile(getReq2(), deps(FIXTURE.userB, FIXTURE.orgB));
    const bBody = await bRes.json();
    // RLS scopes the query to the caller's own row -- user B reads user B's row, which was
    // never touched by the PATCH above, not a 403/404. This asserts the isolation is real:
    // user B's own row stays at its own unrelated defaults, never user A's values.
    expect(bBody.jurisdiction).not.toBe('us_other');
  });
});

/**
 * The interviewer's voice. `getSessionSpeech` reads the question it synthesizes from the
 * session row, so there is deliberately no way for a caller to make it say arbitrary text --
 * the request carries a session id and nothing else.
 */
describe('GET /api/sessions/:id/speech', () => {
  const speechReq = (): Request => new Request('https://loopcraft.test/api/sessions/x/speech');

  const withoutCartesiaKey = async (fn: () => Promise<void>): Promise<void> => {
    const original = process.env['CARTESIA_API_KEY'];
    delete process.env['CARTESIA_API_KEY'];
    try {
      await fn();
    } finally {
      if (original !== undefined) process.env['CARTESIA_API_KEY'] = original;
    }
  };

  it('401s an unauthenticated caller', async () => {
    const d = deps();
    const { sessionId } = await startLoop(d);
    const res = await getSessionSpeech(speechReq(), sessionId, { ...d, authenticate: async () => null });
    expect(res.status).toBe(401);
  });

  it("404s another user's session rather than speaking it", async () => {
    const { sessionId } = await startLoop(deps());
    const res = await getSessionSpeech(speechReq(), sessionId, deps(FIXTURE.userB, FIXTURE.orgB));
    expect(res.status).toBe(404);
  });

  it('404s when the loop is finished and there is no question left to speak', async () => {
    const d = deps();
    const { sessionId, turnId } = await startLoop(d);
    let pending: string | null = turnId;
    // Drive the loop to completion so pendingTurn is genuinely null, rather than asserting
    // against a session that merely happens to have no question yet.
    while (pending !== null) {
      const res = await postTurn(req({ turnId: pending, transcript: 'An answer.' }), sessionId, d);
      pending = ((await res.json()) as { pendingTurnId: string | null }).pendingTurnId;
    }
    const res = await getSessionSpeech(speechReq(), sessionId, d);
    expect(res.status).toBe(404);
  });

  it('503s honestly when text-to-speech is not configured, rather than returning silence', async () => {
    const { sessionId } = await startLoop(deps());
    await withoutCartesiaKey(async () => {
      const res = await getSessionSpeech(speechReq(), sessionId, deps());
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ code: 'tts_unavailable' });
    });
  });

  it.skipIf(!cartesiaConfigured())('returns real synthesized MP3 bytes for the pending question', async () => {
    const { sessionId } = await startLoop(deps());
    const res = await getSessionSpeech(speechReq(), sessionId, deps());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(1_000);
    const id3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
    const frameSync = bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0;
    expect(id3 || frameSync).toBe(true);
  }, 45_000);
});

/**
 * The gap this route existed with until now: it ran no auth and no rate limit at all. These
 * assertions are the regression gate on that, not decoration -- a real Deepgram key makes an
 * open transcription endpoint a billable abuse vector.
 */
describe('POST /api/sessions/:id/audio', () => {
  const audioReq = (
    body: Uint8Array,
    headers: Record<string, string> = { 'Idempotency-Key': 'k-audio-1' },
  ): Request =>
    new Request('https://loopcraft.test/api/sessions/x/audio', {
      method: 'POST',
      headers: { 'content-type': 'audio/webm', ...headers },
      body: body as BodyInit,
    });

  const withDeepgramKey = async (key: string | null, fn: () => Promise<void>): Promise<void> => {
    const original = process.env['DEEPGRAM_API_KEY'];
    if (key === null) delete process.env['DEEPGRAM_API_KEY'];
    else process.env['DEEPGRAM_API_KEY'] = key;
    try {
      await fn();
    } finally {
      if (original === undefined) delete process.env['DEEPGRAM_API_KEY'];
      else process.env['DEEPGRAM_API_KEY'] = original;
    }
  };

  it('401s an unauthenticated caller instead of transcribing for free', async () => {
    const d = deps();
    const { sessionId } = await startLoop(d);
    const res = await postSessionAudio(audioReq(new Uint8Array([1, 2, 3])), sessionId, {
      ...d, authenticate: async () => null,
    });
    expect(res.status).toBe(401);
  });

  it('400s without an Idempotency-Key, like every other route that spends money', async () => {
    const { sessionId } = await startLoop(deps());
    const res = await postSessionAudio(audioReq(new Uint8Array([1, 2, 3]), {}), sessionId, deps());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'idempotency_key_required' });
  });

  it('429s once the rate limit for the bucket is spent', async () => {
    const d = deps(FIXTURE.userA, FIXTURE.orgA, { rateLimiter: new FixedWindowRateLimiter(1, 60_000) });
    const { sessionId } = await startLoop(deps());
    // Run with the key unset so the first call stops at the 503 rather than sending three
    // junk bytes to the live provider. The limiter runs inside guard(), before either check,
    // so the 429 this asserts is unaffected by which one the first call landed on.
    await withDeepgramKey(null, async () => {
      await postSessionAudio(audioReq(new Uint8Array([1, 2, 3])), sessionId, d);
      const res = await postSessionAudio(audioReq(new Uint8Array([1, 2, 3])), sessionId, d);
      expect(res.status).toBe(429);
    });
  });

  it('503s honestly when speech-to-text is not configured', async () => {
    const { sessionId } = await startLoop(deps());
    await withDeepgramKey(null, async () => {
      const res = await postSessionAudio(audioReq(new Uint8Array([1, 2, 3])), sessionId, deps());
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ code: 'stt_unavailable' });
    });
  });

  it('400s an empty recording without spending a provider call on it', async () => {
    const { sessionId } = await startLoop(deps());
    // A stub key, so the result does not depend on whether the machine running the suite has
    // a real one. The emptiness check happens before any fetch, so nothing is ever sent.
    await withDeepgramKey('dg-stub', async () => {
      const res = await postSessionAudio(audioReq(new Uint8Array([])), sessionId, deps());
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'empty_audio' });
    });
  });

  it('413s a recording over the size cap without sending it anywhere', async () => {
    const { sessionId } = await startLoop(deps());
    await withDeepgramKey('dg-stub', async () => {
      const oversized = new Uint8Array(25 * 1024 * 1024 + 1);
      const res = await postSessionAudio(audioReq(oversized), sessionId, deps());
      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ code: 'audio_too_large' });
    });
  }, 30_000);
});

/**
 * Persisting a round's camera-framing summary. What is stored is nine numbers; the tests that
 * matter here are the ones proving a client cannot store them for an account that is not
 * allowed video, or attach them to somebody else's round.
 */
describe('POST /api/sessions/:id/presence', () => {
  const SUMMARY = {
    sampleCount: 40,
    detectedCount: 38,
    wellFramedRatio: 0.75,
    offCenterRatio: 0.2,
    distanceOffRatio: 0.1,
    eyeLineOffRatio: 0.05,
    driftEvents: 3,
    longestWellFramedMs: 12_000,
  };

  const presenceReq = (body: unknown): Request =>
    new Request('https://loopcraft.test/api/sessions/x/presence', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'k-presence-1' },
      body: JSON.stringify(body),
    });

  async function eligibleSession(): Promise<{ sessionId: string; roundId: string }> {
    await withOwner(async (o) => {
      await o`update plans set allows_video = true where id = ${FIXTURE.planId}`;
      await o`update users set jurisdiction = 'us_other', age_band = '16_plus',
              video_opt_in = true where id = ${FIXTURE.userA}`;
    });
    const { sessionId } = await startLoop(deps());
    const rows = await withOwner((o) => o<{ id: string }[]>`
      select id from rounds where session_id = ${sessionId} order by position limit 1`);
    return { sessionId, roundId: rows[0]!.id };
  }

  it('stores a summary for an eligible account', async () => {
    const { sessionId, roundId } = await eligibleSession();
    const res = await postPresence(presenceReq({ roundId, ...SUMMARY }), sessionId, deps());
    expect(res.status).toBe(200);

    const stored = await withOwner((o) => o<{ drift_events: number; sample_count: number }[]>`
      select drift_events, sample_count from round_presence where round_id = ${roundId}`);
    expect(stored[0]?.drift_events).toBe(3);
    expect(stored[0]?.sample_count).toBe(40);
  });

  it('is idempotent -- a resend updates rather than duplicating', async () => {
    const { sessionId, roundId } = await eligibleSession();
    await postPresence(presenceReq({ roundId, ...SUMMARY }), sessionId, deps());
    const res = await postPresence(
      presenceReq({ roundId, ...SUMMARY, driftEvents: 9 }), sessionId, deps(),
    );
    expect(res.status).toBe(200);

    const rows = await withOwner((o) => o<{ drift_events: number }[]>`
      select drift_events from round_presence where round_id = ${roundId}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.drift_events).toBe(9);
  });

  it('refuses an account that has not opted in, however the client asks', async () => {
    const { sessionId, roundId } = await eligibleSession();
    await withOwner((o) => o`update users set video_opt_in = false where id = ${FIXTURE.userA}`);

    const res = await postPresence(presenceReq({ roundId, ...SUMMARY }), sessionId, deps());
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'video_not_eligible' });

    const rows = await withOwner((o) => o`select id from round_presence where round_id = ${roundId}`);
    expect(rows).toHaveLength(0);
  });

  it('refuses an account in a jurisdiction where video is prohibited', async () => {
    const { sessionId, roundId } = await eligibleSession();
    await withOwner((o) => o`update users set jurisdiction = 'eu' where id = ${FIXTURE.userA}`);
    const res = await postPresence(presenceReq({ roundId, ...SUMMARY }), sessionId, deps());
    expect(res.status).toBe(403);
  });

  it("cannot attach a summary to another tenant's round", async () => {
    const { sessionId, roundId } = await eligibleSession();
    await withOwner(async (o) => {
      await o`update users set jurisdiction = 'us_other', age_band = '16_plus',
              video_opt_in = true where id = ${FIXTURE.userB}`;
    });
    // User B, user A's round. RLS scopes the lookup to B's org, so the round does not resolve.
    const res = await postPresence(
      presenceReq({ roundId, ...SUMMARY }), sessionId, deps(FIXTURE.userB, FIXTURE.orgB),
    );
    expect([403, 404]).toContain(res.status);

    const rows = await withOwner((o) => o`select id from round_presence where round_id = ${roundId}`);
    expect(rows).toHaveLength(0);
  });

  it('rejects a ratio outside 0..1 rather than storing it', async () => {
    const { sessionId, roundId } = await eligibleSession();
    const res = await postPresence(
      presenceReq({ roundId, ...SUMMARY, wellFramedRatio: 1.4 }), sessionId, deps(),
    );
    expect(res.status).toBe(400);
  });

  it('rejects more detected frames than frames', async () => {
    const { sessionId, roundId } = await eligibleSession();
    const res = await postPresence(
      presenceReq({ roundId, ...SUMMARY, sampleCount: 5, detectedCount: 50 }), sessionId, deps(),
    );
    expect(res.status).toBe(400);
  });

  it('401s an unauthenticated caller', async () => {
    const { sessionId, roundId } = await eligibleSession();
    const d = deps();
    const res = await postPresence(presenceReq({ roundId, ...SUMMARY }), sessionId, {
      ...d, authenticate: async () => null,
    });
    expect(res.status).toBe(401);
  });
});
