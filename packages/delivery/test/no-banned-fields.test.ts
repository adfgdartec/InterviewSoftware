import { describe, expect, it } from 'vitest';
import { findBannedTokensInFieldName, isFieldNameAllowed } from '@loopcraft/core';
import { computeDeliveryMetrics, deliveryMetricsRequestSchema } from '../src/index.js';

/**
 * The TypeScript counterpart of apps/worker/tests/test_schemas_have_no_banned_fields.py.
 *
 * Spec §5.1 / legacy-audit.md defect #1: no field this package produces or accepts may name
 * an internal state. Walking the real objects rather than a hand-written list is the point --
 * a metric added later is covered without anyone remembering to add it here.
 */

const EXAMPLE = computeDeliveryMetrics({
  transcript: 'In that situation I was responsible for the launch, so I built a pipeline.',
  words: [
    { word: 'in', startMs: 0, endMs: 100 },
    { word: 'that', startMs: 100, endMs: 300 },
  ],
  promptEndMs: 0,
});

describe('no delivery field names an internal state (spec §5.1)', () => {
  it('produces exactly the nine measurements spec §2.7 permits', () => {
    expect(Object.keys(EXAMPLE).sort()).toEqual(
      [
        'fillerRatio',
        'hedgingDensity',
        'longestMonologueSeconds',
        'pauseLengthP50Ms',
        'pauseLengthP95Ms',
        'quantificationDensity',
        'responseLatencyMs',
        'starSegmentCoverage',
        'wordsPerMinute',
      ].sort(),
    );
  });

  it('clears every output field name', () => {
    for (const field of Object.keys(EXAMPLE)) {
      expect(findBannedTokensInFieldName(field)).toEqual([]);
      expect(isFieldNameAllowed(field)).toBe(true);
    }
  });

  it('clears every input field name, nested ones included', () => {
    const parsed = deliveryMetricsRequestSchema.parse({
      transcript: 'hi',
      words: [{ word: 'hi', startMs: 0, endMs: 10 }],
      promptEndMs: 0,
    });
    const names = [...Object.keys(parsed), ...Object.keys(parsed.words[0]!)];
    for (const field of names) {
      expect(isFieldNameAllowed(field)).toBe(true);
    }
  });

  it('would catch a banned field if one were ever added', () => {
    // Proves the check above can fail, rather than passing because it tests nothing.
    expect(isFieldNameAllowed('confidence_score')).toBe(false);
    expect(findBannedTokensInFieldName('sentimentHint')).not.toEqual([]);
  });
});
