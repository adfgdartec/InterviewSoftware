import type { PresenceReport } from '@loopcraft/scoring';
import type { FramingVerdict } from './framing-analysis.js';

/**
 * Aggregates a stream of per-frame framing verdicts into one summary for a round.
 *
 * Same boundary as framing-analysis.ts, for the same reason: every input is a geometric
 * verdict already computed from coordinates, and every output is a count or a ratio of those
 * verdicts. Nothing here reads expression, gaze intent, attentiveness or anything else about
 * the person -- only where their head was in the frame, over time. That is what keeps this
 * inside "mechanical framing advice" (the compliance page's words) rather than something the
 * no-affect-inference guardrail exists to catch.
 *
 * Pure and framework-free on purpose: the whole classification is table-testable without a
 * camera, a browser, or WASM, which is the only part where a real bug can hide.
 */

export interface PresenceSample {
  /** Milliseconds since the round's monitoring began. */
  readonly atMs: number;
  /** Null when the detector found no face in that frame. */
  readonly verdict: FramingVerdict | null;
}

export interface PresenceSummary {
  readonly sampleCount: number;
  /** Samples where a face was found at all. */
  readonly detectedCount: number;
  /** Of the detected samples, the fraction passing all three geometric checks. */
  readonly wellFramedRatio: number;
  readonly offCenterRatio: number;
  readonly distanceOffRatio: number;
  readonly eyeLineOffRatio: number;
  /**
   * Transitions from well-framed to not (or to undetected). Counts how often framing was
   * LOST, which reads differently from a steady 60% -- drifting away eight times is a
   * different habit from sitting slightly off-centre throughout.
   */
  readonly driftEvents: number;
  /** Longest unbroken stretch of well-framed samples, in milliseconds. */
  readonly longestWellFramedMs: number;
  readonly notes: readonly string[];
}

/** Below this, a summary is too thin to say anything about and reports no notes. */
export const MIN_SAMPLES_FOR_NOTES = 10;

const WELL_FRAMED_TARGET = 0.8;
const RECURRING_ISSUE_THRESHOLD = 0.25;

function isWellFramed(verdict: FramingVerdict | null): boolean {
  return verdict !== null && verdict.centered && verdict.distanceOk && verdict.eyeLineOk;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 100) / 100;
}

export function summarizePresence(samples: readonly PresenceSample[]): PresenceSummary {
  const detected = samples.filter((s) => s.verdict !== null);
  const detectedCount = detected.length;

  const offCenter = detected.filter((s) => !s.verdict!.centered).length;
  const distanceOff = detected.filter((s) => !s.verdict!.distanceOk).length;
  const eyeLineOff = detected.filter((s) => !s.verdict!.eyeLineOk).length;
  const wellFramed = samples.filter((s) => isWellFramed(s.verdict)).length;

  let driftEvents = 0;
  let longestWellFramedMs = 0;
  let runStartMs: number | null = null;

  for (let i = 0; i < samples.length; i += 1) {
    const current = isWellFramed(samples[i]!.verdict);
    const previous = i === 0 ? false : isWellFramed(samples[i - 1]!.verdict);

    if (current && !previous) runStartMs = samples[i]!.atMs;
    if (!current && previous) {
      driftEvents += 1;
      if (runStartMs !== null) {
        longestWellFramedMs = Math.max(longestWellFramedMs, samples[i]!.atMs - runStartMs);
        runStartMs = null;
      }
    }
  }
  // A run still open at the end never hits the transition branch above.
  if (runStartMs !== null && samples.length > 0) {
    longestWellFramedMs = Math.max(
      longestWellFramedMs,
      samples[samples.length - 1]!.atMs - runStartMs,
    );
  }

  const wellFramedRatio = ratio(wellFramed, samples.length);
  const summary = {
    sampleCount: samples.length,
    detectedCount,
    wellFramedRatio,
    offCenterRatio: ratio(offCenter, detectedCount),
    distanceOffRatio: ratio(distanceOff, detectedCount),
    eyeLineOffRatio: ratio(eyeLineOff, detectedCount),
    driftEvents,
    longestWellFramedMs,
  };

  return { ...summary, notes: notesFor(summary) };
}

