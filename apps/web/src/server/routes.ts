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
  setRoundHintRung,
  submitAnswer,
  type HintRungName,
  type SessionState,
} from './session-engine.js';
import { rubricById } from '@loopcraft/core';
import { MAX_TURNS_PER_ROUND, decideNextInterviewerAction } from './interviewer.js';
import { selectQuestion, type ItemSource, type QuestionGenerator } from './question-generation.js';
import { gradeSession, loadDebrief } from './grading-service.js';
import type { GraderSampler } from '@loopcraft/scoring';
import type { LoopTemplate } from '@loopcraft/core';
import { videoEligible } from './video-eligibility.js';
import { videoOptInPermitted } from '../lib/video-opt-in.js';

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

export const patchUserProfileBody = z.object({
  displayName: z.string().min(1).max(200).optional(),
  jurisdiction: z.enum(['unknown', 'eu', 'illinois', 'us_other', 'other']).optional(),
  ageBand: z.enum(['unknown', 'under_13', '13_to_15', '16_plus']).optional(),
  videoOptIn: z.boolean().optional(),
});

export interface RouteDeps extends GuardPorts {
  readonly templates: { byId(id: string): LoopTemplate | undefined };
  readonly items: ItemSource;
  readonly generator: QuestionGenerator | null;
  readonly sql: Sql;
  readonly turnsPerRound: number;
  readonly costCeilingCents: number;
  readonly generationTimeoutMs: number;
  readonly graderSampler: GraderSampler | null;
  /**
   * When true, postTurn runs the real conversational interviewer (spec §2.2): after each
   * answer, a live model decides whether to clarify, hint, or accept before the round
   * advances. Defaults to false/undefined so every pre-existing test keeps its single-turn
   * behaviour without needing Ollama running; deps.ts sets this true for real product use.
   */
  readonly interviewerEnabled?: boolean;
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
  readonly videoEligible: boolean;
}

/**
 * `videoEligible` defaults to false (fail-closed, not "unknown until proven otherwise") for
 * every caller except `getSession`, which is the only one whose response the client actually
 * reads this field from -- `postSession`/`postTurn`'s callers never consume it client-side,
 * so threading the user row and entitlement through every `toView()` call site would add
 * real complexity for a field nothing reads there.
 */
export function toView(state: SessionState, videoEligible = false): SessionView {
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
    videoEligible,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export interface UserProfileView {
  readonly displayName: string | null;
  readonly jurisdiction: string;
  readonly ageBand: string;
  readonly videoOptIn: boolean;
  readonly videoEligible: boolean;
}

interface UserRow {
  readonly display_name: string | null;
  readonly jurisdiction: string;
  readonly age_band: string;
  readonly video_opt_in: boolean;
}

function toProfileView(row: UserRow, planAllowsVideo: boolean): UserProfileView {
  return {
    displayName: row.display_name,
    jurisdiction: row.jurisdiction,
    ageBand: row.age_band,
    videoOptIn: row.video_opt_in,
    videoEligible: videoEligible({
      jurisdiction: row.jurisdiction,
      ageBand: row.age_band,
      videoOptIn: row.video_opt_in,
      planAllowsVideo,
    }),
  };
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
    const { user, entitlement } = await guard(request, deps, {
      schema: z.object({}),
      mutating: false,
      rateLimitBucket: 'sessions.read',
    });
    const view = await asUser(deps.sql, user.userId, async (tx) => {
      const state = await loadSession(tx, sessionId);
      const rows = await tx<UserRow[]>`
        select display_name, jurisdiction, age_band, video_opt_in
        from users where id = ${user.userId}`;
      const row = rows[0];
      const eligible = row === undefined
        ? false
        : videoEligible({
            jurisdiction: row.jurisdiction,
            ageBand: row.age_band,
            videoOptIn: row.video_opt_in,
            planAllowsVideo: entitlement.plan.allowsVideo,
          });
      return toView(state, eligible);
    });
    return json(200, view);
  } catch (error) {
    const { status, body } = toErrorResponse(error, errorId);
    return json(status, body);
  }
}

/** GET /api/users/me — the authenticated user's own profile, with computed video eligibility. */
export async function getUserProfile(request: Request, deps: RouteDeps): Promise<Response> {
  const errorId = randomUUID();
  try {
    const { user, entitlement } = await guard(request, deps, {
      schema: z.object({}),
      mutating: false,
      rateLimitBucket: 'users.read',
    });
    const row = await asUser(deps.sql, user.userId, async (tx) => {
      const rows = await tx<UserRow[]>`
        select display_name, jurisdiction, age_band, video_opt_in
        from users where id = ${user.userId}`;
      return rows[0];
    });
    if (row === undefined) {
      return json(404, { error: 'User not found.', code: 'not_found', errorId });
    }
    return json(200, toProfileView(row, entitlement.plan.allowsVideo));
  } catch (error) {
    const { status, body } = toErrorResponse(error, errorId);
    return json(status, body);
  }
}

