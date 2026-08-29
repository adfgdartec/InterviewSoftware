import { describe, expect, it } from 'vitest';
import {
  HIGH_DISAGREEMENT_VARIANCE,
  InvalidSampleError,
  MIN_HALF_WIDTH,
  aggregate,
  formatScore,
  median,
  samplesDisagree,
  variance,
} from '../src/aggregate.js';

describe('median', () => {
  it.each([
    [[3], 3],
    [[1, 5], 3],
    [[4, 2, 3], 3],
    [[5, 1, 4, 2], 3],
    [[2, 2, 2], 2],
  ])('median(%j) = %d', (samples, expected) => {
    expect(median(samples)).toBe(expected);
  });

  it('is order independent', () => {
    expect(median([5, 1, 3])).toBe(median([3, 5, 1]));
  });

  it('rejects an empty sample set rather than returning zero', () => {
    expect(() => median([])).toThrow(InvalidSampleError);
  });
});

describe('variance', () => {
  it('is zero for identical samples', () => {
    expect(variance([3, 3, 3])).toBe(0);
  });

  it('is zero for a single sample, meaning no spread was observed', () => {
    expect(variance([4])).toBe(0);
  });

  it('grows with disagreement', () => {
    expect(variance([2, 3, 4])).toBeGreaterThan(variance([3, 3, 4]));
  });

  it('rejects an empty sample set', () => {
    expect(() => variance([])).toThrow(InvalidSampleError);
  });
});

describe('aggregate never reports false precision (spec §2.6, acceptance 8)', () => {
  it('reports a non-zero interval even when every sample agrees', () => {
    const score = aggregate([3, 3, 3]);
    expect(score.median).toBe(3);
    expect(score.halfWidth).toBe(MIN_HALF_WIDTH);
    expect(score.intervalHigh).toBeGreaterThan(score.intervalLow);
  });

  it('reports a non-zero interval for a single sample', () => {
    expect(aggregate([4]).halfWidth).toBe(MIN_HALF_WIDTH);
  });

  it('widens the interval when samples disagree', () => {
    const tight = aggregate([3, 3, 4]);
    const wide = aggregate([1, 3, 5]);
    expect(wide.halfWidth).toBeGreaterThan(tight.halfWidth);
    expect(wide.sampleVariance).toBeGreaterThan(tight.sampleVariance);
  });

  it('clamps the interval to the 1-5 rubric scale', () => {
    const low = aggregate([1, 1, 5]);
    expect(low.intervalLow).toBeGreaterThanOrEqual(1);
    expect(low.intervalHigh).toBeLessThanOrEqual(5);
    const high = aggregate([5, 5, 1]);
    expect(high.intervalHigh).toBeLessThanOrEqual(5);
  });

  it('always brackets the median', () => {
    for (const samples of [[1, 1, 1], [5, 5, 5], [1, 3, 5], [2, 4], [3]]) {
      const s = aggregate(samples);
      expect(s.intervalLow).toBeLessThanOrEqual(s.median);
      expect(s.median).toBeLessThanOrEqual(s.intervalHigh);
    }
  });

  it.each([
    ['below the scale', [0, 3, 3]],
    ['above the scale', [3, 3, 6]],
    ['not finite', [Number.NaN, 3, 3]],
    ['infinite', [Number.POSITIVE_INFINITY, 3, 3]],
  ])('rejects a sample %s', (_label, samples) => {
    expect(() => aggregate(samples)).toThrow(InvalidSampleError);
  });

  it('rejects an empty sample set', () => {
    expect(() => aggregate([])).toThrow(InvalidSampleError);
  });

  it('does not rescale to 0-100 or apply any penalty', () => {
    // The audited prototype applied a flat 15% penalty twice and thresholded at 70.
    const s = aggregate([4, 4, 4]);
    expect(s.median).toBe(4);
    expect(s.intervalHigh).toBeLessThanOrEqual(5);
  });
});

describe('formatting', () => {
  it('always renders an interval, never a bare number', () => {
    expect(formatScore(aggregate([3, 3, 4]))).toMatch(/^\d\.\d ± \d\.\d$/);
    expect(formatScore(aggregate([3, 3, 3]))).toBe('3.0 ± 0.3');
  });

  it('flags high disagreement as low-information', () => {
    expect(samplesDisagree(aggregate([3, 3, 3]))).toBe(false);
    expect(samplesDisagree(aggregate([1, 3, 5]))).toBe(true);
    expect(HIGH_DISAGREEMENT_VARIANCE).toBeGreaterThan(0);
  });
});
