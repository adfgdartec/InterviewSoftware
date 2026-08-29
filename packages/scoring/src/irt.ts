/**
 * Two-parameter logistic IRT. Spec §2.5: each item carries a difficulty `b` and a
 * discrimination `a`; after each response the ability estimate θ is updated, and the next
 * item is the one maximizing Fisher information near θ, targeting roughly a 60% success
 * probability.
 *
 * The point of using IRT rather than "adapt from the last answer" is that θ comes with a
 * standard error. Spec §2.9 requires readiness to be stated as an ability estimate against a
 * target level with that SE, never as a probability of getting an offer -- so every function
 * here returns the SE alongside the estimate, and none returns θ on its own.
 */

/** θ is unbounded in theory; clamped in practice so a run of correct answers cannot diverge. */
export const THETA_MIN = -4;
export const THETA_MAX = 4;

/** Spec §2.5: select the next item near a 60% success probability. */
export const TARGET_SUCCESS_PROBABILITY = 0.6;

/** Spec §2.5: recalibrate an item's parameters only once it has this many responses. */
export const RECALIBRATION_THRESHOLD = 200;

export interface IrtItem {
  readonly id: string;
  /** Difficulty. Higher means harder. */
  readonly b: number;
  /** Discrimination. Higher means the item separates ability more sharply near b. */
  readonly a: number;
}

export interface Response {
  readonly item: IrtItem;
  readonly correct: boolean;
}

export class IrtParameterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IrtParameterError';
  }
}

function assertItem(item: IrtItem): void {
  if (!Number.isFinite(item.a) || item.a <= 0) {
    throw new IrtParameterError(`Item ${item.id}: discrimination a must be > 0, got ${item.a}`);
  }
  if (!Number.isFinite(item.b)) {
    throw new IrtParameterError(`Item ${item.id}: difficulty b must be finite, got ${item.b}`);
  }
}

/** P(correct | θ) under the 2PL model. */
export function probabilityCorrect(theta: number, item: IrtItem): number {
  assertItem(item);
  return 1 / (1 + Math.exp(-item.a * (theta - item.b)));
}

/**
 * Fisher information the item carries at θ. Peaks at θ = b and scales with a², which is why
 * a high-discrimination item near the candidate's ability is worth more than a hard one far
 * above it.
 */
export function fisherInformation(theta: number, item: IrtItem): number {
  const p = probabilityCorrect(theta, item);
  return item.a * item.a * p * (1 - p);
}

export interface AbilityEstimate {
  readonly theta: number;
  readonly standardError: number;
  readonly responsesUsed: number;
  /** False until the estimate is informative enough to show a candidate. */
  readonly reportable: boolean;
}

/**
 * SE below which an estimate is worth showing. Chosen so the reported interval is narrower
 * than one rubric level; above it the UI says "not enough evidence yet" rather than drawing
 * a number with an interval wide enough to span the whole scale.
 */
export const REPORTABLE_SE = 0.8;

/**
 * Maximum-likelihood θ by Newton-Raphson, with a bounded fallback.
 *
 * MLE is undefined for an all-correct or all-incorrect response pattern -- the likelihood is
 * monotonic and θ runs off to ±∞. Rather than returning a clamped number and pretending it
 * is an estimate, those patterns return θ at the clamp with a deliberately large SE and
 * `reportable: false`, because the honest statement is "we do not know yet".
 */
