import {
  UnpricedDriverError,
  estimateSessionCost,
  grossMargin,
  ratesAreComplete,
  type RatesShape,
  type SessionCostConfig,
} from '@loopcraft/core';

/**
 * The gross-margin gate. Spec §4: "Add a CI check that every plan's included volume ×
 * modeled cost stays under a configured gross-margin floor."
 *
 * Plan rows come from the database (guardrail 8), never from a constant here. When the rates
 * file is still unpriced the gate returns `rates_unset` and CI fails on it: a margin gate
 * that reports green while every driver costs zero is worse than no gate, because it
 * certifies a number nobody computed.
 */

export const DEFAULT_MARGIN_FLOOR = 0.7;

export interface PlanForMargin {
  readonly id: string;
  readonly name: string;
  readonly priceCents: number;
  readonly includedSessions: number;
  readonly billingPeriod: string;
}

export type MarginVerdict = 'pass' | 'breach' | 'rates_unset';

export interface PlanMargin {
  readonly planId: string;
  readonly margin: number;
  readonly perSessionCost: number;
  readonly meetsFloor: boolean;
}

export interface MarginReport {
  readonly verdict: MarginVerdict;
  readonly floor: number;
  readonly plans: readonly PlanMargin[];
  readonly breaches: readonly string[];
  readonly message: string;
}

/** A representative session, used to price a plan's included volume. */
export const REFERENCE_SESSION: SessionCostConfig = {
  asrMinutes: 45,
  ttsCharacters: 20_000,
  questionGenInputTokens: 40_000,
  questionGenOutputTokens: 6_000,
  gradingInputTokens: 60_000,
  gradingOutputTokens: 8_000,
  gradingSamples: 3,
  codeExecutionCpuSeconds: 120,
  storedGigabytes: 0.4,
  retentionMonths: 12,
  egressGigabytes: 0.4,
};

/**
 * Evaluates every paid plan. Free plans are skipped: a zero-price plan has no margin to
 * compute, and dividing by its revenue would produce a meaningless number rather than a
 * finding.
 */
export function evaluateMargins(
  plans: readonly PlanForMargin[],
  rates: RatesShape,
  floor: number = DEFAULT_MARGIN_FLOOR,
  session: SessionCostConfig = REFERENCE_SESSION,
): MarginReport {
  if (floor <= 0 || floor >= 1) {
    throw new RangeError(`Margin floor must be in (0,1), got ${floor}`);
  }

  if (!ratesAreComplete(rates)) {
    let missing: readonly string[] = [];
    try {
      estimateSessionCost(session, rates);
    } catch (error) {
      if (error instanceof UnpricedDriverError) missing = error.paths;
      else throw error;
    }
    return {
      verdict: 'rates_unset',
      floor,
      plans: [],
      breaches: [],
      message:
        `Cannot evaluate margins: ${missing.length} vendor rate(s) are still null in ` +
        `packages/core/src/rates.json (${missing.join(', ')}). Fill them in from current ` +
        'vendor pricing. This gate fails rather than passing on unpriced drivers.',
    };
  }

  const perSessionCost = estimateSessionCost(session, rates).total;
  const paid = plans.filter((p) => p.priceCents > 0);

  const evaluated: PlanMargin[] = paid.map((plan) => {
    const margin = grossMargin(plan.priceCents, Math.max(1, plan.includedSessions), perSessionCost, rates);
    return { planId: plan.id, margin, perSessionCost, meetsFloor: margin >= floor };
  });

  const breaches = evaluated
    .filter((p) => !p.meetsFloor)
    .map((p) => `${p.planId}: margin ${(p.margin * 100).toFixed(1)}% below floor ${(floor * 100).toFixed(0)}%`);

  return {
    verdict: breaches.length === 0 ? 'pass' : 'breach',
    floor,
    plans: evaluated,
    breaches,
    message:
      breaches.length === 0
        ? `All ${evaluated.length} paid plan(s) meet the ${(floor * 100).toFixed(0)}% gross-margin floor.`
        : `${breaches.length} plan(s) below the floor: ${breaches.join('; ')}`,
  };
}

export class MarginGateError extends Error {
  constructor(public readonly report: MarginReport) {
    super(report.message);
    this.name = 'MarginGateError';
  }
}

/** What CI calls. Throws on both a breach and unpriced rates. */
export function assertMarginsAcceptable(
  plans: readonly PlanForMargin[],
  rates: RatesShape,
  floor: number = DEFAULT_MARGIN_FLOOR,
): void {
  const report = evaluateMargins(plans, rates, floor);
  if (report.verdict !== 'pass') throw new MarginGateError(report);
}
