import { describe, expect, it } from 'vitest';
import { videoEligible, type VideoEligibilityInput } from '../src/server/video-eligibility.js';

function input(overrides: Partial<VideoEligibilityInput> = {}): VideoEligibilityInput {
  return {
    jurisdiction: 'us_other',
    ageBand: '16_plus',
    videoOptIn: true,
    planAllowsVideo: true,
    ...overrides,
  };
}

describe('videoEligible (fail-closed on every gate)', () => {
  it('is eligible when all four conditions hold', () => {
    expect(videoEligible(input())).toBe(true);
  });

  it('is eligible for jurisdiction "other" too, not just "us_other"', () => {
    expect(videoEligible(input({ jurisdiction: 'other' }))).toBe(true);
  });

  it('is never eligible for jurisdiction "eu"', () => {
    expect(videoEligible(input({ jurisdiction: 'eu' }))).toBe(false);
  });

  it('is never eligible for jurisdiction "illinois"', () => {
    expect(videoEligible(input({ jurisdiction: 'illinois' }))).toBe(false);
  });

  it('is never eligible for jurisdiction "unknown"', () => {
    expect(videoEligible(input({ jurisdiction: 'unknown' }))).toBe(false);
  });

  it('is never eligible for age band "unknown"', () => {
    expect(videoEligible(input({ ageBand: 'unknown' }))).toBe(false);
  });

  it('is never eligible for age band "under_13"', () => {
    expect(videoEligible(input({ ageBand: 'under_13' }))).toBe(false);
  });

  it('is never eligible for age band "13_to_15"', () => {
    expect(videoEligible(input({ ageBand: '13_to_15' }))).toBe(false);
  });

  it('is not eligible without opting in, even if otherwise eligible', () => {
    expect(videoEligible(input({ videoOptIn: false }))).toBe(false);
  });

  it('is not eligible on a plan that does not allow video, even if otherwise eligible', () => {
    expect(videoEligible(input({ planAllowsVideo: false }))).toBe(false);
  });

  it('requires every condition simultaneously, not just one', () => {
    expect(
      videoEligible({
        jurisdiction: 'eu',
        ageBand: 'under_13',
        videoOptIn: false,
        planAllowsVideo: false,
      }),
    ).toBe(false);
  });
});
