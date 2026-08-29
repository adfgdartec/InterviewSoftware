import { describe, expect, it } from 'vitest';
import { scoreCorrectness, type SubmissionResult, type CaseResult } from '../src/test-cases.js';

function result(cases: Partial<CaseResult>[]): SubmissionResult {
  const full: CaseResult[] = cases.map((c, i) => ({
    id: `c${i}`, visible: false, boundary: false, outcome: 'passed',
    durationMs: 10, expected: null, actual: null, ...c,
  }));
  const passed = full.filter((c) => c.outcome === 'passed').length;
  const boundary = full.filter((c) => c.boundary);
  return {
    cases: full, passed, total: full.length,
    boundaryPassed: boundary.filter((c) => c.outcome === 'passed').length,
    boundaryTotal: boundary.length,
    allPassed: passed === full.length,
  };
}

describe('correctness maps onto the published anchors, not a raw pass rate', () => {
  it('scores 1 when nothing passes', () => {
    expect(scoreCorrectness(result([{ outcome: 'crashed' }, { outcome: 'wrong_output' }]))).toBe(1);
  });

  it('scores 2 when the happy path is incomplete', () => {
    expect(scoreCorrectness(result([{}, { outcome: 'wrong_output' }]))).toBe(2);
  });

  it('scores 2 when the happy path passes but every boundary fails', () => {
    expect(scoreCorrectness(result([{}, { boundary: true, outcome: 'wrong_output' }]))).toBe(2);
  });

  it('scores 3 when some but not all boundaries pass', () => {
    const r = result([{}, { boundary: true }, { boundary: true, outcome: 'wrong_output' }]);
    expect(scoreCorrectness(r)).toBe(3);
  });

  it('scores 4 when every case including boundaries passes', () => {
    expect(scoreCorrectness(result([{}, { boundary: true }]))).toBe(4);
  });

  it('caps at 3 when there are no boundary cases to demonstrate deliberateness', () => {
    // Level 4 requires boundaries handled deliberately; with none authored, the evidence
    // for that simply does not exist, so the score cannot claim it.
    expect(scoreCorrectness(result([{}, {}]))).toBe(3);
  });

  it('treats a timeout and an OOM as failures, not as passes', () => {
    expect(scoreCorrectness(result([{ outcome: 'timeout' }]))).toBe(1);
    expect(scoreCorrectness(result([{ outcome: 'out_of_memory' }]))).toBe(1);
  });

  it('never returns a level outside 1-5', () => {
    for (const r of [
      result([{ outcome: 'crashed' }]),
      result([{}]),
      result([{ boundary: true }]),
      result([{}, { boundary: true }, { boundary: true }]),
    ]) {
      const level = scoreCorrectness(r);
      expect(level).toBeGreaterThanOrEqual(1);
      expect(level).toBeLessThanOrEqual(5);
    }
  });
});
