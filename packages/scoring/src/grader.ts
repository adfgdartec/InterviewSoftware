import { z } from 'zod';
import { findBannedTokensInText, isFieldNameAllowed, type Rubric } from '@loopcraft/core';
import { aggregate, type AggregatedScore } from './aggregate.js';

/**
 * The anchored grader. Spec §2.6: the interviewer model never grades; a separate grader
 * receives only the transcript, the artifacts and the rubric, and runs n=3 independent
 * samples whose median is reported with its spread.
 */

export const GRADER_SAMPLE_COUNT = 3;
export const GRADER_TEMPERATURE = 0.3;
export const GRADER_PROMPT_VERSION = 'anchored-v1';

/** One dimension's verdict from one sample. The quote is what makes the score auditable. */
export const dimensionVerdict = z.object({
  dimension: z.string().min(1),
  level: z.number().int().min(1).max(5),
  evidenceQuote: z.string().min(1).max(600),
});

export const graderResponse = z.object({
  dimensions: z.array(dimensionVerdict).min(1),
});

export type GraderResponse = z.infer<typeof graderResponse>;

export class GraderContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraderContractError';
  }
}

/**
 * Builds the grader prompt. It is assembled here rather than at the call site so exactly one
 * string reaches the model and one test can assert what is in it -- notably that the
 * interviewer's own reasoning is absent and that the affect vocabulary never appears.
 */
export function buildGraderPrompt(rubric: Rubric, transcript: string): string {
  const dimensions = rubric.dimensions
    .map((d) => {
      const anchors = d.anchors
        .map((a) => `    ${a.level}. ${a.anchor}\n       e.g. ${a.workedExampleA}\n       e.g. ${a.workedExampleB}`)
        .join('\n');
      return `  ${d.id} — ${d.name}\n    ${d.description}\n${anchors}`;
    })
    .join('\n\n');

  return [
    'You are grading one round of an interview rehearsal against a published rubric.',
    '',
    'Rules:',
    '- Score only against the anchors below. Do not invent dimensions.',
    '- Base every score on what the candidate said or did, quoted from the transcript.',
    '- Do not describe or infer the candidate\'s internal state. If you cannot quote evidence',
    '  for a level, score the level you can evidence.',
    '- Do not comment on hiring outcomes, suitability, or the likelihood of an offer.',
    '- Return JSON only: {"dimensions":[{"dimension","level","evidenceQuote"}]}',
    '',
    `Rubric ${rubric.id} (version ${rubric.version}), scale 1-5:`,
    dimensions,
    '',
    'Transcript:',
    transcript,
  ].join('\n');
}

/** One grading sample. Implementations wrap a provider call; demo mode supplies a fake. */
export interface GraderSampler {
  sample(prompt: string, temperature: number, sampleIndex: number): Promise<unknown>;
}

export interface DimensionScore extends AggregatedScore {
  readonly dimension: string;
  readonly evidenceQuote: string;
}

export interface RoundGrade {
  readonly rubricId: string;
  readonly promptVersion: string;
  readonly overall: AggregatedScore;
  readonly dimensions: readonly DimensionScore[];
  readonly samplesCollected: number;
}

/** Validates one raw sample against the contract and the rubric's declared dimensions. */
export function parseSample(raw: unknown, rubric: Rubric): GraderResponse {
  const parsed = graderResponse.safeParse(raw);
  if (!parsed.success) {
    throw new GraderContractError(
      `Grader response failed its schema: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  const declared = new Set(rubric.dimensions.map((d) => d.id));
  for (const verdict of parsed.data.dimensions) {
    if (!declared.has(verdict.dimension)) {
      throw new GraderContractError(
        `Grader scored "${verdict.dimension}", which is not a dimension of ${rubric.id}.`,
      );
    }
    if (!isFieldNameAllowed(verdict.dimension)) {
      throw new GraderContractError(
        `Grader emitted the dimension "${verdict.dimension}", which infers an internal state.`,
      );
    }
    if (findBannedTokensInText(verdict.evidenceQuote).length > 0) {
      // The quote is the candidate's own words, so this fires when the grader paraphrased
      // into affect language instead of quoting. Reject the sample rather than store it.
      throw new GraderContractError(
        `Grader evidence for "${verdict.dimension}" reports an internal state rather than quoting.`,
      );
    }
  }
  return parsed.data;
}

/**
 * Runs n independent samples and aggregates them per dimension. A sample that violates the
 * contract is discarded, not repaired: a grader that scored a dimension the rubric does not
 * have has misunderstood the task, and averaging its output in would launder that.
 *
 * Grading proceeds on the surviving samples so one malformed sample does not cost the
 * candidate their round, but the count is reported so a degraded grade is visible.
 */
export async function gradeRound(
  rubric: Rubric,
  transcript: string,
  sampler: GraderSampler,
  sampleCount: number = GRADER_SAMPLE_COUNT,
): Promise<RoundGrade> {
  if (sampleCount < 1) throw new RangeError('sampleCount must be >= 1');
  if (transcript.trim().length === 0) {
    throw new GraderContractError('Cannot grade an empty transcript.');
  }
  const prompt = buildGraderPrompt(rubric, transcript);

  const collected: GraderResponse[] = [];
  for (let i = 0; i < sampleCount; i += 1) {
    try {
      collected.push(parseSample(await sampler.sample(prompt, GRADER_TEMPERATURE, i + 1), rubric));
    } catch (error) {
      if (!(error instanceof GraderContractError)) throw error;
    }
  }
  if (collected.length === 0) {
    throw new GraderContractError('No grader sample satisfied the response contract.');
  }

  const dimensions: DimensionScore[] = [];
  for (const declared of rubric.dimensions) {
    const levels = collected
      .map((c) => c.dimensions.find((d) => d.dimension === declared.id)?.level)
      .filter((l): l is number => l !== undefined);
    if (levels.length === 0) continue;
    const quote =
      collected
        .map((c) => c.dimensions.find((d) => d.dimension === declared.id)?.evidenceQuote)
        .find((q): q is string => q !== undefined) ?? '';
    dimensions.push({ dimension: declared.id, evidenceQuote: quote, ...aggregate(levels) });
  }
  if (dimensions.length === 0) {
    throw new GraderContractError(`No sample scored any dimension of ${rubric.id}.`);
  }

  // The round score is the aggregate of the per-dimension medians, so its interval widens
  // when the dimensions disagree with each other as well as when the samples do.
  const overall = aggregate(dimensions.map((d) => d.median));
  return {
    rubricId: rubric.id,
    promptVersion: GRADER_PROMPT_VERSION,
    overall,
    dimensions,
    samplesCollected: collected.length,
  };
}
