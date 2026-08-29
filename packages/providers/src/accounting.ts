import type { Purpose } from './registry.js';

/**
 * Spec §3.4: every provider call writes a model_runs row with token counts and computed
 * cost. Cost is stored in integer micros so no rounding drift accumulates across a session.
 */

export interface ModelRun {
  readonly orgId: string;
  readonly sessionId: string | null;
  readonly purpose: Purpose;
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly durationMs: number;
  readonly costMicros: number;
  readonly fellBack: boolean;
}

/** Sink the API layer implements with an INSERT; tests and demo mode use an in-memory one. */
export interface ModelRunSink {
  record(run: ModelRun): Promise<void>;
}

export class InMemoryModelRunSink implements ModelRunSink {
  readonly runs: ModelRun[] = [];
  async record(run: ModelRun): Promise<void> {
    this.runs.push(run);
  }
  totalMicros(sessionId: string): number {
    return this.runs
      .filter((r) => r.sessionId === sessionId)
      .reduce((sum, r) => sum + r.costMicros, 0);
  }
}

export interface TokenPricing {
  readonly inputPerMillionTokens: number;
  readonly outputPerMillionTokens: number;
}

/**
 * Converts a token count to integer micros of USD. Rates come from packages/core rates.json
 * via the caller; this function never carries a price of its own (guardrail 8).
 */
export function costMicros(
  inputTokens: number,
  outputTokens: number,
  pricing: TokenPricing,
): number {
  if (inputTokens < 0 || outputTokens < 0) {
    throw new RangeError('Token counts must be >= 0');
  }
  const dollars =
    (inputTokens / 1_000_000) * pricing.inputPerMillionTokens +
    (outputTokens / 1_000_000) * pricing.outputPerMillionTokens;
  return Math.round(dollars * 1_000_000);
}
