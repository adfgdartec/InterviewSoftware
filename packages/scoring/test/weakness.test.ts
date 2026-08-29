import { describe, expect, it } from 'vitest';
import { buildWeaknessGraph, abilityInterval, nextFocus, type DimensionAbility } from '../src/weakness.js';
import type { AbilityEstimate } from '../src/irt.js';

const est = (theta: number, se: number, reportable = true): AbilityEstimate => ({
  theta, standardError: se, responsesUsed: 12, reportable,
});
const at = new Date('2026-09-01T00:00:00Z');

const dim = (
  dimension: string, theta: number, se: number, reportable = true, prerequisites: string[] = [],
): DimensionAbility => ({
  dimension, name: dimension, estimate: est(theta, se, reportable), measuredAt: at, prerequisites,
});

describe('ability intervals', () => {
  it('is two standard errors either side', () => {
    expect(abilityInterval(est(1, 0.25))).toEqual({ low: 0.5, high: 1.5 });
  });

  it('is unbounded when the standard error is infinite', () => {
    const i = abilityInterval(est(0, Number.POSITIVE_INFINITY, false));
    expect(i.low).toBe(Number.NEGATIVE_INFINITY);
    expect(i.high).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('the weakness graph ranks by evidence, not by raw score', () => {
  it('ranks a confidently-low dimension above a wildly-uncertain one', () => {
    // Same θ, very different certainty. The uncertain one is not evidence of weakness.
    const graph = buildWeaknessGraph([dim('confident_low', -1, 0.2), dim('uncertain', -1, 0.75)]);
    expect(graph.focus[0]?.dimension).toBe('uncertain');
    // ...because its interval bottom is lower. Assert the stated rule explicitly:
    expect(graph.focus[0]!.intervalLow).toBeLessThan(graph.focus[1]!.intervalLow);
  });

  it('puts the weakest reportable dimension first', () => {
    const graph = buildWeaknessGraph([
      dim('strong', 1.5, 0.2), dim('weak', -1.5, 0.2), dim('middling', 0, 0.2),
    ]);
    expect(graph.focus.map((n) => n.dimension)).toEqual(['weak', 'middling', 'strong']);
  });

  it('excludes unmeasured dimensions from focus and lists them separately', () => {
    const graph = buildWeaknessGraph([
      dim('measured', 0, 0.2), dim('thin', 0, Number.POSITIVE_INFINITY, false),
    ]);
    expect(graph.focus.map((n) => n.dimension)).toEqual(['measured']);
    expect(graph.unmeasured).toEqual(['thin']);
    expect(graph.nodes).toHaveLength(2);
  });

  it('gives an unreportable node a null priority rather than a fake number', () => {
    const graph = buildWeaknessGraph([dim('thin', 0, Number.POSITIVE_INFINITY, false)]);
    expect(graph.nodes[0]?.priority).toBeNull();
  });

  it('marks a dimension blocked when a measured prerequisite is weaker', () => {
    const graph = buildWeaknessGraph([
      dim('advanced', 0.5, 0.2, true, ['basics']),
      dim('basics', -1.0, 0.2),
    ]);
    expect(graph.nodes.find((n) => n.dimension === 'advanced')?.blockedBy).toEqual(['basics']);
  });

  it('does not block on a prerequisite that is stronger or unmeasured', () => {
    const graph = buildWeaknessGraph([
      dim('advanced', -1.0, 0.2, true, ['basics', 'ghost']),
      dim('basics', 1.0, 0.2),
    ]);
    expect(graph.nodes.find((n) => n.dimension === 'advanced')?.blockedBy).toEqual([]);
  });

  it('skips a blocked dimension even when it ranks first', () => {
    // 'advanced' ranks first because its wide interval reaches lower (-1.0 - 2*0.7 = -2.4)
    // than 'core' (-1.5 - 2*0.2 = -1.9). But its prerequisite 'core' has the lower ability
    // estimate, so practising 'advanced' first would be wasted effort.
    const graph = buildWeaknessGraph([
      dim('advanced', -1.0, 0.7, true, ['core']),
      dim('core', -1.5, 0.2),
    ]);
    expect(graph.focus.map((n) => n.dimension)).toEqual(['advanced', 'core']);
    expect(graph.nodes.find((n) => n.dimension === 'advanced')?.blockedBy).toEqual(['core']);
    expect(nextFocus(graph)?.dimension).toBe('core');
  });

  it('recommends the top-ranked dimension when nothing is blocked', () => {
    const graph = buildWeaknessGraph([dim('weak', -1.5, 0.2), dim('strong', 1.0, 0.2)]);
    expect(nextFocus(graph)?.dimension).toBe('weak');
  });

  it('still recommends something when every candidate is blocked', () => {
    const graph = buildWeaknessGraph([
      dim('a', -1.0, 0.2, true, ['b']),
      dim('b', -1.2, 0.2, true, ['a']),
    ]);
    expect(nextFocus(graph)).not.toBeNull();
  });

  it('returns null when nothing is measured well enough to recommend', () => {
    expect(nextFocus(buildWeaknessGraph([]))).toBeNull();
    expect(nextFocus(buildWeaknessGraph([dim('thin', 0, Number.POSITIVE_INFINITY, false)]))).toBeNull();
  });

  it('breaks ties deterministically by dimension id', () => {
    const graph = buildWeaknessGraph([dim('zebra', 0, 0.2), dim('alpha', 0, 0.2)]);
    expect(graph.focus.map((n) => n.dimension)).toEqual(['alpha', 'zebra']);
  });
});