export type SummaryFacts = Omit<PresenceSummary, 'notes'>;

/**
 * Combines the per-round rows stored by POST /api/sessions/:id/presence into one report for
 * the session, and re-derives the notes from the combined numbers.
 *
 * The ratios are re-weighted by the counts they were computed from, not averaged: a round
 * with 400 samples and a round with 12 do not describe the session equally, and averaging
 * their ratios would let a short round swing the whole report. `driftEvents` sums because
 * losing framing four times in each of two rounds is eight times across the session, while
 * `longestWellFramedMs` takes the maximum, because it describes a single unbroken stretch and
 * stretches in different rounds cannot be added into one.
 *
 * Returns null for no rounds, so "not measured" stays distinguishable from "measured badly".
 */
export function combinePresence(rounds: readonly SummaryFacts[]): PresenceReport | null {
  if (rounds.length === 0) return null;

  const sampleCount = rounds.reduce((sum, r) => sum + r.sampleCount, 0);
  const detectedCount = rounds.reduce((sum, r) => sum + r.detectedCount, 0);

  // wellFramedRatio is a fraction of ALL samples; the other three are fractions of DETECTED
  // samples. Each is re-weighted by its own denominator, or the weighting would be wrong for
  // a round where the camera saw nothing.
  const byTotal = (pick: (r: SummaryFacts) => number): number =>
    sampleCount === 0
      ? 0
      : round2(rounds.reduce((sum, r) => sum + pick(r) * r.sampleCount, 0) / sampleCount);
  const byDetected = (pick: (r: SummaryFacts) => number): number =>
    detectedCount === 0
      ? 0
      : round2(rounds.reduce((sum, r) => sum + pick(r) * r.detectedCount, 0) / detectedCount);

  const combined: SummaryFacts = {
    sampleCount,
    detectedCount,
    wellFramedRatio: byTotal((r) => r.wellFramedRatio),
    offCenterRatio: byDetected((r) => r.offCenterRatio),
    distanceOffRatio: byDetected((r) => r.distanceOffRatio),
    eyeLineOffRatio: byDetected((r) => r.eyeLineOffRatio),
    driftEvents: rounds.reduce((sum, r) => sum + r.driftEvents, 0),
    longestWellFramedMs: Math.max(...rounds.map((r) => r.longestWellFramedMs)),
  };

  return { ...combined, roundCount: rounds.length, notes: notesFor(combined) };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Advice, strictly about camera geometry. Every string here describes the CAMERA or a
 * position, never the person -- "you were off-centre" is framing, "you seemed distracted"
 * would be an inference this product does not make and its lint rule would reject.
 */
function notesFor(s: SummaryFacts): string[] {
  if (s.sampleCount < MIN_SAMPLES_FOR_NOTES) return [];

  const notes: string[] = [];
  const detectionRatio = ratio(s.detectedCount, s.sampleCount);
  if (detectionRatio < 0.5) {
    notes.push('You were out of frame for much of the round. Check the camera can see you.');
    return notes;
  }

  if (s.wellFramedRatio >= WELL_FRAMED_TARGET) {
    notes.push('Your framing held steady for most of the round.');
  }
  if (s.offCenterRatio >= RECURRING_ISSUE_THRESHOLD) {
    notes.push('You sat left or right of centre for a good part of the round.');
  }
  if (s.distanceOffRatio >= RECURRING_ISSUE_THRESHOLD) {
    notes.push('Your distance from the camera drifted outside a comfortable range.');
  }
  if (s.eyeLineOffRatio >= RECURRING_ISSUE_THRESHOLD) {
    notes.push('Your eye line sat outside the upper third of the frame. Try raising the camera.');
  }
  if (s.driftEvents >= 5) {
    notes.push(`Your framing shifted ${s.driftEvents} times. A steadier setup is easier to watch.`);
  }
  return notes;
}
