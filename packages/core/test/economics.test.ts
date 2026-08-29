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

describe('rates file ships unpriced (guardrail 8)', () => {
  it('has no invented prices committed', () => {
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
      expect(paths).toContain('asrPerMinute');
      expect(paths).toContain('llm.grading.outputPerMillionTokens');
      expect(paths).toContain('egressPerGigabyte');
      expect(paths).toHaveLength(9);
    }
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
