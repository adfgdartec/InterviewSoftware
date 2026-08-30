import type { TransactionSql } from 'postgres';
import type { LevelBand, RoundSpec, RoundType } from '@loopcraft/core';

/**
 * Durable loop engine. Spec §3.2: "Session state lives in Postgres, not React state.
 * Refresh resumes exactly." Every function here takes a transaction already bound to the
 * acting user, so RLS scopes the reads and writes; nothing is cached in module state, and
 * `loadSession` reconstructs the entire renderable state from rows alone.
 *
 * The audited prototype kept live interview state in React memory while telling the user it
 * was saved, and kept backend session data in bare Python dicts. Neither survives a refresh
 * or a second process. This module exists so there is nowhere for such state to hide.
 */

export interface SessionRow {
  readonly id: string;
  readonly orgId: string;
  readonly userId: string;
  readonly loopTemplateId: string;
  readonly trackId: string;
  readonly levelBand: LevelBand;
  readonly status: 'in_progress' | 'completed' | 'abandoned' | 'expired';
  readonly currentRoundPosition: number;
}

export type HintRungName = 'nudge' | 'constraint' | 'structure' | 'partial_solution';

export interface RoundRow {
  readonly id: string;
  readonly position: number;
  readonly roundType: RoundType;
  readonly rubricId: string;
  readonly persona: string;
  readonly minutes: number;
  readonly status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  readonly currentHintRung: HintRungName | null;
}

export interface TurnRow {
  readonly id: string;
  readonly roundId: string;
  readonly itemId: string | null;
  readonly position: number;
  readonly question: string;
  readonly transcript: string | null;
  readonly answeredAt: Date | null;
}

/** Everything the UI needs to render, derived only from persisted rows. */
export interface SessionState {
  readonly session: SessionRow;
  readonly rounds: readonly RoundRow[];
  readonly turns: readonly TurnRow[];
  readonly currentRound: RoundRow | null;
  /** The turn awaiting an answer, or null when the round needs its next question. */
  readonly pendingTurn: TurnRow | null;
  readonly answeredTurnCount: number;
}

export class SessionNotFoundError extends Error {
  readonly httpStatus = 404;
  constructor(sessionId: string) {
    // Deliberately identical whether the session is absent or belongs to another org: a
    // distinguishable message is an enumeration oracle.
    super(`Session ${sessionId} was not found.`);
    this.name = 'SessionNotFoundError';
  }
}

export class SessionCompletedError extends Error {
  readonly httpStatus = 409;
  constructor() {
    super('This loop is already complete.');
    this.name = 'SessionCompletedError';
  }
}

export interface CreateSessionInput {
  readonly orgId: string;
  readonly userId: string;
  readonly loopTemplateId: string;
  readonly trackId: string;
  readonly levelBand: LevelBand;
  readonly rounds: readonly RoundSpec[];
  readonly costCeilingCents: number;
}

/**
 * Creates the session and materialises every round up front, so the loop's shape is a
 * persisted fact rather than something recomputed from the template on each request. A
 * template edited later cannot retroactively change a loop already in progress.
 */
export async function createSession(
  tx: TransactionSql,
  input: CreateSessionInput,
): Promise<SessionState> {
  if (input.rounds.length === 0) {
    throw new RangeError(`Loop template ${input.loopTemplateId} declares no rounds.`);
  }
  const [created] = await tx<{ id: string }[]>`
    insert into sessions (org_id, user_id, loop_template_id, track_id, level_band,
                          cost_ceiling_cents, current_round_position)
    values (${input.orgId}, ${input.userId}, ${input.loopTemplateId}, ${input.trackId},
            ${input.levelBand}, ${input.costCeilingCents}, 1)
    returning id`;
  const sessionId = created?.id;
  if (sessionId === undefined) throw new Error('Session insert returned no id.');

  for (const round of input.rounds) {
    await tx`
      insert into rounds (org_id, session_id, position, round_type, rubric_id, persona, minutes)
      values (${input.orgId}, ${sessionId}, ${round.position}, ${round.roundType},
              ${round.rubricId}, ${round.persona}, ${round.minutes})`;
  }
  return loadSession(tx, sessionId);
}

