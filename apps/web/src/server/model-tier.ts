import {
  ollamaReachable,
  openaiConfigured,
  selectEntry,
  type ModelEntry,
  type ProviderAvailability,
  type Purpose,
} from '@loopcraft/providers';

/**
 * Which reasoning tier actually serves a request.
 *
 * Three call sites -- the grader, the question generator and the interviewer -- each decided
 * this for themselves, and each decided it slightly differently. The grader and the question
 * generator probed Ollama and then indexed `fallbacks[0]` for the remote model, which only
 * worked while the registry happened to list Ollama first and OpenAI second. The interviewer
 * did not have a remote branch at all: it probed Ollama and, finding it unreachable, returned
 * "accept" -- so on Workers, where localhost is never reachable, the back-and-forth interview
 * did not happen and no error was ever raised to say so.
 *
 * Resolving through the registry's declared order removes the assumption from all three.
 */

export interface ProviderProbes {
  /** Overridden in tests; the defaults probe the real providers. */
  readonly openaiAvailable?: () => boolean | Promise<boolean>;
  readonly ollamaAvailable?: () => boolean | Promise<boolean>;
}

/**
 * An availability predicate that probes each provider at most once.
 *
 * Create one per operation rather than per process: a local model can come and go while the
 * process lives, so a probe result must not outlive the request that asked for it -- but
 * three grading samples in the same round should not pay for three identical probes either.
 */
export function reasoningAvailability(probes: ProviderProbes = {}): ProviderAvailability {
  const openai = probes.openaiAvailable ?? openaiConfigured;
  const ollama = probes.ollamaAvailable ?? ollamaReachable;
  const settled = new Map<string, Promise<boolean>>();

  return (provider: string): Promise<boolean> => {
    let probe = settled.get(provider);
    if (probe === undefined) {
      probe =
        provider === 'openai'
          ? Promise.resolve(openai())
          : provider === 'ollama'
            ? Promise.resolve(ollama())
            : Promise.resolve(false);
      settled.set(provider, probe);
    }
    return probe;
  };
}

/**
 * The model that will serve `purpose` right now, or null when no declared provider is usable.
 *
 * Null is a real answer, not an error: every caller already has an honest degraded path for
 * it (503 `grader_unavailable`, the static catalogue question, accepting the round), and all
 * of those are better than inventing a result.
 */
export function resolveModel(
  purpose: Purpose,
  probes: ProviderProbes = {},
): Promise<ModelEntry | null> {
  return selectEntry(purpose, reasoningAvailability(probes));
}
