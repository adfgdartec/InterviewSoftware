import { describe, expect, it } from 'vitest';
import {
  RATES,
  UnpricedDriverError,
  estimateSessionCost,
  grossMargin,
  paymentFee,
  ratesAreComplete,
  type RatesShape,
  type SessionCostConfig,
} from '../src/economics.js';

/** A fully-priced rates table used only by tests. Never a source of shipped prices. */
const FILLED: RatesShape = {
  asOf: '2026-08-28',
  currency: 'USD',
  asrPerMinute: 0.006,
  ttsPerThousandCharacters: 0.015,
  llm: {
    questionGeneration: { inputPerMillionTokens: 3, outputPerMillionTokens: 15 },
    grading: { inputPerMillionTokens: 3, outputPerMillionTokens: 15 },
  },
  codeExecutionPerCpuSecond: 0.0001,
  storagePerGigabyteMonth: 0.021,
  egressPerGigabyte: 0.09,
  payment: { percentOfTransaction: 0.029, fixedPerTransaction: 0.3 },
};

const CONFIG: SessionCostConfig = {
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
 * Guardrail 8. The rule this enforces is "no price the cost model invented", not "no price at
 * all": the rates that could be read from a vendor's own pricing page are committed, with the
 * page and the plan tier recorded in rates-sources.md and the date in `asOf`.
 *
 * The two that remain null are the two no vendor page states in the units the model needs --
 * Cartesia publishes credits and minutes rather than USD per character, and no compute host
 * has been chosen to price a CPU-second against. They stay null precisely because guessing
 * them is the failure this guardrail exists to catch.
 */
const UNPRICEABLE_WITHOUT_A_VENDOR_NUMBER = [
  'ttsPerThousandCharacters',
  'codeExecutionPerCpuSecond',
];

describe('rates file carries only prices read from a vendor (guardrail 8)', () => {
  it('is still incomplete, so the margin gate cannot pass on a partial table', () => {
    expect(ratesAreComplete(RATES)).toBe(false);
  });

  it('throws naming every unset rate path rather than silently costing zero', () => {
    expect(() => estimateSessionCost(CONFIG, RATES)).toThrow(UnpricedDriverError);
    try {
      estimateSessionCost(CONFIG, RATES);
      expect.unreachable('estimateSessionCost should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(UnpricedDriverError);
      const paths = (error as UnpricedDriverError).paths;
      expect([...paths].sort()).toEqual([...UNPRICEABLE_WITHOUT_A_VENDOR_NUMBER].sort());
    }
  });

  it('records the date every committed price was read on', () => {
    // A price with no date is a price nobody can re-check. The vendor pages move.
    expect(RATES.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('carries every committed price as a positive number, never zero or a string', () => {
    const committed: [string, unknown][] = [
      ['asrPerMinute', RATES.asrPerMinute],
      ['llm.questionGeneration.inputPerMillionTokens', RATES.llm.questionGeneration.inputPerMillionTokens],
      ['llm.questionGeneration.outputPerMillionTokens', RATES.llm.questionGeneration.outputPerMillionTokens],
      ['llm.grading.inputPerMillionTokens', RATES.llm.grading.inputPerMillionTokens],
      ['llm.grading.outputPerMillionTokens', RATES.llm.grading.outputPerMillionTokens],
      ['storagePerGigabyteMonth', RATES.storagePerGigabyteMonth],
      ['egressPerGigabyte', RATES.egressPerGigabyte],
      ['payment.percentOfTransaction', RATES.payment.percentOfTransaction],
      ['payment.fixedPerTransaction', RATES.payment.fixedPerTransaction],
    ];
    for (const [path, value] of committed) {
      expect(typeof value, path).toBe('number');
      expect(value as number, path).toBeGreaterThan(0);
    }
  });

  it('prices grading above question generation, matching the registry it costs', () => {
    // registry.ts puts grading on the stronger model and generation on the cheaper one. A
    // rates table where grading is the cheaper line is a table filled against the wrong tier.
    expect(RATES.llm.grading.inputPerMillionTokens!).toBeGreaterThan(
      RATES.llm.questionGeneration.inputPerMillionTokens!,
    );
    expect(RATES.llm.grading.outputPerMillionTokens!).toBeGreaterThan(
      RATES.llm.questionGeneration.outputPerMillionTokens!,
    );
  });

  it('keeps the payment percentage a fraction, not a whole-number percent', () => {
    // 2.9 instead of 0.029 would overstate the fee by 100x and still look plausible.
    expect(RATES.payment.percentOfTransaction!).toBeLessThan(1);
  });
});

describe('estimateSessionCost', () => {
  it('prices every driver in spec §4', () => {
    const cost = estimateSessionCost(CONFIG, FILLED);
    expect(cost.asr).toBeCloseTo(0.27, 6);
    expect(cost.tts).toBeCloseTo(0.3, 6);
    expect(cost.questionGeneration).toBeCloseTo(0.21, 6);
    // n=3 self-consistency: (0.06*3 + 0.008*15) * 3
    expect(cost.grading).toBeCloseTo(0.9, 6);
    expect(cost.codeExecution).toBeCloseTo(0.012, 6);
    expect(cost.storage).toBeCloseTo(0.1008, 6);
    expect(cost.egress).toBeCloseTo(0.036, 6);
    expect(cost.total).toBeCloseTo(1.8288, 6);
  });

  it('scales grading linearly with the self-consistency sample count', () => {
    const one = estimateSessionCost({ ...CONFIG, gradingSamples: 1 }, FILLED);
    const three = estimateSessionCost(CONFIG, FILLED);
    expect(three.grading).toBeCloseTo(one.grading * 3, 9);
  });

  it('returns an all-zero breakdown for an empty session', () => {
    const empty: SessionCostConfig = {
      asrMinutes: 0,
      ttsCharacters: 0,
      questionGenInputTokens: 0,
      questionGenOutputTokens: 0,
      gradingInputTokens: 0,
      gradingOutputTokens: 0,
      gradingSamples: 1,
      codeExecutionCpuSeconds: 0,
      storedGigabytes: 0,
      retentionMonths: 0,
      egressGigabytes: 0,
    };
    expect(estimateSessionCost(empty, FILLED).total).toBe(0);
  });

  it.each([
    ['negative minutes', { asrMinutes: -1 }],
    ['NaN tokens', { gradingInputTokens: Number.NaN }],
    ['infinite storage', { storedGigabytes: Number.POSITIVE_INFINITY }],
    ['zero grading samples', { gradingSamples: 0 }],
  ])('rejects %s', (_label, patch) => {
    expect(() => estimateSessionCost({ ...CONFIG, ...patch }, FILLED)).toThrow(RangeError);
  });
});

describe('margin gate', () => {
  it('computes gross margin from a plan row', () => {
    const perSession = estimateSessionCost(CONFIG, FILLED).total;
    // $49.00 plan, 8 included sessions.
    const margin = grossMargin(4_900, 8, perSession, FILLED);
    expect(margin).toBeCloseTo((49 - (8 * perSession + paymentFee(49, FILLED))) / 49, 9);
    expect(margin).toBeGreaterThan(0.6);
  });

  it('goes negative when included volume outruns the price', () => {
    const perSession = estimateSessionCost(CONFIG, FILLED).total;
    expect(grossMargin(500, 100, perSession, FILLED)).toBeLessThan(0);
  });

  it.each([
    ['zero price', 0, 8],
    ['negative price', -100, 8],
    ['zero sessions', 4_900, 0],
  ])('rejects %s', (_label, price, sessions) => {
    expect(() => grossMargin(price, sessions, 1, FILLED)).toThrow(RangeError);
  });
});
