import { afterAll, describe, expect, it } from 'vitest';
import { FIXTURE, appClient, asUser } from '@loopcraft/db';
import type { RoundSpec } from '@loopcraft/core';
import {
  SessionCompletedError,
  SessionNotFoundError,
  createSession,
  loadSession,
  recordQuestion,
  submitAnswer,
} from '../src/server/session-engine.js';

/**
 * Acceptance criterion 1: "A user completes a multi-round loop, closes the tab mid-round,
 * reopens, and resumes at the same turn with all prior state intact."
 *
 * These run against real Postgres through the RLS-scoped loopcraft_app role. The resume
 * tests deliberately close the client and open a brand new one, which is the closest
 * in-process analogue of a browser refresh hitting a different server process: nothing
 * in module memory can carry state across.
 */

const ROUNDS: readonly RoundSpec[] = [
  { position: 1, roundType: 'warmup', persona: 'Recruiter screen', rubricId: FIXTURE.rubricId, minutes: 5 },
  { position: 2, roundType: 'domain', persona: 'Staff ML systems engineer', rubricId: FIXTURE.rubricId, minutes: 45 },
  { position: 3, roundType: 'behavioral', persona: 'Engineering manager', rubricId: FIXTURE.rubricId, minutes: 30 },
];

const sql = appClient();
afterAll(async () => {
  await sql.end({ timeout: 5 });
});

async function newSession(userId = FIXTURE.userA, orgId = FIXTURE.orgA): Promise<string> {
  return asUser(sql, userId, async (tx) => {
    const state = await createSession(tx, {
      orgId,
      userId,
      loopTemplateId: FIXTURE.templateId,
      trackId: FIXTURE.trackId,
      levelBand: 'L5',
      rounds: ROUNDS,
      costCeilingCents: 400,
    });
    return state.session.id;
  });
}

describe('session creation', () => {
  it('materialises every round of the template up front', async () => {
    const id = await newSession();
    const state = await asUser(sql, FIXTURE.userA, (tx) => loadSession(tx, id));
    expect(state.rounds.map((r) => r.roundType)).toEqual(['warmup', 'domain', 'behavioral']);
    expect(state.rounds.every((r) => r.status === 'pending')).toBe(true);
    expect(state.session.currentRoundPosition).toBe(1);
    expect(state.session.status).toBe('in_progress');
  });

  it('propagates track and level onto the persisted record (acceptance criterion 3)', async () => {
    const id = await newSession();
    const state = await asUser(sql, FIXTURE.userA, (tx) => loadSession(tx, id));
    expect(state.session.trackId).toBe(FIXTURE.trackId);
    expect(state.session.levelBand).toBe('L5');
  });

  it('refuses a template with no rounds rather than creating an empty loop', async () => {
    await expect(
      asUser(sql, FIXTURE.userA, (tx) =>
        createSession(tx, {
          orgId: FIXTURE.orgA, userId: FIXTURE.userA, loopTemplateId: FIXTURE.templateId,
          trackId: FIXTURE.trackId, levelBand: 'L5', rounds: [], costCeilingCents: 0,
        }),
      ),
    ).rejects.toThrow(RangeError);
  });
});

describe('question issuance is idempotent', () => {
  it('does not create a second question when called twice', async () => {
    const id = await newSession();
    await asUser(sql, FIXTURE.userA, (tx) => recordQuestion(tx, id, 'Walk me through your background.', null));
    const state = await asUser(sql, FIXTURE.userA, (tx) =>
      recordQuestion(tx, id, 'A COMPLETELY DIFFERENT QUESTION', null));
    expect(state.turns).toHaveLength(1);
    expect(state.pendingTurn?.question).toBe('Walk me through your background.');
  });

  it('marks the round in progress and stamps started_at once', async () => {
    const id = await newSession();
    await asUser(sql, FIXTURE.userA, (tx) => recordQuestion(tx, id, 'Q1', null));
    const state = await asUser(sql, FIXTURE.userA, (tx) => loadSession(tx, id));
    expect(state.currentRound?.status).toBe('in_progress');
  });
});