/** Rebuilds the whole session from Postgres. This is the resume path (acceptance criterion 1). */
export async function loadSession(tx: TransactionSql, sessionId: string): Promise<SessionState> {
  const sessions = await tx<Record<string, unknown>[]>`
    select id, org_id, user_id, loop_template_id, track_id, level_band, status,
           current_round_position
    from sessions where id = ${sessionId}`;
  const raw = sessions[0];
  if (raw === undefined) throw new SessionNotFoundError(sessionId);

  const session: SessionRow = {
    id: String(raw['id']),
    orgId: String(raw['org_id']),
    userId: String(raw['user_id']),
    loopTemplateId: String(raw['loop_template_id']),
    trackId: String(raw['track_id']),
    levelBand: String(raw['level_band']) as LevelBand,
    status: String(raw['status']) as SessionRow['status'],
    currentRoundPosition: Number(raw['current_round_position']),
  };

  const roundRows = await tx<Record<string, unknown>[]>`
    select id, position, round_type, rubric_id, persona, minutes, status, current_hint_rung
    from rounds where session_id = ${sessionId} order by position asc`;
  const rounds: RoundRow[] = roundRows.map((r) => ({
    id: String(r['id']),
    position: Number(r['position']),
    roundType: String(r['round_type']) as RoundType,
    rubricId: String(r['rubric_id']),
    persona: String(r['persona']),
    minutes: Number(r['minutes']),
    status: String(r['status']) as RoundRow['status'],
    currentHintRung: r['current_hint_rung'] === null ? null : (r['current_hint_rung'] as HintRungName),
  }));

  const turnRows = await tx<Record<string, unknown>[]>`
    select t.id, t.round_id, t.item_id, t.position, t.question, t.transcript, t.answered_at
    from turns t join rounds r on r.id = t.round_id
    where r.session_id = ${sessionId}
    order by r.position asc, t.position asc`;
  const turns: TurnRow[] = turnRows.map((t) => ({
    id: String(t['id']),
    roundId: String(t['round_id']),
    itemId: t['item_id'] === null ? null : String(t['item_id']),
    position: Number(t['position']),
    question: String(t['question']),
    transcript: t['transcript'] === null ? null : String(t['transcript']),
    answeredAt: t['answered_at'] === null ? null : new Date(String(t['answered_at'])),
  }));

  const currentRound = rounds.find((r) => r.position === session.currentRoundPosition) ?? null;
  const pendingTurn =
    currentRound === null
      ? null
      : (turns.find((t) => t.roundId === currentRound.id && t.answeredAt === null) ?? null);

  return {
    session,
    rounds,
    turns,
    currentRound,
    pendingTurn,
    answeredTurnCount: turns.filter((t) => t.answeredAt !== null).length,
  };
}

/**
 * Records the question the server chose for the current round. Returns the existing pending
 * turn unchanged when one is already open, so a duplicate request -- a double-click, a
 * retried fetch, a refresh -- never produces a second question.
 */
export async function recordQuestion(
  tx: TransactionSql,
  sessionId: string,
  question: string,
  itemId: string | null,
): Promise<SessionState> {
  const state = await loadSession(tx, sessionId);
  if (state.session.status !== 'in_progress') throw new SessionCompletedError();
  if (state.currentRound === null) throw new SessionCompletedError();
  if (state.pendingTurn !== null) return state;

  const roundId = state.currentRound.id;
  const nextPosition =
    state.turns.filter((t) => t.roundId === roundId).length + 1;

  await tx`
    update rounds set status = 'in_progress',
                      started_at = coalesce(started_at, now())
    where id = ${roundId} and status = 'pending'`;
  await tx`
    insert into turns (org_id, round_id, item_id, position, question)
    values (${state.session.orgId}, ${roundId}, ${itemId}, ${nextPosition}, ${question})`;

  return loadSession(tx, sessionId);
}

/** Records the interviewer's hint-ladder progress for a round. Never called with a client value. */
export async function setRoundHintRung(
  tx: TransactionSql,
  roundId: string,
  rung: HintRungName,
): Promise<void> {
  await tx`update rounds set current_hint_rung = ${rung} where id = ${roundId}`;
}

/**
 * Stores an answer and advances. Round advance is decided from persisted turn counts, never
 * from a client-supplied position (guardrail 5).
 */
export async function submitAnswer(
  tx: TransactionSql,
  sessionId: string,
  turnId: string,
  transcript: string,
  turnsPerRound: number,
): Promise<SessionState> {
  if (turnsPerRound < 1) throw new RangeError('turnsPerRound must be >= 1');
  const before = await loadSession(tx, sessionId);
  if (before.session.status !== 'in_progress') throw new SessionCompletedError();
  if (before.pendingTurn === null || before.pendingTurn.id !== turnId) {
    throw new SessionNotFoundError(turnId);
  }

  await tx`
    update turns set transcript = ${transcript}, answered_at = now()
    where id = ${turnId} and answered_at is null`;

  const round = before.currentRound;
  if (round === null) throw new SessionCompletedError();

  const answeredInRound =
    before.turns.filter((t) => t.roundId === round.id && t.answeredAt !== null).length + 1;

  if (answeredInRound >= turnsPerRound) {
    await tx`
      update rounds set status = 'completed', completed_at = now() where id = ${round.id}`;
    const isLast = round.position >= before.rounds.length;
    if (isLast) {
      await tx`
        update sessions set status = 'completed', completed_at = now() where id = ${sessionId}`;
    } else {
      await tx`
        update sessions set current_round_position = ${round.position + 1}
        where id = ${sessionId}`;
    }
  }
  return loadSession(tx, sessionId);
}
