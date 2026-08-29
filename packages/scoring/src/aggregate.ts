/**
 * Self-consistency aggregation. Spec §2.6: grade with n=3 independent samples at
 * temperature 0.3, take the median, and report inter-sample variance as an uncertainty
 * signal. Acceptance criterion 8: every score shown to a user carries an uncertainty
 * interval, so this module has no code path that produces a bare number.
 *
 * The audited prototype applied a flat 15% penalty (twice, compounding to ~28%) and labelled
 * anything above 70 "exceptional". Nothing here rescales, penalises, or thresholds.
 */

export const SCALE_MIN = 1;
export const SCALE_MAX = 5;

export class InvalidSampleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSampleError';
  }
}

/** Median of a non-empty sample set. Even counts average the two central values. */
export function median(samples: readonly number[]): number {
  if (samples.length === 0) throw new InvalidSampleError('median requires at least one sample');
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    const value = sorted[mid];
    if (value === undefined) throw new InvalidSampleError('median indexing failed');
    return value;
  }
  const low = sorted[mid - 1];
  const high = sorted[mid];
  if (low === undefined || high === undefined) throw new InvalidSampleError('median indexing failed');
  return (low + high) / 2;
}

/** Population variance. Zero for a single sample, which correctly means "no spread observed". */
export function variance(samples: readonly number[]): number {
  if (samples.length === 0) throw new InvalidSampleError('variance requires at least one sample');
  if (samples.length === 1) return 0;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return samples.reduce((sum, s) => sum + (s - mean) ** 2, 0) / samples.length;
}

export interface AggregatedScore {
  readonly median: number;
  readonly intervalLow: number;
  readonly intervalHigh: number;
  readonly sampleVariance: number;
  readonly sampleCount: number;
  /** Half-width of the reported interval, i.e. the "± 0.6" in "3.4 ± 0.6". */
  readonly halfWidth: number;
}

/**
 * Minimum half-width. A single sample, or three identical samples, does not mean the grader
 * is certain -- it means the spread carries no information. Reporting "3.0 ± 0.0" would be
 * exactly the false precision spec §2.6 forbids, so the interval never collapses to zero.
 */
export const MIN_HALF_WIDTH = 0.25;

/**
 * Aggregates the samples for one dimension. The interval is the observed spread widened to
 * the floor above, clamped to the 1-5 scale so it never implies a score outside the rubric.
 */
export function aggregate(samples: readonly number[]): AggregatedScore {
  if (samples.length === 0) throw new InvalidSampleError('aggregate requires at least one sample');
  for (const s of samples) {
    if (!Number.isFinite(s)) throw new InvalidSampleError(`sample ${s} is not finite`);
    if (s < SCALE_MIN || s > SCALE_MAX) {
      throw new InvalidSampleError(`sample ${s} is outside the ${SCALE_MIN}-${SCALE_MAX} scale`);
    }
  }
  const centre = median(samples);
  const sampleVariance = variance(samples);
  const observed = Math.max(...samples) - Math.min(...samples);
  const halfWidth = Math.max(MIN_HALF_WIDTH, observed / 2);
  return {
    median: round2(centre),
    intervalLow: round2(Math.max(SCALE_MIN, centre - halfWidth)),
    intervalHigh: round2(Math.min(SCALE_MAX, centre + halfWidth)),
    sampleVariance: round4(sampleVariance),
    sampleCount: samples.length,
    halfWidth: round2(halfWidth),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * Renders a score for display. Always "3.4 ± 0.6" -- there is no formatter that produces a
 * bare number, so a UI cannot accidentally show one (acceptance criterion 8).
 */
export function formatScore(score: AggregatedScore): string {
  return `${score.median.toFixed(1)} ± ${score.halfWidth.toFixed(1)}`;
}

/**
 * Whether the samples disagreed enough that the score should be presented as low-information
 * rather than as a measurement. Spec §2.6 reports variance as a signal; this is the
 * threshold at which the UI says so.
 */
export const HIGH_DISAGREEMENT_VARIANCE = 0.5;

export function samplesDisagree(score: AggregatedScore): boolean {
  return score.sampleVariance >= HIGH_DISAGREEMENT_VARIANCE;
}
