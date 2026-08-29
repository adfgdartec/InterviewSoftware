import { describe, expect, it } from 'vitest';
import {
  EMOTION_TOKENS,
  findBannedTokensInFieldName,
  findBannedTokensInText,
  isFieldNameAllowed,
} from '../src/banned-tokens.js';

describe('field-name scanning (guardrail 1)', () => {
  it.each([
    'engagementScore',
    'engagement_score',
    'engagement-score',
    'candidateSentiment',
    'voiceConfidence',
    'moodDelta',
    'personalityProfile',
    'facialExpression',
    'eyeContactRatio',
    'toneOfVoice',
  ])('rejects %s', (field) => {
    expect(isFieldNameAllowed(field)).toBe(false);
  });

  it.each([
    'wordsPerMinute',
    'fillerRatio',
    'pauseLengthP95',
    'longestMonologueSeconds',
    'responseLatencyMs',
    'hedgingDensity',
    'quantificationDensity',
    'starSegmentCoverage',
    'hintDependence',
  ])('accepts the spec §2.7 measurement %s', (field) => {
    expect(isFieldNameAllowed(field)).toBe(true);
  });

  it('allows only the statistical spellings of confidence', () => {
    expect(isFieldNameAllowed('confidenceInterval')).toBe(true);
    expect(isFieldNameAllowed('confidence_interval')).toBe(true);
    expect(isFieldNameAllowed('graderConfidenceInterval')).toBe(true);
    // Bare `confidence` is ambiguous at the call site, so it stays banned.
    expect(isFieldNameAllowed('confidence')).toBe(false);
    expect(isFieldNameAllowed('confidenceLevel')).toBe(false);
  });

  it('reports the offending token, not just a boolean', () => {
    const hits = findBannedTokensInFieldName('speakerEnthusiasmIndex');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.token).toBe('enthusiasm');
  });

  it('flags every token in the vocabulary when used as a bare field name', () => {
    const unflagged = EMOTION_TOKENS.filter((t) => isFieldNameAllowed(t.replaceAll(' ', '')));
    expect(unflagged).toEqual([]);
  });

  it('handles empty and whitespace input without throwing', () => {
    expect(findBannedTokensInFieldName('')).toEqual([]);
    expect(findBannedTokensInFieldName('   ')).toEqual([]);
  });

  it('does not flag substrings inside unrelated words', () => {
    // "confide" contains no whole banned token; "moody" is not "mood".
    expect(isFieldNameAllowed('confidentialityNotice')).toBe(true);
    expect(isFieldNameAllowed('moodyBluesPlaylist')).toBe(true);
  });
});

describe('prose scanning', () => {
  it('permits a statistical confidence interval in UI copy', () => {
    expect(findBannedTokensInText('Structure: 3.4 ± 0.6 (95% confidence interval)')).toEqual([]);
    expect(findBannedTokensInText('Reported with a confidence band.')).toEqual([]);
  });

  it('rejects affect claims in UI copy', () => {
    expect(findBannedTokensInText('You sounded nervous and low in confidence.')).not.toHaveLength(0);
    expect(findBannedTokensInText('Your engagement was high this round.')).not.toHaveLength(0);
  });

  it('scans long input without pathological slowdown', () => {
    const long = 'words per minute steady. '.repeat(4_000) + 'your mood dipped';
    const started = performance.now();
    const hits = findBannedTokensInText(long);
    expect(hits.map((h) => h.token)).toContain('mood');
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('is case insensitive and tolerant of separators', () => {
    expect(findBannedTokensInText('SENTIMENT')).toHaveLength(1);
    expect(findBannedTokensInText('micro_expression')).toHaveLength(1);
    expect(findBannedTokensInText('facial-expression')).toHaveLength(1);
  });
});
