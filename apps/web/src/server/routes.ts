import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { LEVEL_BANDS } from '@loopcraft/core';
import { asUser } from '@loopcraft/db';
import type { Sql } from '@loopcraft/db';
import { guard, toErrorResponse, type GuardPorts } from './guards.js';
import { assertFeature, assertSessionQuota } from './entitlements.js';
import {
  createSession,
  loadSession,
  recordQuestion,
  submitAnswer,
  type SessionState,
} from './session-engine.js';
import { selectQuestion, type ItemSource, type QuestionGenerator } from './question-generation.js';
import type { LoopTemplate } from '@loopcraft/core';

/**
 * Route handlers, kept out of the App Router files so they are testable without a running
 * Next server. Each one runs the spec §3.3 chain through `guard` before touching state.
 */

export const createSessionBody = z.object({
  loopTemplateId: z.string().min(1),
  levelBand: z.enum(LEVEL_BANDS),
});

export const submitTurnBody = z.object({
  turnId: z.string().uuid(),
  transcript: z.string().min(1).max(50_000),
});

export interface RouteDeps extends GuardPorts {
  readonly templates: { byId(id: string): LoopTemplate | undefined };
  readonly items: ItemSource;
  readonly generator: QuestionGenerator | null;
  readonly sql: Sql;
  readonly turnsPerRound: number;
  readonly costCeilingCents: number;
  readonly generationTimeoutMs: number;
}

/** The client-facing projection of a session. Storage keys and item ids never cross it. */
export interface SessionView {
  readonly sessionId: string;
  readonly status: SessionState['session']['status'];
  readonly trackId: string;
  readonly levelBand: string;
  readonly roundCount: number;
  readonly currentRoundPosition: number;
  readonly currentRoundType: string | null;
  readonly persona: string | null;
  readonly question: string | null;
  readonly pendingTurnId: string | null;
  readonly answeredTurnCount: number;
}

export function toView(state: SessionState): SessionView {
  return {
    sessionId: state.session.id,
    status: state.session.status,
    trackId: state.session.trackId,
    levelBand: state.session.levelBand,
    roundCount: state.rounds.length,
    currentRoundPosition: state.session.currentRoundPosition,
    currentRoundType: state.currentRound?.roundType ?? null,
    persona: state.currentRound?.persona ?? null,
    question: state.pendingTurn?.question ?? null,
    pendingTurnId: state.pendingTurn?.id ?? null,
    answeredTurnCount: state.answeredTurnCount,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** POST /api/sessions — creates a loop and issues its first question. */
export async function postSession(request: Request, deps: RouteDeps): Promise<Response> {
  const errorId = randomUUID();
  try {
    const { user, entitlement, body } = await guard(request, deps, {
      schema: createSessionBody,
      mutating: true,
      rateLimitBucket: 'sessions.create',
    });
    assertFeature(entitlement, 'loop_simulation');
    assertSessionQuota(entitlement);

    const template = deps.templates.byId(body.loopTemplateId);
    if (template === undefined) {
      return json(404, { error: 'Unknown loop template.', code: 'not_found', errorId });
    }

    const view = await asUser(deps.sql, user.userId, async (tx) => {
      const state = await createSession(tx, {
        orgId: user.orgId,
        userId: user.userId,
        loopTemplateId: template.id,
        trackId: template.trackId,
        levelBand: body.levelBand,
        rounds: template.rounds,
        costCeilingCents: deps.costCeilingCents,
      });
      const round = state.currentRound;
      if (round === null) return toView(state);
      const selected = await selectQuestion(
        {
          trackId: template.trackId,
          roundType: round.roundType,
          levelBand: body.levelBand,
          excludeItemIds: [],
        },
        deps.generator,
        deps.items,
        { timeoutMs: deps.generationTimeoutMs, rubricId: round.rubricId },
      );
      const withQuestion = await recordQuestion(
        tx,
        state.session.id,
        selected.question,
        selected.itemId,
      );
      await tx`
        insert into usage_ledger (org_id, user_id, meter, quantity, session_id)
        values (${user.orgId}, ${user.userId}, 'session', 1, ${state.session.id})`;
      return toView(withQuestion);
    });
    return json(201, view);
  } catch (error) {
    const { status, body } = toErrorResponse(error, errorId);
    return json(status, body);
  }
}

/** GET /api/sessions/:id — the resume endpoint. Reads state from Postgres, nothing cached. */
export async function getSession(
  request: Request,
  sessionId: string,
  deps: RouteDeps,
): Promise<Response> {
  const errorId = randomUUID();
  try {
    const { user } = await guard(request, deps, {
      schema: z.object({}),
      mutating: false,
      rateLimitBucket: 'sessions.read',
    });
    const view = await asUser(deps.sql, user.userId, async (tx) =>
      toView(await loadSession(tx, sessionId)));
    return json(200, view);
  } catch (error) {
    const { status, body } = toErrorResponse(error, errorId);
    return json(status, body);
  }
}

/** POST /api/sessions/:id/turns — records an answer and issues the next question. */
export async function postTurn(
  request: Request,
  sessionId: string,
  deps: RouteDeps,
): Promise<Response> {
  const errorId = randomUUID();
  try {
    const { user, body } = await guard(request, deps, {
      schema: submitTurnBody,
      mutating: true,
      rateLimitBucket: 'turns.create',
    });

    const view = await asUser(deps.sql, user.userId, async (tx) => {
      const advanced = await submitAnswer(
        tx,
        sessionId,
        body.turnId,
        body.transcript,
        deps.turnsPerRound,
      );
      const round = advanced.currentRound;
      if (advanced.session.status !== 'in_progress' || round === null) return toView(advanced);

      const template = deps.templates.byId(advanced.session.loopTemplateId);
      const selected = await selectQuestion(
        {
          trackId: advanced.session.trackId,
          roundType: round.roundType,
          levelBand: advanced.session.levelBand,
          excludeItemIds: advanced.turns
            .map((t) => t.itemId)
            .filter((id): id is string => id !== null),
        },
        deps.generator,
        deps.items,
        {
          timeoutMs: deps.generationTimeoutMs,
          rubricId: template?.rounds.find((r) => r.position === round.position)?.rubricId
            ?? round.rubricId,
        },
      );
      return toView(await recordQuestion(tx, sessionId, selected.question, selected.itemId));
    });
    return json(200, view);
  } catch (error) {
    const { status, body } = toErrorResponse(error, errorId);
    return json(status, body);
  }
}
