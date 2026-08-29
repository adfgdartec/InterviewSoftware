import type { AbilityEstimate } from './irt.js';

/**
 * The weakness graph (spec §2.9). Per-dimension ability over time, ranked so the candidate
 * is pointed at the sub-skill where practice buys the most.
 *
 * Ranking is deliberately not "lowest θ first". A dimension measured once with a huge
 * standard error is not evidence of weakness -- it is absence of evidence, and sending
 * someone to drill it wastes their time. Dimensions are ranked by the bottom of their
 * interval, so a confidently-low score outranks a wildly-uncertain one.
 */

export interface DimensionAbility {
  readonly dimension: string;
  readonly name: string;
  readonly estimate: AbilityEstimate;
  readonly measuredAt: Date;
  /** Sub-skills this dimension builds on. An edge means "shore this up first". */
  readonly prerequisites: readonly string[];
}

export interface WeaknessNode {
  readonly dimension: string;
  readonly name: string;
  readonly theta: number;
  readonly standardError: number;
  readonly intervalLow: number;
  readonly intervalHigh: number;
  readonly reportable: boolean;
  /** Lower is weaker. Null when there is not enough evidence to rank. */
  readonly priority: number | null;
  readonly blockedBy: readonly string[];
}

export interface WeaknessGraph {
  readonly nodes: readonly WeaknessNode[];
  /** Ranked weakest first, excluding anything not yet reportable. */
  readonly focus: readonly WeaknessNode[];
  readonly unmeasured: readonly string[];
}

/** 95% interval on θ. Two standard errors, stated rather than implied. */
export function abilityInterval(estimate: AbilityEstimate): { low: number; high: number } {
  if (!Number.isFinite(estimate.standardError)) {
    return { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY };
  }
  return {
    low: round2(estimate.theta - 2 * estimate.standardError),
    high: round2(estimate.theta + 2 * estimate.standardError),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildWeaknessGraph(abilities: readonly DimensionAbility[]): WeaknessGraph {
  const byId = new Map(abilities.map((a) => [a.dimension, a]));

  const nodes: WeaknessNode[] = abilities.map((a) => {
    const { low, high } = abilityInterval(a.estimate);
    // A prerequisite blocks practice only when it is itself measured and weaker.
    const blockedBy = a.prerequisites.filter((p) => {
      const prereq = byId.get(p);
      if (prereq === undefined || !prereq.estimate.reportable) return false;
      return prereq.estimate.theta < a.estimate.theta;
    });
    return {
      dimension: a.dimension,
      name: a.name,
      theta: a.estimate.theta,
      standardError: a.estimate.standardError,
      intervalLow: low,
      intervalHigh: high,
      reportable: a.estimate.reportable,
      priority: a.estimate.reportable ? low : null,
      blockedBy,
    };
  });

  const focus = nodes
    .filter((n) => n.reportable && n.priority !== null)
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.dimension.localeCompare(b.dimension));

  return {
    nodes,
    focus,
    unmeasured: nodes.filter((n) => !n.reportable).map((n) => n.dimension).sort(),
  };
}

/**
 * The dimension to practise next: the weakest reportable one that is not itself blocked by a
 * weaker prerequisite. Returns null when nothing is measured well enough to recommend, which
 * is the honest answer rather than a guess.
 */
export function nextFocus(graph: WeaknessGraph): WeaknessNode | null {
  return graph.focus.find((n) => n.blockedBy.length === 0) ?? graph.focus[0] ?? null;
}
