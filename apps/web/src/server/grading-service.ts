import type { TransactionSql } from 'postgres';
import { rubricById, type Rubric } from '@loopcraft/core';
import {
  assembleDebrief,
  gradeRound,
  type DebriefPacket,
  type GraderSampler,
  type RoundGrade,
  type RoundInput,
} from '@loopcraft/scoring';
import { loadSession, type SessionState } from './session-engine.js';

/**
 * Persists grading and assembles the debrief. Spec §3.3: the grader runs after the loop and
 * the packet is assembled from stored rows, so a debrief can be re-read later without
 * re-grading and without trusting anything the client holds.
 */

export class NotGradableError extends Error {
  readonly httpStatus = 409;
  constructor(message: string) {
    super(message);
    this.name = 'NotGradableError';
  }
}

export class MissingRubricError extends Error {
  readonly httpStatus = 500;
  constructor(rubricId: string) {
    super(`Rubric ${rubricId} is not in the catalog.`);
    this.name = 'MissingRubricError';
  }
}

/** Concatenates a round's answered turns into the transcript the grader sees. */
export function transcriptForRound(state: SessionState, roundId: string): string {
  return state.turns
    .filter((t) => t.roundId === roundId && t.transcript !== null)
    .sort((a, b) => a.position - b.position)
    .map((t) => `Q: ${t.question}\nA: ${t.transcript ?? ''}`)
    .join('\n\n');
}

/**
 * Grades every completed round of a session and writes grader_runs, scores and
 * score_dimensions. Idempotent: a round that already has a score row is skipped, so a
 * retried request does not re-spend provider budget or produce a second, different grade.
 */
export async function gradeSession(
  tx: TransactionSql,
  sessionId: string,
  sampler: GraderSampler,
): Promise<{ graded: number; skipped: number }> {
  const state = await loadSession(tx, sessionId);
  if (state.session.status !== 'completed') {
    throw new NotGradableError('A loop is graded once it is complete.');
  }

  let graded = 0;
  let skipped = 0;
  for (const round of state.rounds) {
    if (round.status !== 'completed') continue;

    const existing = await tx<{ id: string }[]>`
      select id from scores where round_id = ${round.id} limit 1`;
    if (existing.length > 0) {
      skipped += 1;
      continue;
    }

    const rubric = rubricById(round.rubricId);
    if (rubric === undefined) throw new MissingRubricError(round.rubricId);

    const transcript = transcriptForRound(state, round.id);
    if (transcript.trim().length === 0) {
      skipped += 1;
      continue;
    }

    const grade = await gradeRound(rubric, transcript, sampler);
    await persistGrade(tx, state.session.orgId, round.id, rubric, grade);
    graded += 1;
  }
  return { graded, skipped };
}

async function persistGrade(
  tx: TransactionSql,
  orgId: string,
  roundId: string,
  rubric: Rubric,
  grade: RoundGrade,
): Promise<void> {
  for (let sample = 1; sample <= grade.samplesCollected; sample += 1) {
    await tx`
      insert into grader_runs (org_id, round_id, rubric_id, grader_model, grader_prompt_version,
                               sample_index, temperature, raw_output)
      values (${orgId}, ${roundId}, ${rubric.id}, 'grader', ${grade.promptVersion},
              ${sample}, 0.3, ${tx.json({ dimensions: grade.dimensions.length })})
      on conflict (round_id, grader_prompt_version, sample_index) do nothing`;
  }

  const [score] = await tx<{ id: string }[]>`
    insert into scores (org_id, round_id, rubric_id, median_score, interval_low, interval_high,
                        sample_variance, sample_count)
    values (${orgId}, ${roundId}, ${rubric.id}, ${grade.overall.median},
            ${grade.overall.intervalLow}, ${grade.overall.intervalHigh},
            ${grade.overall.sampleVariance}, ${grade.overall.sampleCount})
    returning id`;
  const scoreId = score?.id;
  if (scoreId === undefined) throw new Error('Score insert returned no id.');

  for (const dim of grade.dimensions) {
    await tx`
      insert into score_dimensions (org_id, score_id, dimension, median_score,
                                    interval_low, interval_high, evidence_quote)
      values (${orgId}, ${scoreId}, ${dim.dimension}, ${dim.median},
              ${dim.intervalLow}, ${dim.intervalHigh}, ${dim.evidenceQuote})
      on conflict (score_id, dimension) do nothing`;
  }
}

/** Rebuilds the debrief packet from stored rows. No re-grading, no provider call. */
export async function loadDebrief(
  tx: TransactionSql,
  sessionId: string,
): Promise<DebriefPacket> {
  const state = await loadSession(tx, sessionId);

  const rows = await tx<Record<string, unknown>[]>`
    select s.round_id, s.rubric_id, s.median_score, s.interval_low, s.interval_high,
           s.sample_variance, s.sample_count,
           d.dimension, d.median_score as dim_median, d.interval_low as dim_low,
           d.interval_high as dim_high, d.evidence_quote
    from scores s
    join rounds r on r.id = s.round_id
    left join score_dimensions d on d.score_id = s.id
    where r.session_id = ${sessionId}
    order by r.position asc, d.dimension asc`;

  const byRound = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = String(row['round_id']);
    byRound.set(key, [...(byRound.get(key) ?? []), row]);
  }

  const roundInputs: RoundInput[] = [];
  for (const round of state.rounds) {
    const scored = byRound.get(round.id);
    if (scored === undefined || scored.length === 0) continue;
    const rubric = rubricById(round.rubricId);
    if (rubric === undefined) throw new MissingRubricError(round.rubricId);

    const head = scored[0];
    if (head === undefined) continue;
    const dimensions = scored
      .filter((r) => r['dimension'] !== null)
      .map((r) => {
        const median = Number(r['dim_median']);
        const low = Number(r['dim_low']);
        const high = Number(r['dim_high']);
        return {
          dimension: String(r['dimension']),
          evidenceQuote: r['evidence_quote'] === null ? '' : String(r['evidence_quote']),
          median,
          intervalLow: low,
          intervalHigh: high,
          sampleVariance: Number(head['sample_variance']),
          sampleCount: Number(head['sample_count']),
          halfWidth: Math.round(((high - low) / 2) * 100) / 100,
        };
      });

    roundInputs.push({
      position: round.position,
      roundType: round.roundType,
      persona: round.persona,
      rubric,
      grade: {
        rubricId: String(head['rubric_id']),
        promptVersion: 'anchored-v1',
        samplesCollected: Number(head['sample_count']),
        dimensions,
        overall: {
          median: Number(head['median_score']),
          intervalLow: Number(head['interval_low']),
          intervalHigh: Number(head['interval_high']),
          sampleVariance: Number(head['sample_variance']),
          sampleCount: Number(head['sample_count']),
          halfWidth:
            Math.round(((Number(head['interval_high']) - Number(head['interval_low'])) / 2) * 100) / 100,
        },
      },
    });
  }

  return assembleDebrief({
    sessionId,
    trackId: state.session.trackId,
    levelBand: state.session.levelBand,
    rounds: roundInputs,
  });
}
