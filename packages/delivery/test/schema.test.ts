import { describe, expect, it } from 'vitest';
import { deliveryMetricsRequestSchema, wordTimingSchema } from '../src/index.js';

/**
 * Ported from the request-validation half of apps/worker/tests/test_app.py, where each of
 * these was a 422 from FastAPI. The rejections matter as much as the metrics: `.strict()` is
 * what stops an affect-inference field arriving alongside a legitimate request.
 */

describe('deliveryMetricsRequestSchema', () => {
  it('accepts a well-formed request and defaults the optional fields', () => {
    const parsed = deliveryMetricsRequestSchema.parse({ transcript: 'hi' });
    expect(parsed.words).toEqual([]);
    expect(parsed.promptEndMs).toBe(0);
  });

  it('rejects a missing transcript', () => {
    expect(deliveryMetricsRequestSchema.safeParse({ words: [] }).success).toBe(false);
  });

  it('rejects an unknown field rather than ignoring it (spec §5.1)', () => {
    const result = deliveryMetricsRequestSchema.safeParse({
      transcript: 'hi',
      words: [],
      promptEndMs: 0,
      sentimentHint: 'happy',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a transcript beyond the size cap', () => {
    expect(
      deliveryMetricsRequestSchema.safeParse({ transcript: 'x'.repeat(50_001) }).success,
    ).toBe(false);
    expect(
      deliveryMetricsRequestSchema.safeParse({ transcript: 'x'.repeat(50_000) }).success,
    ).toBe(true);
  });

  it('rejects more words than the array cap allows', () => {
    const word = { word: 'x', startMs: 0, endMs: 1 };
    expect(
      deliveryMetricsRequestSchema.safeParse({
        transcript: 'hi',
        words: Array.from({ length: 20_001 }, () => word),
      }).success,
    ).toBe(false);
  });

  it('rejects a negative promptEndMs', () => {
    expect(
      deliveryMetricsRequestSchema.safeParse({ transcript: 'hi', promptEndMs: -1 }).success,
    ).toBe(false);
  });
});

describe('wordTimingSchema', () => {
  it('accepts a zero-length timing, which is degenerate but real', () => {
    expect(wordTimingSchema.safeParse({ word: 'hi', startMs: 10, endMs: 10 }).success).toBe(true);
  });

  it('rejects an end before its start', () => {
    expect(wordTimingSchema.safeParse({ word: 'x', startMs: 10, endMs: 5 }).success).toBe(false);
  });

  it('rejects a negative start', () => {
    expect(wordTimingSchema.safeParse({ word: 'x', startMs: -1, endMs: 100 }).success).toBe(false);
  });

  it('rejects an empty word and one beyond the length cap', () => {
    expect(wordTimingSchema.safeParse({ word: '', startMs: 0, endMs: 1 }).success).toBe(false);
    expect(
      wordTimingSchema.safeParse({ word: 'x'.repeat(201), startMs: 0, endMs: 1 }).success,
    ).toBe(false);
  });

  it('rejects a non-integer timestamp, so milliseconds stay milliseconds', () => {
    expect(wordTimingSchema.safeParse({ word: 'x', startMs: 1.5, endMs: 2 }).success).toBe(false);
  });

  it('rejects an unknown field on a word timing', () => {
    expect(
      wordTimingSchema.safeParse({ word: 'x', startMs: 0, endMs: 1, confidence: 0.9 }).success,
    ).toBe(false);
  });
});
