import { LOOP_TEMPLATES, rubricById, trackById, type Rubric } from '@loopcraft/core';
import { openaiChat, chat as ollamaChat } from '@loopcraft/providers';
import type { QuestionGenerator, QuestionRequest } from './question-generation.js';
import { resolveModel, type ProviderProbes } from './model-tier.js';

/**
 * Real question generation, against the rubric the round will actually be graded on.
 *
 * `demoGenerator` returned a fixed line from the static item bank, which is why every loop
 * asked the same handful of questions regardless of track or level. This asks a model for a
 * question targeting the specific dimensions the grader is about to score, so what is asked
 * and what is measured are the same thing.
 *
 * Everything protective around it already existed and is unchanged: `selectQuestion` still
 * validates the text through `rejectionReason` (length bounds and the affect vocabulary),
 * still falls back to the catalog when generation fails or is rejected, and still records
 * why. A model that drifts into asking how the candidate felt gets discarded, not shown.
 */

const QUESTION_GENERATION = 'question_generation' as const;

/** Rubric dimensions, as the thing the question has to create evidence for. */
function dimensionBrief(rubric: Rubric): string {
  return rubric.dimensions.map((d) => `- ${d.name}: ${d.description}`).join('\n');
}

function buildPrompt(request: QuestionRequest, rubric: Rubric, seniority: string): string {
  const track = trackById(request.trackId);
  return [
    'Write ONE interview question for a rehearsal tool.',
    '',
    `Track: ${track?.name ?? request.trackId}${track === undefined ? '' : ` — ${track.covers}`}`,
    `Round type: ${request.roundType}`,
    `Level: ${request.levelBand} (${seniority})`,
    '',
    'The answer must produce evidence for these rubric dimensions:',
    dimensionBrief(rubric),
    '',
    'Requirements:',
    '- One question. No preamble, no numbering, no quotation marks around it.',
    // Generated questions drifted into 250-character run-ons that bolted three asks together
    // with "including..." and "and what...", which is not how anyone interviews out loud and
    // is unreadable at display size. One ask, short enough to be said in a breath.
    '- Under 30 words, and ONE ask. Do not chain sub-questions with "including", "as well as",',
    '  or "and what". If the rubric needs more, ask the sharpest part and let the follow-up',
    '  come later -- the interviewer asks follow-ups of its own.',
    '- Concrete and specific enough that a vague answer is obviously vague.',
    '- Answerable out loud in a few minutes. Do not ask for code to be written out.',
    '- Ask about the candidate\'s own work, reasoning or choices.',
    // Phrased without the banned affect vocabulary itself: the no-affect-inference rule
    // covers generator prompts, not just user-facing copy, and it caught the first draft of
    // this line. The constraint is unchanged; only the wording avoids the words.
    '- Ask only about work, decisions and reasoning. Never ask how anyone felt, or about',
    '  anyone\'s inner state or character.',
    '- Do not name a real company, and do not imply any hiring outcome.',
    '',
    'Return only the question text.',
  ].join('\n');
}

/**
 * Level bands are terse ("L4"), and a model given only the band tends to write the same
 * mid-level question every time. Naming the expectation is what moves the difficulty.
 */
function seniorityOf(levelBand: string): string {
  switch (levelBand) {
    case 'L3':
      return 'early career; expect scoped, well-executed work';
    case 'L4':
      return 'mid level; expect ownership of a whole component and real tradeoffs';
    case 'L5':
      return 'senior; expect system-level design, ambiguity, and cross-team consequences';
    case 'L6':
      return 'staff; expect organisational impact and decisions with long time horizons';
    default:
      return 'expect work owned end to end';
  }
}

/**
 * Which rubric a round is graded against, derived from the published loop templates.
 *
 * `selectQuestion` receives the rubric id separately from the request, and the generator port
 * only sees the request -- so rather than widen the port (and every implementation and test
 * of it) for one caller, the same fact is recovered from the catalog that defined it. The
 * templates are the source of truth for which rubric a (track, roundType) pair uses.
 */
