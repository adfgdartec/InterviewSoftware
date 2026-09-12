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

/**
 * Models routinely emit `"level": "3"` -- the right verdict, wrapped in the wrong JSON type.
 * Rejecting those samples discarded roughly a third of real grades, which cost money and,
 * worse, narrowed the sample count the interval is computed from without saying so.
 *
 * Normalising a numeric string to a number is NOT the same as repairing a bad grade: the
 * value is untouched, only its encoding. Anything that is not a clean integer string is left
 * alone and fails validation as before, and a sample that scores a dimension the rubric does
 * not have is still discarded rather than salvaged.
 */
const levelValue = z.preprocess(
  (raw) => (typeof raw === 'string' && /^\s*\d+\s*$/.test(raw) ? Number(raw.trim()) : raw),
  z.number().int().min(1).max(5),
);

/**
 * How long an evidence quote may be.
 *
 * The cap exists so the grader cannot pass the candidate's entire answer off as "evidence"
 * for every dimension, which would make the quote useless for auditing a score. It was 600
 * and the prompt never mentioned it, so a grader quoting a long but entirely legitimate span
 * failed the schema -- and because a schema failure discards the WHOLE sample, one long quote
 * threw away all four dimensions of that sample. Three such samples is a 500 on the debrief,
 * which is exactly what a real five-round loop produced.
 *
 * The fix is on both sides: the prompt now states the limit (see buildGraderPrompt) so the
 * grader complies, and the ceiling here sits above it so a slight overshoot is not fatal.
 */
export const MAX_EVIDENCE_QUOTE_CHARS = 1_000;

/** What the prompt asks for, deliberately below the hard ceiling the schema enforces. */
export const REQUESTED_EVIDENCE_QUOTE_CHARS = 400;

/** One dimension's verdict from one sample. The quote is what makes the score auditable. */
export const dimensionVerdict = z.object({
  dimension: z.string().min(1),
  level: levelValue,
  evidenceQuote: z.string().min(1).max(MAX_EVIDENCE_QUOTE_CHARS),
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
    '- evidenceQuote MUST be a verbatim span copied from an "A:" line of the transcript.',
    '  Copy the candidate\'s exact words. Do NOT summarise, paraphrase, or describe what they',
    '  did, and do NOT restate the anchor text above -- those are the levels, not the evidence.',
    '  If a dimension has no supporting words in the transcript, quote the closest thing the',
    '  candidate actually said and score the low level it evidences.',
    // A real debrief printed the same sentence under five different dimensions, which makes
    // the evidence look decorative rather than diagnostic -- the whole point of the quote is
    // that it shows WHY this dimension scored what it did.
    '- Use a DIFFERENT span for each dimension. If two dimensions would quote the same words,',
    '  the second one is not evidenced by them: quote what actually bears on that dimension,',
    '  or quote the nearest thing and score it low.',
    `- Keep evidenceQuote under ${REQUESTED_EVIDENCE_QUOTE_CHARS} characters -- one or two`,
    '  sentences. Quote the span that shows the level, not the whole answer.',
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

/**
 * Normalises text for the verbatim-quote check: models re-wrap lines, change straight quotes
 * to curly ones, and collapse whitespace differently from the transcript they were given.
 * None of those make a quote less verbatim, so none of them should fail the check.
 */
function normalizeForQuoteCheck(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Trims the punctuation a model leaves on the EDGES of an excerpt.
 *
 * Observed in a real run: the candidate wrote "...into a parallel one, and write
 * asynchronously..." and the grader quoted "...into a parallel one." -- ending its excerpt
 * mid-sentence and terminating it with a full stop. That is the same span, re-punctuated at
 * the cut, and failing it as "not a verbatim quote" is a false rejection that discarded the
 * whole sample.
 *
 * Only the edges are touched, and only on the quote, never the transcript: a paraphrase is
 * still a paraphrase, and internal wording still has to match exactly. What this forgives is
 * how the model ended its excerpt, not what the excerpt says.
 */
function trimQuoteEdges(text: string): string {
  return text.replace(/^["'\u2026.,;:\s-]+/, '').replace(/["'\u2026.,;:\s-]+$/, '');
}

/**
 * The candidate's own words, with the interviewer's stripped out. `transcriptForRound`
 * formats turns as "Q: ...\nA: ...", and a quote lifted from a Q line would credit the
 * candidate with the interviewer's phrasing.
 */
function answerText(transcript: string): string {
  return transcript
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('Q:'))
    .map((line) => line.replace(/^\s*A:\s*/, ''))
    .join(' ');
}

/**
 * Validates one raw sample against the contract and the rubric's declared dimensions.
 *
 * When `transcript` is supplied, every evidenceQuote must actually appear in what the
 * candidate said. Observed in a live run before this existed: the grader returned polished
 * restatements of the RUBRIC ANCHORS ("Traced a request end to end, naming what is written
 * and what is read at each hop") for answers that said nothing of the kind -- and the debrief
 * rendered them under the heading "Quoted from your answer". A prompt instruction alone did
 * not stop it, so this is a check rather than a hope.
 */
export function parseSample(raw: unknown, rubric: Rubric, transcript?: string): GraderResponse {
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
    if (transcript !== undefined) {
      const haystack = normalizeForQuoteCheck(answerText(transcript));
      const needle = trimQuoteEdges(normalizeForQuoteCheck(verdict.evidenceQuote));
      if (needle.length === 0) {
        throw new GraderContractError(
          `Grader evidence for "${verdict.dimension}" is punctuation, not a quote.`,
        );
      }
      if (!haystack.includes(needle)) {
        throw new GraderContractError(
          `Grader evidence for "${verdict.dimension}" is not a verbatim quote from the answer.`,
        );
      }
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

  // The samples are INDEPENDENT by construction (see the sampler's own notes on why they
  // must not be coalesced), so running them one after another only ever added latency: a
  // five-round loop is fifteen grading calls, and serially that was minutes of a candidate
  // watching a spinner. Issued together, a round costs one call's wall time, not three.
  const settled = await Promise.allSettled(
    Array.from({ length: sampleCount }, (_, i) =>
      sampler.sample(prompt, GRADER_TEMPERATURE, i + 1),
    ),
  );

  const collected: GraderResponse[] = [];
  for (const outcome of settled) {
    if (outcome.status === 'rejected') {
      // A contract violation is discarded, as it always was. Anything else -- a transport
      // failure, a missing credential -- is not the grader misunderstanding the task, and
      // must not be laundered into a thinner-but-valid grade. Results are walked in sample
      // order so which error surfaces does not depend on which call happened to lose a race.
      if (!(outcome.reason instanceof GraderContractError)) throw outcome.reason;
      continue;
    }
    try {
      collected.push(parseSample(outcome.value, rubric, transcript));
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
