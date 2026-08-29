import { lookup, type ModelEntry, type Purpose } from './registry.js';

/**
 * Spec §3.4: "A per-session cost ceiling degrades gracefully (drop to a cheaper grader,
 * shorten context) rather than failing." Degradation is deterministic and reported, so the
 * debrief can state which rounds were graded on the degraded path.
 */

export type Posture = 'normal' | 'degraded' | 'exhausted';

export interface CeilingDecision {
  readonly posture: Posture;
  readonly model: string;
  readonly provider: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  /** Fraction of the context budget the caller should use, 1 at normal posture. */
  readonly contextScale: number;
  readonly reason: string;
}

export const DEGRADE_AT = 0.8;
export const EXHAUST_AT = 1.0;

/**
 * Decides how to make the next call given spend so far. `spentMicros` and `ceilingMicros`
 * are both server-side values; a client-supplied figure is never accepted (guardrail 5).
 */
export function decide(
  purpose: Purpose,
  spentMicros: number,
  ceilingMicros: number,
): CeilingDecision {
  if (spentMicros < 0 || ceilingMicros <= 0) {
    throw new RangeError('spentMicros must be >= 0 and ceilingMicros > 0');
  }
  const entryFor = lookup(purpose);
  const primary: ModelEntry = entryFor.primary;
  const used = spentMicros / ceilingMicros;

  if (used < DEGRADE_AT) {
    return {
      posture: 'normal',
      model: primary.model,
      provider: primary.provider,
      timeoutMs: primary.timeoutMs,
      maxRetries: primary.maxRetries,
      contextScale: 1,
      reason: 'within budget',
    };
  }

  if (used < EXHAUST_AT) {
    const cheaper = primary.degradeTo ?? entryFor.fallbacks[0]?.model ?? primary.model;
    return {
      posture: 'degraded',
      model: cheaper,
      provider: primary.provider,
      timeoutMs: primary.timeoutMs,
      maxRetries: Math.max(1, primary.maxRetries - 1),
      contextScale: 0.5,
      reason: `${Math.round(used * 100)}% of session cost ceiling used; using cheaper model and half context`,
    };
  }

  return {
    posture: 'exhausted',
    model: primary.degradeTo ?? primary.model,
    provider: primary.provider,
    timeoutMs: primary.timeoutMs,
    maxRetries: 0,
    contextScale: 0.25,
    reason: 'session cost ceiling reached; no retries and minimum context',
  };
}
