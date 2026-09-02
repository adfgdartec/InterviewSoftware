import { describe, expect, it } from 'vitest';
import {
  videoOptInBlock,
  videoOptInPermitted,
  type VideoOptInInput,
} from '../src/lib/video-opt-in.js';

function input(overrides: Partial<VideoOptInInput> = {}): VideoOptInInput {
  return { jurisdiction: 'us_other', ageBand: '16_plus', ...overrides };
}

/**
 * The self-reported half of the video gate. The settings page and `videoEligible` must agree
 * on it exactly: a checkbox that is offered where the server gate will refuse tells the user
 * they have enabled something that will never appear.
 */
describe('videoOptInBlock', () => {
  it('permits an eligible US state at 16+', () => {
    expect(videoOptInBlock(input())).toBeNull();
    expect(videoOptInPermitted(input())).toBe(true);
  });

  it('permits jurisdiction "other" at 16+', () => {
    expect(videoOptInBlock(input({ jurisdiction: 'other' }))).toBeNull();
  });

  it('reports "incomplete" while jurisdiction is unset', () => {
    expect(videoOptInBlock(input({ jurisdiction: 'unknown' }))).toBe('incomplete');
  });

  it('reports "incomplete" while age band is unset', () => {
    expect(videoOptInBlock(input({ ageBand: 'unknown' }))).toBe('incomplete');
  });

  it('reports "jurisdiction" in the EU, where video is prohibited outright', () => {
    expect(videoOptInBlock(input({ jurisdiction: 'eu' }))).toBe('jurisdiction');
    expect(videoOptInPermitted(input({ jurisdiction: 'eu' }))).toBe(false);
  });

  it('reports "jurisdiction" in Illinois', () => {
    expect(videoOptInBlock(input({ jurisdiction: 'illinois' }))).toBe('jurisdiction');
  });

  it('reports "age" under 13', () => {
    expect(videoOptInBlock(input({ ageBand: 'under_13' }))).toBe('age');
    expect(videoOptInPermitted(input({ ageBand: 'under_13' }))).toBe(false);
  });

  it('reports "age" at 13-15', () => {
    expect(videoOptInBlock(input({ ageBand: '13_to_15' }))).toBe('age');
  });

  it('reports the unset field first when a set field is also ineligible', () => {
    // "Finish filling this in" is the actionable message; naming a prohibition the user has
    // not finished declaring would be premature.
    expect(videoOptInBlock({ jurisdiction: 'eu', ageBand: 'unknown' })).toBe('incomplete');
  });

  it('reports the jurisdiction prohibition ahead of the age one when both apply', () => {
    expect(videoOptInBlock({ jurisdiction: 'eu', ageBand: 'under_13' })).toBe('jurisdiction');
  });

  it('treats an unrecognised jurisdiction as prohibited, not permitted', () => {
    expect(videoOptInPermitted(input({ jurisdiction: 'mars' }))).toBe(false);
  });
});
