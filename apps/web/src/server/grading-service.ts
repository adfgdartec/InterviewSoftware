import type { TransactionSql } from 'postgres';
import { rubricById, type Rubric } from '@loopcraft/core';
import {
  assembleDebrief,
  gradeRound,
  type DebriefPacket,
  type GraderSampler,
  type PresenceReport,
  type RoundGrade,
  type RoundInput,
} from '@loopcraft/scoring';
import { combinePresence } from '../lib/presence-analysis.js';
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

  // Three passes, deliberately. The database work stays sequential -- it all runs inside one
  // transaction, which is a single connection and cannot serve interleaved statements -- while
  // the grading calls, which are the slow part and touch nothing shared, run together. Grading
  // a five-round loop was fifteen calls end to end; now it is bounded by the slowest round.
  let skipped = 0;
  const pending: { roundId: string; rubric: Rubric; transcript: string }[] = [];

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

    pending.push({ roundId: round.id, rubric, transcript });
  }

  const grades = await mapWithConcurrency(pending, MAX_CONCURRENT_ROUNDS, async (item) => ({
    item,
    grade: await gradeRound(item.rubric, item.transcript, sampler),
  }));

  // Persisted in round order rather than completion order, so two runs of the same session
  // write the same rows in the same sequence.
  for (const { item, grade } of grades) {
    await persistGrade(tx, state.session.orgId, item.roundId, item.rubric, grade);
  }
  return { graded: grades.length, skipped };
}

/**
 * How many rounds may be graded at once. Each round is itself three concurrent samples, so
 * this is a ceiling of nine in-flight provider calls -- enough to collapse the wall time of a
 * five-round loop, low enough not to trip a provider's per-minute request limit and turn a
 * latency win into a round of 429s.
 */
const MAX_CONCURRENT_ROUNDS = 3;

/**
 * `Promise.all` over every item at once would be unbounded; this keeps at most `limit` in
 * flight while preserving input order in the result. Rejections propagate as they would from
 * `Promise.all`, so a failed round still fails the request rather than being silently dropped.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await fn(items[i]!);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()),
  );
  return results;
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
                                    interval_low, interval_high, evidence_quote,
                                    sample_variance, sample_count)
      values (${orgId}, ${scoreId}, ${dim.dimension}, ${dim.median},
              ${dim.intervalLow}, ${dim.intervalHigh}, ${dim.evidenceQuote},
              ${dim.sampleVariance}, ${dim.sampleCount})
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
           d.interval_high as dim_high, d.evidence_quote,
           d.sample_variance as dim_variance, d.sample_count as dim_samples
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
        // Each dimension's OWN spread. This used to read the round-level figure off `head`,
        // so a round whose overall score was contested printed "the three samples disagreed"
        // under every dimension -- including ones all three samples scored identically.
        // Rows written before migration 0011 have no per-dimension figure; those, and only
        // those, still fall back to the round's.
        const variance = r['dim_variance'];
        const samples = r['dim_samples'];
        return {
          dimension: String(r['dimension']),
          evidenceQuote: r['evidence_quote'] === null ? '' : String(r['evidence_quote']),
          median,
          intervalLow: low,
          intervalHigh: high,
          sampleVariance: variance === null || variance === undefined
            ? Number(head['sample_variance'])
            : Number(variance),
          sampleCount: samples === null || samples === undefined
            ? Number(head['sample_count'])
            : Number(samples),
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
    presence: await loadPresence(tx, sessionId),
  });
}

/**
 * The framing rows for a session, combined into one report.
 *
 * The rows were written by POST /api/sessions/:id/presence and, until now, never read back:
 * the route, the table and its tests existed while the debrief showed nothing. Absent rows
 * are the normal case -- an audio-only loop, video not opted into, a region where it is not
 * permitted -- and produce null rather than an empty report.
 */
async function loadPresence(
  tx: TransactionSql,
  sessionId: string,
): Promise<PresenceReport | null> {
  const rows = await tx<Record<string, unknown>[]>`
    select p.sample_count, p.detected_count, p.well_framed_ratio, p.off_center_ratio,
           p.distance_off_ratio, p.eye_line_off_ratio, p.drift_events, p.longest_well_framed_ms
    from round_presence p
    join rounds r on r.id = p.round_id
    where r.session_id = ${sessionId}
    order by r.position asc`;

  return combinePresence(
    rows.map((r) => ({
      sampleCount: Number(r['sample_count']),
      detectedCount: Number(r['detected_count']),
      wellFramedRatio: Number(r['well_framed_ratio']),
      offCenterRatio: Number(r['off_center_ratio']),
      distanceOffRatio: Number(r['distance_off_ratio']),
      eyeLineOffRatio: Number(r['eye_line_off_ratio']),
      driftEvents: Number(r['drift_events']),
      longestWellFramedMs: Number(r['longest_well_framed_ms']),
    })),
  );
}