export function rubricIdFor(trackId: string, roundType: string): string | undefined {
  for (const template of LOOP_TEMPLATES) {
    if (template.trackId !== trackId) continue;
    const round = template.rounds.find((r) => r.roundType === roundType);
    if (round !== undefined) return round.rubricId;
  }
  return undefined;
}

export interface LlmQuestionGeneratorOptions extends ProviderProbes {
  /** Defaults to the catalog-derived lookup above; overridden in tests. */
  readonly rubricFor?: (request: QuestionRequest) => string | undefined;
}

/**
 * Returns a generator. Which provider serves is resolved per call, not at wiring time, so a
 * key added or a local model started mid-process is picked up; when none is usable the
 * generator throws and `selectQuestion` falls back to the catalog and records
 * `no_generator_configured`, which is the honest state rather than a fabricated question.
 */
export function llmQuestionGenerator(
  options: LlmQuestionGeneratorOptions = {},
): QuestionGenerator {
  return {
    async generate(request: QuestionRequest, signal: AbortSignal): Promise<string> {
      const rubricFor =
        options.rubricFor ?? ((r) => rubricIdFor(r.trackId, r.roundType));
      const rubricId = rubricFor(request);
      const rubric = rubricId === undefined ? undefined : rubricById(rubricId);
      if (rubric === undefined) {
        // Without a rubric there is nothing to target, and a generic question is worse than
        // a curated catalog one. Throwing routes selectQuestion to the fallback.
        throw new Error(`No rubric for ${request.trackId}/${request.roundType}.`);
      }

      const prompt = buildPrompt(request, rubric, seniorityOf(request.levelBand));
      // `gatedCall` coalesces on the message content REGARDLESS of the cacheable flag, so two
      // candidates starting the same round at the same moment would collapse into one upstream
      // call and be handed the identical question -- which is the static item bank again, just
      // more expensively. A per-call nonce makes each request its own. It sits in a system
      // line carrying no instruction, so it changes the key without steering the question.
      const messages = [
        { role: 'system' as const, content: `Request ${crypto.randomUUID()}.` },
        { role: 'user' as const, content: prompt },
      ];

      // The abort signal belongs to selectQuestion's own timeout. Racing it here keeps that
      // budget authoritative even though the provider clients take their own timeout.
      const aborted = new Promise<never>((_, reject) => {
        if (signal.aborted) reject(new Error('Question generation aborted.'));
        signal.addEventListener('abort', () => reject(new Error('Question generation aborted.')), {
          once: true,
        });
      });

      const model = await resolveModel(QUESTION_GENERATION, options);
      if (model === null) throw new Error('No question-generation provider is usable.');

      // Warm enough that a track does not ask one question forever. Not cacheable, for the
      // same reason: a cached question is the static bank again.
      const call = (model.provider === 'ollama' ? ollamaChat : openaiChat)(
        {
          model: model.model,
          messages,
          temperature: 0.8,
          timeoutMs: model.timeoutMs,
        },
        false,
      );

      return stripWrapping(await Promise.race([call, aborted]));
    },
  };
}

/**
 * Models add a leading "Sure — here's a question:" or wrap the whole thing in quotes even
 * when told not to. Left in place, that text reaches the candidate verbatim.
 */
export function stripWrapping(raw: string): string {
  let text = raw.trim();
  const lead = /^(?:sure[,!.]?\s*)?(?:here(?:'s| is)[^:\n]*:)\s*/i.exec(text);
  if (lead !== null) text = text.slice(lead[0].length).trim();
  text = text.replace(/^["“']+|["”']+$/g, '').trim();
  // A model that ignored "one question" and returned a list: take the first non-empty line.
  const firstLine = text.split('\n').find((l) => l.trim().length > 0) ?? text;
  return firstLine.replace(/^\s*(?:\d+[.)]|[-*])\s*/, '').trim();
}
