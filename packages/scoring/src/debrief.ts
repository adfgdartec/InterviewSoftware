import type { Rubric } from '@loopcraft/core';
import { aggregate, formatScore, samplesDisagree, type AggregatedScore } from './aggregate.js';
import type { RoundGrade } from './grader.js';

/**
 * The synthetic debrief packet (spec §2.1): per-attribute evidence, quotes, gaps, and a
 * calibrated practice signal. It is the artifact a real hiring committee would receive,
 * which is the point -- it shows the candidate the shape of the document being written
 * about them.
 *
 * Two rules hold everywhere in this module:
 *   - No statement asserts or implies a hiring outcome (spec §5.3, guardrail 3).
 *   - No score appears without its interval and a link to the calibration card
 *     (acceptance criterion 8).
 */

export const CALIBRATION_PATH = '/calibration';

export interface RoundInput {
  readonly position: number;
  readonly roundType: string;
  readonly persona: string;
  readonly rubric: Rubric;
  readonly grade: RoundGrade;
}

export interface AttributeEvidence {
  readonly dimension: string;
  readonly name: string;
  readonly score: AggregatedScore;
  readonly display: string;
  readonly quote: string;
  readonly roundPosition: number;
  readonly lowInformation: boolean;
}

/**
 * Camera-framing measurements for the session, carried through to the debrief.
 *
 * Every field is a count, a ratio of counts, or a duration -- geometry over time, nothing
 * about the person. The notes are written where the thresholds live (the web app's
 * presence-analysis module) and carried verbatim, so this package holds no advice text of
 * its own and no rule for producing any.
 */
export interface PresenceReport {
  readonly sampleCount: number;
  readonly detectedCount: number;
  readonly wellFramedRatio: number;
  readonly offCenterRatio: number;
  readonly distanceOffRatio: number;
  readonly eyeLineOffRatio: number;
  readonly driftEvents: number;
  readonly longestWellFramedMs: number;
  /** How many rounds contributed. Named so the debrief can say what the numbers cover. */
  readonly roundCount: number;
  readonly notes: readonly string[];
}

export interface DebriefPacket {
  readonly sessionId: string;
  readonly trackId: string;
  readonly levelBand: string;
  readonly roundCount: number;
  readonly overall: AggregatedScore;
  readonly overallDisplay: string;
  readonly attributes: readonly AttributeEvidence[];
  /** Dimensions no round produced evidence for. A gap is reported, never scored as zero. */
  readonly gaps: readonly string[];
  /** Lowest-scoring attributes, as the next things to practise. Never framed as a verdict. */
  readonly practiceFocus: readonly AttributeEvidence[];
  readonly methodNote: string;
  readonly calibrationLink: string;
  /**
   * Null whenever the session has no framing data at all -- video off, not opted in, not
   * permitted in the candidate's region, or simply an audio round. Null and "measured, and
   * the framing was poor" are different answers, so the absent case is explicit rather than
   * a zeroed report that reads like a bad score.
   */
  readonly presence: PresenceReport | null;
}

export const METHOD_NOTE =
  'Each dimension is scored on a 1-5 anchored rubric by a grader separate from the ' +
  'interviewer, using three independent samples whose median is shown with the observed ' +
  'spread. Scores are coaching signals, not predictions of hiring outcomes.';

export class EmptyDebriefError extends Error {
  constructor(sessionId: string) {
    super(`Session ${sessionId} has no graded rounds to assemble a debrief from.`);
    this.name = 'EmptyDebriefError';
  }
}

export interface AssembleInput {
  readonly sessionId: string;
  readonly trackId: string;
  readonly levelBand: string;
  readonly rounds: readonly RoundInput[];
  readonly practiceFocusCount?: number;
  readonly presence?: PresenceReport | null;
}

/**
 * Assembles the packet. When one dimension is graded in several rounds, the round where it
 * scored lowest is the one surfaced: the debrief exists to show where the work is, and an
 * average would hide a round that went badly behind one that went well.
 */
export function assembleDebrief(input: AssembleInput): DebriefPacket {
  if (input.rounds.length === 0) throw new EmptyDebriefError(input.sessionId);

  const best = new Map<string, AttributeEvidence>();
  const declared = new Set<string>();

  for (const round of input.rounds) {
    for (const dim of round.rubric.dimensions) declared.add(dim.id);
    for (const scored of round.grade.dimensions) {
      const meta = round.rubric.dimensions.find((d) => d.id === scored.dimension);
      const evidence: AttributeEvidence = {
        dimension: scored.dimension,
        name: meta?.name ?? scored.dimension,
        score: scored,
        display: formatScore(scored),
        quote: scored.evidenceQuote,
        roundPosition: round.position,
        lowInformation: samplesDisagree(scored),
      };
      const existing = best.get(scored.dimension);
      if (existing === undefined || scored.median < existing.score.median) {
        best.set(scored.dimension, evidence);
      }
    }
  }

  const attributes = [...best.values()].sort((a, b) =>
    a.roundPosition - b.roundPosition || a.dimension.localeCompare(b.dimension),
  );
  if (attributes.length === 0) throw new EmptyDebriefError(input.sessionId);

  const gaps = [...declared].filter((d) => !best.has(d)).sort();

  const focusCount = input.practiceFocusCount ?? 3;
  const practiceFocus = [...attributes]
    .sort((a, b) => a.score.median - b.score.median)
    .slice(0, Math.max(0, focusCount));

  // The loop score aggregates the per-attribute medians, so its interval reflects
  // disagreement between attributes as well as between samples.
  const overall = aggregateMedians(attributes.map((a) => a.score.median));

  return {
    sessionId: input.sessionId,
    trackId: input.trackId,
    levelBand: input.levelBand,
    roundCount: input.rounds.length,
    overall,
    overallDisplay: formatScore(overall),
    attributes,
    gaps,
    practiceFocus,
    methodNote: METHOD_NOTE,
    calibrationLink: CALIBRATION_PATH,
    presence: input.presence ?? null,
  };
}

/** Deferred to the shared aggregator so the interval floor and clamping live in one place. */
function aggregateMedians(medians: readonly number[]): AggregatedScore {
  return aggregate(medians);
}
