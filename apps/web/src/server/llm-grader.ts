import {
  openaiChat,
  // index.ts aliases OpenAI's `chat` to `openaiChat` and re-exports Ollama's under its own
  // name, so the bare `chat` is the Ollama one. Aliased here so the call site says which.
  chat as ollamaChat,
} from '@loopcraft/providers';
import type { GraderSampler } from '@loopcraft/scoring';
import { resolveModel, type ProviderProbes } from './model-tier.js';

/**
 * The real grader. Until this existed every score in the product came from
 * `heuristicGraderSampler` -- a deterministic stub reading string length and whether the
 * answer contained a digit -- which is why every debrief read the same number down the page
 * with evidence quotes that did not match their dimensions.
 *
 * It implements the same `GraderSampler` port, so the pipeline around it is unchanged: the
 * anchored prompt, the contract validation, the discard-on-violation rule and the n=3
 * aggregation in packages/scoring/src/grader.ts all already worked. Only the thing that
 * produced the numbers was fake.
 *
 * Provider follows registry.ts's `grading` entry, resolved per sample through
 * `resolveModel`: the first declared provider that is actually usable. On Workers that is
 * OpenAI; on a developer's machine with no key it is the local Ollama model, at no cost.
 */

/**
 * Three samples must be three INDEPENDENT reads, and two mechanisms would silently prevent
 * that.
 *
 * `openaiChat` runs through `gatedCall`, which coalesces on `model::JSON.stringify(messages)`
 * and can additionally serve a semantic cache. Three identical prompts would therefore
 * collapse into ONE upstream call whose answer is returned three times -- producing perfect
 * agreement, an interval of zero, and a debrief that claims a confidence it never measured.
 *
 * So: `cacheable: false`, and every sample carries a distinct system line. The line changes
 * the coalescer key and nothing else; it deliberately carries no instruction that could move
 * a score, because a sample that grades differently *because of its index* is not an
 * independent read either.
 */
function samplePreamble(sampleIndex: number): string {
  return `Independent grading pass ${sampleIndex + 1}. Grade the transcript on its own merits.`;
}

const GRADING = 'grading' as const;

export type LlmGraderOptions = ProviderProbes;

/**
 * Returns a sampler. It is never null at wiring time any more: whether a provider is usable
 * is a per-call question (a key can be added, a local model can stop), so the sampler
 * resolves it per sample and throws `GraderUnavailableError` when nothing is usable. The
 * debrief route maps that to the same honest 503 `grader_unavailable` it always did, rather
 * than a fabricated grade.
 */
export class GraderUnavailableError extends Error {
  // Same status and wire code the debrief route has always returned for an unconfigured
  // grader, so the client contract is unchanged by where the check now happens.
  readonly httpStatus = 503;
  readonly code = 'grader_unavailable';
  constructor() {
    super('Grading is not configured.');
    this.name = 'GraderUnavailableError';
  }
}

export function llmGraderSampler(options: LlmGraderOptions = {}): GraderSampler {
  return {
    async sample(prompt: string, temperature: number, sampleIndex: number): Promise<unknown> {
      const messages = [
        { role: 'system' as const, content: samplePreamble(sampleIndex) },
        { role: 'user' as const, content: prompt },
      ];

      const model = await resolveModel(GRADING, options);
      if (model === null) throw new GraderUnavailableError();

      // Never cacheable, on either branch. See samplePreamble: coalescing three identical
      // prompts into one call would report perfect agreement it never measured.
      const raw =
        model.provider === 'ollama'
          ? await ollamaChat(
              {
                model: model.model,
                messages,
                temperature,
                timeoutMs: model.timeoutMs,
              },
              false,
            )
          : await openaiChat(
              {
                model: model.model,
                messages,
                temperature,
                timeoutMs: model.timeoutMs,
              },
              false,
            );

      return parseJsonObject(raw);
    },
  };
}

/**
 * Models wrap JSON in prose or a fenced block even when told not to. Recovering the object
 * here rather than in the scoring package keeps the contract strict where it matters: an
 * unparseable sample still throws, and `gradeRound` discards it rather than repairing it.
 */
export function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Fall back to the outermost brace pair, which survives a leading "Here is the JSON:".
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new SyntaxError('Grader returned no JSON object.');
    }
    return JSON.parse(candidate.slice(start, end + 1));
  }
}
