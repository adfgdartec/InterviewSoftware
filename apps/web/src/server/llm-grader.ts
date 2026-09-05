import {
  lookup,
  ollamaReachable,
  openaiChat,
  openaiConfigured,
  // index.ts aliases OpenAI's `chat` to `openaiChat` and re-exports Ollama's under its own
  // name, so the bare `chat` is the Ollama one. Aliased here so the call site says which.
  chat as ollamaChat,
} from '@loopcraft/providers';
import type { GraderSampler } from '@loopcraft/scoring';

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
 * Provider follows registry.ts's `grading` entry: a local Ollama model first, OpenAI as the
 * fallback tier. On Workers, Ollama is unreachable, so the fallback is the real path -- which
 * is stated here rather than discovered from a bill.
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

export interface LlmGraderOptions {
  /** Overridden in tests. Defaults probe the real providers. */
  readonly ollamaAvailable?: () => Promise<boolean>;
}

/**
 * Returns a sampler, or null when no provider is configured at all. Null is deliberate: the
 * debrief route already answers 503 `grader_unavailable` for a null sampler, which is an
 * honest "we cannot grade this right now" rather than a fabricated grade.
 */
export function llmGraderSampler(options: LlmGraderOptions = {}): GraderSampler | null {
  const entry = lookup(GRADING);
  const probeOllama = options.ollamaAvailable ?? ollamaReachable;

  if (!openaiConfigured()) {
    // Ollama may still be up locally; the sampler checks per call rather than at wiring time,
    // because a local model can come and go while the process lives.
    if (entry.primary.provider !== 'ollama') return null;
  }

  return {
    async sample(prompt: string, temperature: number, sampleIndex: number): Promise<unknown> {
      const messages = [
        { role: 'system' as const, content: samplePreamble(sampleIndex) },
        { role: 'user' as const, content: prompt },
      ];

      const useOllama = entry.primary.provider === 'ollama' && (await probeOllama());
      const raw = useOllama
        ? await ollamaChat({
            model: entry.primary.model,
            messages,
            temperature,
            timeoutMs: entry.primary.timeoutMs,
          },
          // Same reason as the OpenAI branch: three coalesced samples are one sample.
          false)
        : await openaiChat(
            {
              model: entry.fallbacks[0]?.model ?? 'gpt-4o-mini',
              messages,
              temperature,
              timeoutMs: entry.fallbacks[0]?.timeoutMs ?? 30_000,
            },
            // Never cacheable. See samplePreamble.
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
