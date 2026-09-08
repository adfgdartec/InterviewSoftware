import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  computeDeliveryMetrics,
  percentile,
  type DeliveryMetrics,
  type DeliveryMetricsInput,
} from '../src/index.js';

/**
 * Ported from apps/worker/tests/test_app.py, plus the parity fixture below.
 *
 * The fixture is the load-bearing one. Every case in it was run through BOTH the Python
 * worker's `_compute_delivery_metrics` and this implementation, and the expected values are
 * the Python worker's actual output -- so the port is pinned to the behaviour it replaced
 * rather than to what a reader assumed that behaviour was. It keeps holding once the Python
 * process is gone, which a live comparison could not.
 */

interface ParityCase {
  readonly name: string;
  readonly input: DeliveryMetricsInput;
  readonly expected: DeliveryMetrics;
}

const PARITY: readonly ParityCase[] = JSON.parse(
  readFileSync(fileURLToPath(new URL('./python-parity.json', import.meta.url)), 'utf8'),
) as ParityCase[];

describe('parity with the FastAPI worker it replaced', () => {
  it('covers the edge cases that actually differ between the two languages', () => {
    // Guards the fixture itself: a truncated or regenerated file that lost its interesting
    // cases would otherwise make every assertion below pass vacuously.
    expect(PARITY.length).toBeGreaterThanOrEqual(17);
    const names = PARITY.map((c) => c.name);
    for (const required of ['empty', 'single word', 'zero length word', 'unordered input']) {
      expect(names).toContain(required);
    }
  });

  for (const { name, input, expected } of PARITY) {
    it(`matches the Python worker: ${name}`, () => {
      const actual = computeDeliveryMetrics(input);
      for (const [field, value] of Object.entries(expected)) {
        expect(actual[field as keyof DeliveryMetrics]).toBeCloseTo(value, 9);
      }
    });
  }
});

const ZERO: DeliveryMetrics = {
  wordsPerMinute: 0,
  fillerRatio: 0,
  pauseLengthP50Ms: 0,
  pauseLengthP95Ms: 0,
  longestMonologueSeconds: 0,
  responseLatencyMs: 0,
  hedgingDensity: 0,
  quantificationDensity: 0,
  starSegmentCoverage: 0,
};

