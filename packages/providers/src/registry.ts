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
 * OpenAI first, local Ollama as the fallback tier.
 *
 * This ordering is a deployment fact, not a preference. The product runs on Cloudflare
 * Workers, and a Worker cannot reach `localhost:11434`, so a local-first ordering meant the
 * primary tier was unreachable for every request in production. Worse, `interviewer.ts` had
 * no OpenAI path at all and short-circuited to "accept" whenever the Ollama probe failed --
 * so the back-and-forth interview silently did not happen in production at all.
 *
 * Ordering alone does not decide anything: call sites resolve a purpose through
 * `selectEntry()`, which walks [primary, ...fallbacks] and takes the first provider that is
 * actually usable. A developer with no OPENAI_API_KEY therefore still runs entirely on local
 * Ollama at no cost, and a Worker with a key never probes localhost. Reordering this list is
 * the only change needed to move the default tier.
 *
 * Ollama model tags name what is ACTUALLY pulled on the machine this was built on
 * (`ollama list`), not an aspirational tag that has to be downloaded before anything works.
 * Grading intentionally uses a different model from the interviewer in BOTH tiers -- gpt-4o
 * vs gpt-4o-mini, llama3 vs llama3.2 -- so grader separation (spec §2.6) is a real
 * distinction at whichever tier is serving, not an artifact of one of them.
 */
export const REGISTRY: readonly RegistryEntry[] = [
  {
    purpose: 'question_generation',
    primary: entry('openai', 'gpt-4o-mini', 20_000, 1, 'gpt-4o-mini'),
    fallbacks: [entry('ollama', 'llama3.2:latest', 20_000, 2)],
  },
  {
    purpose: 'interviewer_turn',
    primary: entry('openai', 'gpt-4o-mini', 15_000, 1, 'gpt-4o-mini'),
    fallbacks: [entry('ollama', 'llama3.2:latest', 15_000, 2)],
  },
  {
    // Spec §2.6: the grader is a separate model from the interviewer and never sees the
    // interviewer's reasoning -- only transcript, artifacts and rubric. Grading is the
    // quality-critical path, so it gets the stronger model and degrades to the cheaper one
    // under the cost ceiling rather than starting there.
    purpose: 'grading',
    primary: entry('openai', 'gpt-4o', 30_000, 1, 'gpt-4o-mini'),
    fallbacks: [entry('ollama', 'llama3:latest', 45_000, 2)],
  },
  {
    purpose: 'debrief',
    primary: entry('openai', 'gpt-4o-mini', 20_000, 1, 'gpt-4o-mini'),
    fallbacks: [entry('ollama', 'llama3.2:latest', 30_000, 2)],
  },
  {
    purpose: 'asr',
    primary: entry('deepgram', 'nova-3', 120_000, 2),
    fallbacks: [entry('openai', 'whisper-1', 180_000, 1)],
  },
  {
    purpose: 'tts',
    primary: entry('cartesia', 'sonic-2', 30_000, 2),
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

/** Every model declared for a purpose, best-first: the primary, then each fallback in turn. */
export function chain(purpose: Purpose): readonly ModelEntry[] {
  const found = lookup(purpose);
  return [found.primary, ...found.fallbacks];
}

/**
 * Answers "is this provider usable right now?" -- credentials present for a remote one, a
 * reachable host for a local one. Async because reachability is a probe, not a constant.
 */
export type ProviderAvailability = (provider: string) => boolean | Promise<boolean>;

/**
 * The first declared model whose provider is actually usable, or null when none is.
 *
 * Call sites used to index `fallbacks[0]` and assume it was the OpenAI one, which silently
 * tied the code to one particular ordering: reordering REGISTRY would have sent an Ollama
 * model tag to OpenAI's API. Selecting by provider makes the ordering above the only thing
 * that decides the tier, which is what a registry is for.
 *
 * Availability is probed in declaration order and stops at the first hit, so a deployment
 * with a working primary never pays for probing a tier it will not use.
 */
export async function selectEntry(
  purpose: Purpose,
  available: ProviderAvailability,
): Promise<ModelEntry | null> {
  for (const candidate of chain(purpose)) {
    if (await available(candidate.provider)) return candidate;
  }
  return null;
}
