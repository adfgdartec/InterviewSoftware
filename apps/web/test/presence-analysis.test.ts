import { describe, expect, it } from 'vitest';
import { findBannedTokensInText } from '@loopcraft/core';
import {
  MIN_SAMPLES_FOR_NOTES,
  summarizePresence,
  type PresenceSample,
} from '../src/lib/presence-analysis.js';
import type { FramingVerdict } from '../src/lib/framing-analysis.js';

const good: FramingVerdict = { centered: true, distanceOk: true, eyeLineOk: true, messages: [] };
const offCentre: FramingVerdict = { ...good, centered: false, messages: ['Center yourself.'] };
const tooClose: FramingVerdict = { ...good, distanceOk: false, messages: ['Move back a little.'] };
const lowEyes: FramingVerdict = { ...good, eyeLineOk: false, messages: ['Lower your camera.'] };

/** Samples at a steady 500ms cadence, matching what the component records. */
function stream(verdicts: readonly (FramingVerdict | null)[]): PresenceSample[] {
  return verdicts.map((verdict, i) => ({ atMs: i * 500, verdict }));
}

describe('summarizePresence', () => {
  it('reports an empty stream without dividing by zero', () => {
    const s = summarizePresence([]);
    expect(s.sampleCount).toBe(0);
    expect(s.wellFramedRatio).toBe(0);
    expect(s.offCenterRatio).toBe(0);
    expect(s.driftEvents).toBe(0);
    expect(s.longestWellFramedMs).toBe(0);
    expect(s.notes).toEqual([]);
  });

  it('scores a perfectly framed round at 1.0 with no drift', () => {
    const s = summarizePresence(stream(Array(20).fill(good)));
    expect(s.wellFramedRatio).toBe(1);
    expect(s.driftEvents).toBe(0);
    // 20 samples at 500ms: the run spans from t=0 to t=9500.
    expect(s.longestWellFramedMs).toBe(9_500);
    expect(s.notes).toContain('Your framing held steady for most of the round.');
  });

  it('computes issue ratios against DETECTED samples, not all samples', () => {
    // Half the stream has no face at all. Off-centre is 5 of the 10 detected frames -- 0.5,
    // not 0.25. Dividing by every sample would understate a real problem whenever the
    // detector loses the face.
    const s = summarizePresence(stream([...Array(5).fill(offCentre), ...Array(5).fill(good), ...Array(10).fill(null)]));
    expect(s.detectedCount).toBe(10);
    expect(s.offCenterRatio).toBe(0.5);
    // The well-framed ratio IS over every sample: a frame with no face is not well framed.
    expect(s.wellFramedRatio).toBe(0.25);
  });

  it('counts a drift event each time framing is lost, not each bad frame', () => {
    // good, good, BAD, good, good, BAD, good -- framing is lost twice, though three frames
    // are bad in total. The distinction is the whole point of the metric.
    const s = summarizePresence(stream([good, good, offCentre, good, good, offCentre, offCentre, good]));
    expect(s.driftEvents).toBe(2);
  });

  it('counts losing the face entirely as a drift event', () => {
    const s = summarizePresence(stream([good, good, null, good]));
    expect(s.driftEvents).toBe(1);
  });

  it('measures the longest unbroken well-framed stretch, not the total', () => {
    // Two runs: 2 samples then 4. The longer one spans t=1500..3000 = 1500ms.
    const s = summarizePresence(stream([good, good, offCentre, good, good, good, good]));
    expect(s.longestWellFramedMs).toBe(1_500);
  });

  it('closes a run that is still open at the end of the round', () => {
    // Without the end-of-loop branch this reports 0: the final run never hits a transition.
    const s = summarizePresence(stream([offCentre, good, good, good]));
    expect(s.longestWellFramedMs).toBe(1_000);
  });

  it('stays silent when there is too little to say', () => {
    const s = summarizePresence(stream(Array(MIN_SAMPLES_FOR_NOTES - 1).fill(offCentre)));
    expect(s.notes).toEqual([]);
    // The ratios are still reported; only the advice is withheld.
    expect(s.offCenterRatio).toBe(1);
  });

  it('leads with being out of frame, and says nothing else, when the face is mostly missing', () => {
    const s = summarizePresence(stream([...Array(4).fill(good), ...Array(16).fill(null)]));
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0]).toMatch(/out of frame/i);
  });

  it('names each recurring geometric issue separately', () => {
    const s = summarizePresence(stream([...Array(10).fill(offCentre), ...Array(10).fill(lowEyes)]));
    expect(s.notes.some((n) => /left or right of centre/i.test(n))).toBe(true);
    expect(s.notes.some((n) => /eye line/i.test(n))).toBe(true);
  });

  it('mentions distance when it drifts', () => {
    const s = summarizePresence(stream([...Array(10).fill(tooClose), ...Array(10).fill(good)]));
    expect(s.notes.some((n) => /distance/i.test(n))).toBe(true);
  });

  it('calls out repeated shifting only when it is actually repeated', () => {
    const steady = summarizePresence(stream([...Array(10).fill(good), ...Array(10).fill(offCentre)]));
    expect(steady.notes.some((n) => /shifted/i.test(n))).toBe(false);

    const jumpy = summarizePresence(
      stream(Array.from({ length: 24 }, (_, i) => (i % 2 === 0 ? good : offCentre))),
    );
    expect(jumpy.driftEvents).toBeGreaterThanOrEqual(5);
    expect(jumpy.notes.some((n) => /shifted/i.test(n))).toBe(true);
  });

  it('rounds ratios to two places rather than emitting false precision', () => {
    const s = summarizePresence(stream([good, good, offCentre]));
    expect(s.wellFramedRatio).toBe(0.67);
  });
});

describe('guardrail 1: presence advice describes the camera, never the person', () => {
  it('emits no banned affect vocabulary in any note, across every shape of round', () => {
    const shapes: (FramingVerdict | null)[][] = [
      Array(20).fill(good),
      Array(20).fill(offCentre),
      Array(20).fill(tooClose),
      Array(20).fill(lowEyes),
      Array(20).fill(null),
      [...Array(10).fill(good), ...Array(10).fill(null)],
      Array.from({ length: 24 }, (_, i) => (i % 2 === 0 ? good : offCentre)),
    ];
    for (const shape of shapes) {
      for (const note of summarizePresence(stream(shape)).notes) {
        // The same gate the ESLint rule applies to source, applied to generated text --
        // which is the one surface a lint rule cannot see.
        expect(findBannedTokensInText(note)).toEqual([]);
      }
    }
  });
});