/** PATCH /api/users/me — partial update; the response is always the post-update state. */
export async function patchUserProfile(request: Request, deps: RouteDeps): Promise<Response> {
  const errorId = randomUUID();
  try {
    const { user, entitlement, body } = await guard(request, deps, {
      schema: patchUserProfileBody,
      mutating: true,
      rateLimitBucket: 'users.update',
    });
    const row = await asUser(deps.sql, user.userId, async (tx) => {
      const rows = await tx<UserRow[]>`
        update users set
          display_name = coalesce(${body.displayName ?? null}, display_name),
          jurisdiction = coalesce(${body.jurisdiction ?? null}, jurisdiction),
          age_band = coalesce(${body.ageBand ?? null}, age_band),
          video_opt_in = coalesce(${body.videoOptIn ?? null}, video_opt_in)
        where id = ${user.userId}
        returning display_name, jurisdiction, age_band, video_opt_in`;
      const updated = rows[0];
      if (updated === undefined) return undefined;
      // A recorded opt-in must not outlive the eligibility that justified collecting it. If
      // this update leaves the user in a region or age band where video is prohibited, the
      // consent is withdrawn here rather than left stored-but-unusable -- otherwise moving
      // to the EU and back would silently re-enable a camera the user never re-consented to.
      // The rule is applied in TypeScript, not duplicated in SQL, so there stays one
      // definition of it (lib/video-opt-in.ts).
      if (!updated.video_opt_in || videoOptInPermitted({
        jurisdiction: updated.jurisdiction,
        ageBand: updated.age_band,
      })) {
        return updated;
      }
      const cleared = await tx<UserRow[]>`
        update users set video_opt_in = false where id = ${user.userId}
        returning display_name, jurisdiction, age_band, video_opt_in`;
      return cleared[0];
    });
    if (row === undefined) {
      return json(404, { error: 'User not found.', code: 'not_found', errorId });
    }
    return json(200, toProfileView(row, entitlement.plan.allowsVideo));
  } catch (error) {
    const { status, body } = toErrorResponse(error, errorId);
    return json(status, body);
  }
}

/**
 * POST /api/sessions/:id/debrief — grades any ungraded completed rounds, then assembles the
 * packet from stored rows. Grading is idempotent, so a retry does not re-spend provider
 * budget or produce a second, different grade for the same round.
 */
export async function postDebrief(
  request: Request,
  sessionId: string,
  deps: RouteDeps,
): Promise<Response> {
  const errorId = randomUUID();
  try {
    const { user } = await guard(request, deps, {
      schema: z.object({}),
      mutating: true,
      rateLimitBucket: 'debrief.create',
    });
    if (deps.graderSampler === null) {
      return json(503, { error: 'Grading is not configured.', code: 'grader_unavailable', errorId });
    }
    const sampler = deps.graderSampler;
    const packet = await asUser(deps.sql, user.userId, async (tx) => {
      await gradeSession(tx, sessionId, sampler);
      return loadDebrief(tx, sessionId);
    });
    return json(200, packet);
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
      const before = await loadSession(tx, sessionId);
      const roundBefore = before.currentRound;

      // The real back-and-forth (spec §2.2). A live interviewer decides, from the answer just
      // submitted plus every prior answer in this round, whether to advance the round or keep
      // probing -- computed as a variable turnsPerRound for THIS call, so submitAnswer's
      // existing count-based advance logic is reused rather than duplicated.
      let effectiveTurnsPerRound = deps.turnsPerRound;
      let followUp: { message: string; hintRung: HintRungName | null } | null = null;

      if (deps.interviewerEnabled === true && roundBefore !== null) {
        const rubric = rubricById(roundBefore.rubricId);
        if (rubric !== undefined) {
          const priorAnswers = before.turns
            .filter((t) => t.roundId === roundBefore.id && t.answeredAt !== null)
            .sort((a, b) => a.position - b.position)
            .map((t) => t.transcript ?? '');
          const decision = await decideNextInterviewerAction(rubric, {
            question: before.pendingTurn?.question ?? '',
            priorAnswers: [...priorAnswers, body.transcript],
            currentHintRung: roundBefore.currentHintRung,
            turnsSoFar: priorAnswers.length + 1,
            maxTurns: MAX_TURNS_PER_ROUND,
          });
          if (decision.action === 'accept') {
            effectiveTurnsPerRound = priorAnswers.length + 1;
          } else {
            effectiveTurnsPerRound = priorAnswers.length + 2;
            followUp = { message: decision.message, hintRung: decision.hintRung };
          }
        }
      }

      const advanced = await submitAnswer(
        tx,
        sessionId,
        body.turnId,
        body.transcript,
        effectiveTurnsPerRound,
      );

      if (followUp !== null && roundBefore !== null && advanced.currentRound?.id === roundBefore.id) {
        if (followUp.hintRung !== null) await setRoundHintRung(tx, roundBefore.id, followUp.hintRung);
        return toView(await recordQuestion(tx, sessionId, followUp.message, null));
      }

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
