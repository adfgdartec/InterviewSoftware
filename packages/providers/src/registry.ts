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

export const REGISTRY: readonly RegistryEntry[] = [
  {
    purpose: 'question_generation',
    primary: entry('anthropic', 'claude-sonnet-5', 30_000, 2, 'claude-haiku-4-5-20251001'),
    fallbacks: [entry('anthropic', 'claude-haiku-4-5-20251001', 20_000, 1)],
  },
  {
    purpose: 'interviewer_turn',
    primary: entry('anthropic', 'claude-sonnet-5', 25_000, 2, 'claude-haiku-4-5-20251001'),
    fallbacks: [entry('anthropic', 'claude-haiku-4-5-20251001', 15_000, 1)],
  },
  {
    // Spec §2.6: the grader is a separate model from the interviewer and never sees the
    // interviewer's reasoning -- only transcript, artifacts and rubric.
    purpose: 'grading',
    primary: entry('anthropic', 'claude-opus-5', 60_000, 2, 'claude-sonnet-5'),
    fallbacks: [entry('anthropic', 'claude-sonnet-5', 40_000, 1)],
  },
  {
    purpose: 'debrief',
    primary: entry('anthropic', 'claude-sonnet-5', 45_000, 2, 'claude-haiku-4-5-20251001'),
    fallbacks: [entry('anthropic', 'claude-haiku-4-5-20251001', 25_000, 1)],
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
