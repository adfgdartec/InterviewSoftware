/**
 * FSRS-based spaced repetition (spec §2.9): "an FSRS-based spaced-repetition scheduler that
 * resurfaces weak sub-skills."
 *
 * This implements the published FSRS retrievability and interval equations with the
 * algorithm's default parameters. Those defaults are population priors, NOT values optimized
 * on Loopcraft response data -- optimizing them requires a review history that does not exist
 * yet, and that gap is recorded in docs/DELIVERY.md rather than papered over by presenting
 * the defaults as tuned.
 */

/** FSRS forgetting-curve constants. */
export const DECAY = -0.5;
export const FACTOR = 19 / 81;

/** Default target retention. A review is scheduled for when recall probability falls here. */
export const DEFAULT_DESIRED_RETENTION = 0.9;

/** Published FSRS default weights (w0..w16), used as priors. */
export const DEFAULT_WEIGHTS: readonly number[] = [
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474,
  0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755,
];

/** How the candidate performed when the sub-skill resurfaced. */
export const RATINGS = ['again', 'hard', 'good', 'easy'] as const;
export type Rating = (typeof RATINGS)[number];
const RATING_INDEX: Readonly<Record<Rating, 1 | 2 | 3 | 4>> = { again: 1, hard: 2, good: 3, easy: 4 };

export interface MemoryState {
  /** Stability: days until recall probability falls to the target. */
  readonly stability: number;
  /** Difficulty on FSRS's 1-10 scale. */
  readonly difficulty: number;
}

export class FsrsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FsrsError';
  }
}

function weight(index: number): number {
  const w = DEFAULT_WEIGHTS[index];
  if (w === undefined) throw new FsrsError(`FSRS weight w${index} is missing.`);
  return w;
}

function clampDifficulty(d: number): number {
  return Math.min(10, Math.max(1, d));
}

/** Probability of recall after `elapsedDays` given stability. */
export function retrievability(stability: number, elapsedDays: number): number {
  if (stability <= 0) throw new FsrsError(`Stability must be > 0, got ${stability}`);
  if (elapsedDays < 0) throw new FsrsError(`Elapsed days must be >= 0, got ${elapsedDays}`);
  return Math.pow(1 + (FACTOR * elapsedDays) / stability, DECAY);
}

/** Days until recall probability decays to `desiredRetention`. */
export function intervalDays(
  stability: number,
  desiredRetention: number = DEFAULT_DESIRED_RETENTION,
): number {
  if (stability <= 0) throw new FsrsError(`Stability must be > 0, got ${stability}`);
  if (desiredRetention <= 0 || desiredRetention >= 1) {
    throw new FsrsError(`Desired retention must be in (0,1), got ${desiredRetention}`);
  }
  const raw = (stability / FACTOR) * (Math.pow(desiredRetention, 1 / DECAY) - 1);
  return Math.max(1, Math.round(raw));
}

/** Memory state after a sub-skill is seen for the first time. */
export function initialState(rating: Rating): MemoryState {
  const g = RATING_INDEX[rating];
  return {
    stability: Math.max(0.1, weight(g - 1)),
    difficulty: clampDifficulty(weight(4) - Math.exp(weight(5) * (g - 1)) + 1),
  };
}

/** Memory state after a subsequent review. */
export function nextState(
  state: MemoryState,
  rating: Rating,
  elapsedDays: number,
): MemoryState {
  if (state.stability <= 0) throw new FsrsError('Stability must be > 0');
  const g = RATING_INDEX[rating];
  const r = retrievability(state.stability, elapsedDays);

  const nextDifficulty = clampDifficulty(
    state.difficulty - weight(6) * (g - 3) + (weight(4) - state.difficulty) * weight(7),
  );

  if (rating === 'again') {
    // Lapse: stability drops but never to zero, so a single bad day does not erase history.
    const lapsed =
      weight(11) *
      Math.pow(state.difficulty, -weight(12)) *
      (Math.pow(state.stability + 1, weight(13)) - 1) *
      Math.exp(weight(14) * (1 - r));
    return { stability: Math.max(0.1, Math.min(lapsed, state.stability)), difficulty: nextDifficulty };
  }

  const hardPenalty = rating === 'hard' ? weight(15) : 1;
  const easyBonus = rating === 'easy' ? weight(16) : 1;
  const grown =
    state.stability *
    (1 +
      Math.exp(weight(8)) *
        (11 - state.difficulty) *
        Math.pow(state.stability, -weight(9)) *
        (Math.exp(weight(10) * (1 - r)) - 1) *
        hardPenalty *
        easyBonus);
  return { stability: Math.max(state.stability, grown), difficulty: nextDifficulty };
}

export interface ScheduledSkill {
  readonly dimension: string;
  readonly state: MemoryState;
  readonly dueInDays: number;
  readonly dueAt: Date;
  readonly retrievabilityNow: number;
}

/**
 * Schedules the next review of a sub-skill. Returns the whole state rather than just a date,
 * so a later change to desired retention can reschedule from stored memory rather than
 * requiring the candidate to answer again.
 */
export function schedule(
  dimension: string,
  state: MemoryState,
  lastReviewedAt: Date,
  now: Date = new Date(),
  desiredRetention: number = DEFAULT_DESIRED_RETENTION,
): ScheduledSkill {
  const elapsedDays = Math.max(0, (now.getTime() - lastReviewedAt.getTime()) / 86_400_000);
  const dueInDays = intervalDays(state.stability, desiredRetention);
  return {
    dimension,
    state,
    dueInDays,
    dueAt: new Date(lastReviewedAt.getTime() + dueInDays * 86_400_000),
    retrievabilityNow: retrievability(state.stability, elapsedDays),
  };
}

/** Sub-skills whose recall probability has already decayed past the target. */
export function dueNow(
  scheduled: readonly ScheduledSkill[],
  now: Date = new Date(),
): readonly ScheduledSkill[] {
  return [...scheduled]
    .filter((s) => s.dueAt.getTime() <= now.getTime())
    .sort((a, b) => a.retrievabilityNow - b.retrievabilityNow);
}