describe('computeDeliveryMetrics', () => {
  it('returns every metric at zero for an empty transcript and no words', () => {
    expect(computeDeliveryMetrics({ transcript: '', words: [], promptEndMs: 0 })).toEqual(ZERO);
  });

  it('measures a substantive answer on every axis it should', () => {
    const m = computeDeliveryMetrics({
      transcript:
        'In that situation I was responsible for the launch. ' +
        'So I built a new pipeline and reduced errors by 40%. ' +
        'I think that was the best outcome we achieved as a result.',
      words: [
        { word: 'in', startMs: 0, endMs: 100 },
        { word: 'that', startMs: 100, endMs: 300 },
        { word: 'situation', startMs: 300, endMs: 600 },
        { word: 'um', startMs: 600, endMs: 800 },
        { word: 'i', startMs: 2_800, endMs: 2_900 },
        { word: 'was', startMs: 2_900, endMs: 3_100 },
      ],
      promptEndMs: 0,
    });

    expect(m.wordsPerMinute).toBeGreaterThan(0);
    expect(m.pauseLengthP95Ms).toBeGreaterThanOrEqual(m.pauseLengthP50Ms);
    expect(m.pauseLengthP50Ms).toBeGreaterThanOrEqual(0);
    expect(m.quantificationDensity).toBeGreaterThan(0); // "40%"
    expect(m.hedgingDensity).toBeGreaterThan(0); // "I think"
    expect(m.starSegmentCoverage).toBe(1); // all four components present
  });

  it('treats a single word as a monologue of its own duration and no pauses', () => {
    const m = computeDeliveryMetrics({
      transcript: 'hello',
      words: [{ word: 'hello', startMs: 100, endMs: 500 }],
      promptEndMs: 50,
    });
    expect(m.longestMonologueSeconds).toBeCloseTo(0.4, 10);
    expect(m.responseLatencyMs).toBe(50);
    expect(m.pauseLengthP50Ms).toBe(0);
    expect(m.pauseLengthP95Ms).toBe(0);
  });

  it('does not divide by zero on a zero-length word timing', () => {
    const m = computeDeliveryMetrics({
      transcript: 'hi',
      words: [{ word: 'hi', startMs: 1_000, endMs: 1_000 }],
      promptEndMs: 1_000,
    });
    expect(m.longestMonologueSeconds).toBe(0);
    expect(m.responseLatencyMs).toBe(0);
    expect(Number.isFinite(m.wordsPerMinute)).toBe(true);
  });

  it('never reports a negative latency when speech began before the prompt ended', () => {
    const m = computeDeliveryMetrics({
      transcript: 'early',
      words: [
        { word: 'early', startMs: 100, endMs: 200 },
        { word: 'start', startMs: 300, endMs: 400 },
      ],
      promptEndMs: 5_000,
    });
    expect(m.responseLatencyMs).toBe(0);
  });

  it('sorts words by start time, so an out-of-order array measures the same', () => {
    const ordered = computeDeliveryMetrics({
      transcript: 'a b c',
      words: [
        { word: 'a', startMs: 0, endMs: 100 },
        { word: 'b', startMs: 400, endMs: 500 },
        { word: 'c', startMs: 900, endMs: 1_000 },
      ],
      promptEndMs: 50,
    });
    const shuffled = computeDeliveryMetrics({
      transcript: 'a b c',
      words: [
        { word: 'c', startMs: 900, endMs: 1_000 },
        { word: 'a', startMs: 0, endMs: 100 },
        { word: 'b', startMs: 400, endMs: 500 },
      ],
      promptEndMs: 50,
    });
    expect(shuffled).toEqual(ordered);
  });

  it('breaks a monologue on a gap longer than two seconds, and not on a shorter one', () => {
    const unbroken = computeDeliveryMetrics({
      transcript: 'a b',
      words: [
        { word: 'a', startMs: 0, endMs: 100 },
        { word: 'b', startMs: 2_000, endMs: 2_100 },
      ],
      promptEndMs: 0,
    });
    const broken = computeDeliveryMetrics({
      transcript: 'a b',
      words: [
        { word: 'a', startMs: 0, endMs: 100 },
        { word: 'b', startMs: 2_500, endMs: 2_600 },
      ],
      promptEndMs: 0,
    });
    expect(unbroken.longestMonologueSeconds).toBeCloseTo(2.1, 10);
    expect(broken.longestMonologueSeconds).toBeCloseTo(0.1, 10);
  });

  it('caps the filler ratio at 1 even when every token is a filler', () => {
    const m = computeDeliveryMetrics({
      transcript: 'um uh like basically',
      words: [],
      promptEndMs: 0,
    });
    expect(m.fillerRatio).toBeLessThanOrEqual(1);
    expect(m.fillerRatio).toBe(1);
  });

  it('counts fillers case-insensitively', () => {
    const upper = computeDeliveryMetrics({ transcript: 'UM LIKE', words: [], promptEndMs: 0 });
    const lower = computeDeliveryMetrics({ transcript: 'um like', words: [], promptEndMs: 0 });
    expect(upper.fillerRatio).toBe(lower.fillerRatio);
    expect(upper.fillerRatio).toBe(1);
  });

  it('reports no STAR coverage for a transcript with none of the keywords', () => {
    const m = computeDeliveryMetrics({
      transcript: 'Nothing relevant here at all whatsoever.',
      words: [],
      promptEndMs: 0,
    });
    expect(m.starSegmentCoverage).toBe(0);
  });

  it('treats a whitespace-only transcript as empty rather than as content', () => {
    const m = computeDeliveryMetrics({ transcript: '     ', words: [], promptEndMs: 0 });
    expect(m.starSegmentCoverage).toBe(0);
    expect(m.fillerRatio).toBe(0);
  });

  it('handles a transcript far longer than a normal interview turn', () => {
    const m = computeDeliveryMetrics({
      transcript: 'we shipped it and reduced latency by 12 percent. '.repeat(900),
      words: Array.from({ length: 500 }, (_, i) => ({
        word: 'word',
        startMs: i * 300,
        endMs: i * 300 + 250,
      })),
      promptEndMs: 0,
    });
    expect(m.wordsPerMinute).toBeGreaterThan(0);
    expect(m.quantificationDensity).toBeGreaterThan(0);
  });

  it('survives every word sharing one timestamp', () => {
    const m = computeDeliveryMetrics({
      transcript: 'a b c',
      words: [
        { word: 'a', startMs: 1_000, endMs: 1_000 },
        { word: 'b', startMs: 1_000, endMs: 1_000 },
        { word: 'c', startMs: 1_000, endMs: 1_000 },
      ],
      promptEndMs: 0,
    });
    expect(m.wordsPerMinute).toBe(0); // zero duration, not Infinity
    expect(Number.isFinite(m.longestMonologueSeconds)).toBe(true);
  });
});

describe('percentile', () => {
  it('is zero for no samples, because no pauses is a real answer', () => {
    expect(percentile([], 50)).toBe(0);
  });

  it('returns the only sample regardless of the percentile asked for', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
  });

  it('interpolates linearly between neighbours, matching numpy', () => {
    expect(percentile([0, 10], 50)).toBeCloseTo(5, 10);
    expect(percentile([0, 10, 20, 30], 50)).toBeCloseTo(15, 10);
    expect(percentile([1, 2, 3, 4], 95)).toBeCloseTo(3.85, 10);
  });

  it('does not mutate the caller array while sorting it', () => {
    const input = [5, 1, 3];
    percentile(input, 50);
    expect(input).toEqual([5, 1, 3]);
  });

  it('returns the endpoints at 0 and 100', () => {
    expect(percentile([4, 1, 9], 0)).toBe(1);
    expect(percentile([4, 1, 9], 100)).toBe(9);
  });
});
