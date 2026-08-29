import rates from './rates.json' with { type: 'json' };

/**
 * Unit-economics model (spec §4). Prices are never hard-coded and never guessed: every rate
 * lives in `rates.json` as `null` until an engineer fills it in from current vendor pricing.
 * A missing rate throws with the dotted path of the offending entry, so an unpriced driver
 * fails loudly at the call site instead of quietly contributing zero.
 */

export interface RatesShape {
  readonly asOf: string | null;
  readonly currency: string;
  readonly asrPerMinute: number | null;
  readonly ttsPerThousandCharacters: number | null;
  readonly llm: {
    readonly questionGeneration: TokenRate;
    readonly grading: TokenRate;
  };
  readonly codeExecutionPerCpuSecond: number | null;
  readonly storagePerGigabyteMonth: number | null;
  readonly egressPerGigabyte: number | null;
  readonly payment: {
    readonly percentOfTransaction: number | null;
    readonly fixedPerTransaction: number | null;
  };
}

interface TokenRate {
  readonly inputPerMillionTokens: number | null;
  readonly outputPerMillionTokens: number | null;
}

export const RATES: RatesShape = rates as unknown as RatesShape;

export class UnpricedDriverError extends Error {
  constructor(public readonly paths: readonly string[]) {
    super(
      `Cost model cannot run: ${paths.length} rate(s) unset in packages/core/src/rates.json ` +
        `(${paths.join(', ')}). Fill them in from current vendor pricing.`,
    );
    this.name = 'UnpricedDriverError';
  }
}

/** Session shape being priced. All quantities are per single loop attempt. */
export interface SessionCostConfig {
  readonly asrMinutes: number;
  readonly ttsCharacters: number;
  readonly questionGenInputTokens: number;
  readonly questionGenOutputTokens: number;
  readonly gradingInputTokens: number;
  readonly gradingOutputTokens: number;
  /** Spec §2.6 grades with n=3 independent samples; grading tokens are multiplied by this. */
  readonly gradingSamples: number;
  readonly codeExecutionCpuSeconds: number;
  readonly storedGigabytes: number;
  readonly retentionMonths: number;
  readonly egressGigabytes: number;
}

export interface CostBreakdown {
  readonly asr: number;
  readonly tts: number;
  readonly questionGeneration: number;
  readonly grading: number;
  readonly codeExecution: number;
  readonly storage: number;
  readonly egress: number;
  readonly total: number;
}

function required(value: number | null, path: string, missing: string[]): number {
  if (value === null || Number.isNaN(value)) {
    missing.push(path);
    return 0;
  }
  return value;
}

function assertNonNegative(config: SessionCostConfig): void {
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new RangeError(`SessionCostConfig.${key} must be a finite number >= 0, got ${value}`);
    }
  }
  if (config.gradingSamples < 1) {
    throw new RangeError('SessionCostConfig.gradingSamples must be >= 1');
  }
}

/**
 * Marginal provider cost of one session, excluding payment fees (which are per transaction,
 * not per session — see {@link paymentFee}).
 */
export function estimateSessionCost(
  config: SessionCostConfig,
  ratesOverride: RatesShape = RATES,
): CostBreakdown {
  assertNonNegative(config);
  const missing: string[] = [];
  const r = ratesOverride;

  const asr = config.asrMinutes * required(r.asrPerMinute, 'asrPerMinute', missing);
  const tts =
    (config.ttsCharacters / 1_000) *
    required(r.ttsPerThousandCharacters, 'ttsPerThousandCharacters', missing);

  const qgIn = required(
    r.llm.questionGeneration.inputPerMillionTokens,
    'llm.questionGeneration.inputPerMillionTokens',
    missing,
  );
  const qgOut = required(
    r.llm.questionGeneration.outputPerMillionTokens,
    'llm.questionGeneration.outputPerMillionTokens',
    missing,
  );
  const questionGeneration =
    (config.questionGenInputTokens / 1_000_000) * qgIn +
    (config.questionGenOutputTokens / 1_000_000) * qgOut;

  const gIn = required(
    r.llm.grading.inputPerMillionTokens,
    'llm.grading.inputPerMillionTokens',
    missing,
  );
  const gOut = required(
    r.llm.grading.outputPerMillionTokens,
    'llm.grading.outputPerMillionTokens',
    missing,
  );
  const grading =
    config.gradingSamples *
    ((config.gradingInputTokens / 1_000_000) * gIn +
      (config.gradingOutputTokens / 1_000_000) * gOut);

  const codeExecution =
    config.codeExecutionCpuSeconds *
    required(r.codeExecutionPerCpuSecond, 'codeExecutionPerCpuSecond', missing);
  const storage =
    config.storedGigabytes *
    config.retentionMonths *
    required(r.storagePerGigabyteMonth, 'storagePerGigabyteMonth', missing);
  const egress =
    config.egressGigabytes * required(r.egressPerGigabyte, 'egressPerGigabyte', missing);

  if (missing.length > 0) throw new UnpricedDriverError(missing);

  const total = asr + tts + questionGeneration + grading + codeExecution + storage + egress;
  return { asr, tts, questionGeneration, grading, codeExecution, storage, egress, total };
}

/** Payment-processor fee on one transaction of `amount`. */
export function paymentFee(amount: number, ratesOverride: RatesShape = RATES): number {
  const missing: string[] = [];
  const pct = required(
    ratesOverride.payment.percentOfTransaction,
    'payment.percentOfTransaction',
    missing,
  );
  const fixed = required(
    ratesOverride.payment.fixedPerTransaction,
    'payment.fixedPerTransaction',
    missing,
  );
  if (missing.length > 0) throw new UnpricedDriverError(missing);
  return amount * pct + fixed;
}

/**
 * Gross margin on a plan. `planPriceCents` and `includedSessions` come from the `plans`
 * table (guardrail 8: read plan rows from the database, never a constant in code).
 */
export function grossMargin(
  planPriceCents: number,
  includedSessions: number,
  perSessionCost: number,
  ratesOverride: RatesShape = RATES,
): number {
  if (planPriceCents <= 0) throw new RangeError('planPriceCents must be > 0');
  if (includedSessions <= 0) throw new RangeError('includedSessions must be > 0');
  const revenue = planPriceCents / 100;
  const cost = includedSessions * perSessionCost + paymentFee(revenue, ratesOverride);
  return (revenue - cost) / revenue;
}

/** True when no rate is still null, i.e. the CI margin gate can run for real. */
export function ratesAreComplete(ratesOverride: RatesShape = RATES): boolean {
  try {
    estimateSessionCost(
      {
        asrMinutes: 1,
        ttsCharacters: 1,
        questionGenInputTokens: 1,
        questionGenOutputTokens: 1,
        gradingInputTokens: 1,
        gradingOutputTokens: 1,
        gradingSamples: 1,
        codeExecutionCpuSeconds: 1,
        storedGigabytes: 1,
        retentionMonths: 1,
        egressGigabytes: 1,
      },
      ratesOverride,
    );
    paymentFee(1, ratesOverride);
    return true;
  } catch (error) {
    if (error instanceof UnpricedDriverError) return false;
    throw error;
  }
}
