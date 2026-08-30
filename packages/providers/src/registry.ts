/**
 * The one place model names, timeouts, retries and fallbacks are declared (spec §3.4).
 * Nothing outside this file names a model string.
 */

export type Purpose = 'question_generation' | 'interviewer_turn' | 'grading' | 'asr' | 'tts' | 'debrief';

export interface ModelEntry {
  readonly provider: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  /** Cheaper model used when the session cost ceiling is close (spec §3.4 graceful degrade). */
  readonly degradeTo?: string;
}

export interface RegistryEntry {
  readonly purpose: Purpose;
  readonly primary: ModelEntry;
  readonly fallbacks: readonly ModelEntry[];
}

const entry = (
  provider: string,
  model: string,
  timeoutMs: number,
  maxRetries: number,
  degradeTo?: string,
): ModelEntry => (degradeTo === undefined
  ? { provider, model, timeoutMs, maxRetries }
  : { provider, model, timeoutMs, maxRetries, degradeTo });

/**
 * Open-source first: every reasoning purpose runs on a locally-hosted model via Ollama by
 * default (no API key, no per-token cost, no network round trip). OpenAI is the fallback
 * tier, used only when the local model is unavailable or degrades under the cost ceiling
 * (packages/providers/src/ceiling.ts) -- never the default.
 *
 * Model tags name what is ACTUALLY pulled on the machine this was built on (`ollama list`),
 * not an aspirational tag that has to be downloaded before anything works. llama3.1:8b and
 * qwen2.5:14b were the originally intended tags; this host already had llama3.2:latest (2GB)
 * and llama3:latest (4.7GB) from prior work, and pulling the aspirational tags on a 20GB-free
 * disk was the exact mistake that broke Docker earlier in this build. Grading intentionally
 * uses a different model family (llama3, not llama3.2) so grader separation (spec §2.6) is a
 * real distinction, not two tags for the same weights. Swap OLLAMA_HOST to point at a remote
 * Ollama/vLLM host, or pull the originally-intended tags yourself, if you want them back.
 */
export const REGISTRY: readonly RegistryEntry[] = [
  {
    purpose: 'question_generation',
    primary: entry('ollama', 'llama3.2:latest', 20_000, 2, 'llama3.2:latest'),
    fallbacks: [entry('openai', 'gpt-4o-mini', 20_000, 1)],
  },
  {
    purpose: 'interviewer_turn',
    primary: entry('ollama', 'llama3.2:latest', 15_000, 2, 'llama3.2:latest'),
    fallbacks: [entry('openai', 'gpt-4o-mini', 15_000, 1)],
  },
  {
    // Spec §2.6: the grader is a separate model from the interviewer and never sees the
    // interviewer's reasoning -- only transcript, artifacts and rubric.
    purpose: 'grading',
    primary: entry('ollama', 'llama3:latest', 45_000, 2, 'llama3.2:latest'),
    fallbacks: [entry('openai', 'gpt-4o-mini', 30_000, 1)],
  },
  {
    purpose: 'debrief',
    primary: entry('ollama', 'llama3.2:latest', 30_000, 2, 'llama3.2:latest'),
    fallbacks: [entry('openai', 'gpt-4o-mini', 20_000, 1)],
  },
  {
    purpose: 'asr',
    primary: entry('deepgram', 'nova-3', 120_000, 2),
    fallbacks: [entry('openai', 'whisper-1', 180_000, 1)],
  },
  {
    purpose: 'tts',
    primary: entry('elevenlabs', 'eleven_turbo_v2_5', 30_000, 2),
    fallbacks: [],
  },
] as const;

export function lookup(purpose: Purpose): RegistryEntry {
  const found = REGISTRY.find((r) => r.purpose === purpose);
  if (found === undefined) throw new Error(`No registry entry for purpose "${purpose}"`);
  return found;
}

/** Interviewer and grader must never resolve to the same model (spec §2.6 grader separation). */
export function graderIsSeparateFromInterviewer(): boolean {
  return lookup('grading').primary.model !== lookup('interviewer_turn').primary.model;
}