describe('resuming after a refresh (acceptance criterion 1)', () => {
  it('reconstructs identical state from a brand new connection mid-round', async () => {
    const id = await newSession();
    await asUser(sql, FIXTURE.userA, async (tx) => {
      await recordQuestion(tx, id, 'Warmup question.', null);
    });
    const before = await asUser(sql, FIXTURE.userA, (tx) => loadSession(tx, id));

    // Simulate the tab closing: discard every connection and open a new client.
    const fresh = appClient();
    try {
      const after = await asUser(fresh, FIXTURE.userA, (tx) => loadSession(tx, id));
      expect(after).toEqual(before);
      expect(after.pendingTurn?.question).toBe('Warmup question.');
      expect(after.session.currentRoundPosition).toBe(1);
    } finally {
      await fresh.end({ timeout: 5 });
    }
  });

  it('resumes at the same turn after answering part of the loop', async () => {
    const id = await newSession();
    await asUser(sql, FIXTURE.userA, async (tx) => {
      const q = await recordQuestion(tx, id, 'Round 1 question.', null);
      await submitAnswer(tx, id, q.pendingTurn!.id, 'My background is in distributed training.', 1);
      await recordQuestion(tx, id, 'Round 2 question.', null);
    });

    const fresh = appClient();
    try {
      const state = await asUser(fresh, FIXTURE.userA, (tx) => loadSession(tx, id));
      expect(state.session.currentRoundPosition).toBe(2);
      expect(state.currentRound?.roundType).toBe('domain');
      expect(state.pendingTurn?.question).toBe('Round 2 question.');
      expect(state.answeredTurnCount).toBe(1);
      // The prior answer's transcript survived intact.
      expect(state.turns[0]?.transcript).toBe('My background is in distributed training.');
      expect(state.rounds[0]?.status).toBe('completed');
    } finally {
      await fresh.end({ timeout: 5 });
    }
  });
});

describe('advancing through a full loop', () => {
  it('completes the session after the final round is answered', async () => {
    const id = await newSession();
    for (let round = 1; round <= ROUNDS.length; round += 1) {
      await asUser(sql, FIXTURE.userA, async (tx) => {
        const q = await recordQuestion(tx, id, `Question for round ${round}.`, null);
        await submitAnswer(tx, id, q.pendingTurn!.id, `Answer for round ${round}.`, 1);
      });
    }
    const state = await asUser(sql, FIXTURE.userA, (tx) => loadSession(tx, id));
    expect(state.session.status).toBe('completed');
    expect(state.rounds.every((r) => r.status === 'completed')).toBe(true);
    expect(state.answeredTurnCount).toBe(3);
    expect(state.pendingTurn).toBeNull();
  });

  it('keeps a multi-turn round open until its turn budget is spent', async () => {
    const id = await newSession();
    await asUser(sql, FIXTURE.userA, async (tx) => {
      const a = await recordQuestion(tx, id, 'Turn one.', null);
      const afterFirst = await submitAnswer(tx, id, a.pendingTurn!.id, 'Answer one.', 2);
      expect(afterFirst.session.currentRoundPosition).toBe(1);
      expect(afterFirst.rounds[0]?.status).toBe('in_progress');

      const b = await recordQuestion(tx, id, 'Turn two.', null);
      const afterSecond = await submitAnswer(tx, id, b.pendingTurn!.id, 'Answer two.', 2);
      expect(afterSecond.session.currentRoundPosition).toBe(2);
    });
  });

  it('refuses further questions once the loop is complete', async () => {
    const id = await newSession();
    for (let round = 1; round <= ROUNDS.length; round += 1) {
      await asUser(sql, FIXTURE.userA, async (tx) => {
        const q = await recordQuestion(tx, id, `Q${round}`, null);
        await submitAnswer(tx, id, q.pendingTurn!.id, `A${round}`, 1);
      });
    }
    await expect(
      asUser(sql, FIXTURE.userA, (tx) => recordQuestion(tx, id, 'One more?', null)),
    ).rejects.toThrow(SessionCompletedError);
  });

  it('rejects an answer aimed at a turn that is not the pending one', async () => {
    const id = await newSession();
    await asUser(sql, FIXTURE.userA, (tx) => recordQuestion(tx, id, 'Q', null));
    await expect(
      asUser(sql, FIXTURE.userA, (tx) =>
        submitAnswer(tx, id, '00000000-0000-4000-8000-00000000dead', 'sneaky', 1)),
    ).rejects.toThrow(SessionNotFoundError);
  });

  it('rejects a turns-per-round budget below one', async () => {
    const id = await newSession();
    const q = await asUser(sql, FIXTURE.userA, (tx) => recordQuestion(tx, id, 'Q', null));
    await expect(
      asUser(sql, FIXTURE.userA, (tx) => submitAnswer(tx, id, q.pendingTurn!.id, 'A', 0)),
    ).rejects.toThrow(RangeError);
  });
});

describe('sessions are invisible across tenants', () => {
  it("user B cannot load user A's session, and gets the same error as for a missing one", async () => {
    const id = await newSession();
    await expect(asUser(sql, FIXTURE.userB, (tx) => loadSession(tx, id))).rejects.toThrow(
      SessionNotFoundError,
    );
    await expect(
      asUser(sql, FIXTURE.userB, (tx) => loadSession(tx, '00000000-0000-4000-8000-00000000beef')),
    ).rejects.toThrow(SessionNotFoundError);
  });

  it("user B cannot answer a turn in user A's session", async () => {
    const id = await newSession();
    const q = await asUser(sql, FIXTURE.userA, (tx) => recordQuestion(tx, id, 'Q', null));
    await expect(
      asUser(sql, FIXTURE.userB, (tx) => submitAnswer(tx, id, q.pendingTurn!.id, 'stolen', 1)),
    ).rejects.toThrow(SessionNotFoundError);
  });
});