export function estimateAbility(responses: readonly Response[]): AbilityEstimate {
  for (const r of responses) assertItem(r.item);

  if (responses.length === 0) {
    return { theta: 0, standardError: Number.POSITIVE_INFINITY, responsesUsed: 0, reportable: false };
  }

  const correctCount = responses.filter((r) => r.correct).length;
  const allSameWay = correctCount === 0 || correctCount === responses.length;

  let theta = 0;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    let firstDerivative = 0;
    let information = 0;
    for (const { item, correct } of responses) {
      const p = probabilityCorrect(theta, item);
      firstDerivative += item.a * ((correct ? 1 : 0) - p);
      information += fisherInformation(theta, item);
    }
    if (information <= 1e-9) break;
    const step = firstDerivative / information;
    theta += Math.max(-1, Math.min(1, step));
    theta = Math.max(THETA_MIN, Math.min(THETA_MAX, theta));
    if (Math.abs(step) < 1e-6) break;
  }

  const totalInformation = responses.reduce((sum, r) => sum + fisherInformation(theta, r.item), 0);
  const standardError = totalInformation > 0 ? 1 / Math.sqrt(totalInformation) : Number.POSITIVE_INFINITY;

  if (allSameWay) {
    return {
      theta: correctCount === 0 ? THETA_MIN : THETA_MAX,
      standardError: Number.POSITIVE_INFINITY,
      responsesUsed: responses.length,
      reportable: false,
    };
  }

  return {
    theta: round3(theta),
    standardError: round3(standardError),
    responsesUsed: responses.length,
    reportable: Number.isFinite(standardError) && standardError <= REPORTABLE_SE,
  };
}

function round3(n: number): number {
  return Math.round(n * 1_000) / 1_000;
}

export interface Selection {
  readonly item: IrtItem;
  readonly information: number;
  readonly successProbability: number;
}

/**
 * Picks the next item. Spec §2.5 asks for two things that pull apart: maximize Fisher
 * information, and target roughly 60% success. Pure max-information picks items at θ = b,
 * where P = 0.5 -- relentlessly hard, and demoralizing over a long loop. So candidates are
 * ranked by information but restricted to those whose success probability is near the
 * target, which satisfies both and is stated here rather than buried.
 */
export function selectNextItem(
  theta: number,
  pool: readonly IrtItem[],
  excludeIds: readonly string[] = [],
  targetProbability: number = TARGET_SUCCESS_PROBABILITY,
): Selection | null {
  const excluded = new Set(excludeIds);
  const available = pool.filter((i) => !excluded.has(i.id));
  if (available.length === 0) return null;

  const scored = available.map((item) => ({
    item,
    information: fisherInformation(theta, item),
    successProbability: probabilityCorrect(theta, item),
  }));

  // Prefer items inside a band around the target; fall back to the whole pool when the bank
  // has nothing suitable rather than refusing to ask a question.
  const band = scored.filter((s) => Math.abs(s.successProbability - targetProbability) <= 0.15);
  const candidates = band.length > 0 ? band : scored;

  return candidates.reduce((best, current) => {
    if (current.information > best.information) return current;
    if (current.information < best.information) return best;
    // Deterministic tie-break so a seeded demo is reproducible.
    return current.item.id < best.item.id ? current : best;
  });
}

/**
 * Whether an item has accumulated enough responses to have its parameters recalibrated from
 * data rather than expert tagging (spec §2.5).
 */
export function isRecalibratable(responseCount: number): boolean {
  return responseCount >= RECALIBRATION_THRESHOLD;
}

/**
 * Readiness against a target ability, expressed as spec §2.9 requires: a gap with a stated
 * standard error, never a probability of an offer.
 */
export interface Readiness {
  readonly gap: number;
  readonly standardError: number;
  readonly reportable: boolean;
  readonly statement: string;
}

export function readiness(estimate: AbilityEstimate, targetTheta: number): Readiness {
  if (!estimate.reportable) {
    return {
      gap: Number.NaN,
      standardError: estimate.standardError,
      reportable: false,
      statement: 'Not enough evidence yet to estimate ability for this dimension.',
    };
  }
  const gap = round3(estimate.theta - targetTheta);
  const direction = gap >= 0 ? 'at or above' : 'below';
  return {
    gap,
    standardError: estimate.standardError,
    reportable: true,
    statement:
      `Ability estimate ${estimate.theta.toFixed(2)} ± ${estimate.standardError.toFixed(2)}, ` +
      `${direction} the target of ${targetTheta.toFixed(2)}.`,
  };
}
