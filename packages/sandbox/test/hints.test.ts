import { describe, expect, it } from 'vitest';
import {
  HINT_RUNGS,
  HintLadderError,
  RUNG_POLICY,
  SILENCE_INTERRUPT_MS,
  assertLadderIntegrity,
  interruptibleSilences,
  nextRung,
  scoreHintDependence,
  type HintEvent,
} from '../src/hints.js';

const at = (rung: HintEvent['rung'], atMs: number, unprompted = false): HintEvent => ({
  rung, atMs, unprompted,
});

describe('the ladder is ordered and cannot be skipped', () => {
  it('starts at nudge and ends after partial_solution', () => {
    expect(nextRung(null)).toBe('nudge');
    expect(nextRung('nudge')).toBe('constraint');
    expect(nextRung('constraint')).toBe('structure');
    expect(nextRung('structure')).toBe('partial_solution');
    expect(nextRung('partial_solution')).toBeNull();
  });

  it('matches the spec §2.2 rung order exactly', () => {
    expect(HINT_RUNGS).toEqual(['nudge', 'constraint', 'structure', 'partial_solution']);
  });

  it('gives every rung a policy describing what it may reveal', () => {
    for (const rung of HINT_RUNGS) {
      expect(RUNG_POLICY[rung].length).toBeGreaterThan(30);
    }
    // The first rung must not leak an approach; the last must be terminal.
    expect(RUNG_POLICY.nudge).toMatch(/no approach/i);
    expect(RUNG_POLICY.partial_solution).toMatch(/last rung/i);
  });

  it('accepts a well-formed ascending sequence', () => {
    expect(() => assertLadderIntegrity([at('nudge', 1_000), at('constraint', 2_000)])).not.toThrow();
    expect(() => assertLadderIntegrity([])).not.toThrow();
  });

  it('rejects a skipped rung, which would destroy the signal', () => {
    expect(() => assertLadderIntegrity([at('structure', 1_000)])).toThrow(HintLadderError);
    expect(() => assertLadderIntegrity([at('nudge', 1), at('structure', 2)])).toThrow(/skipped/);
  });

  it('rejects a repeated rung and a descending sequence', () => {
    expect(() => assertLadderIntegrity([at('nudge', 1), at('nudge', 2)])).toThrow(HintLadderError);
    expect(() => assertLadderIntegrity([at('nudge', 1), at('constraint', 2), at('nudge', 3)])).toThrow();
  });

  it('rejects a hint offered after the ladder is exhausted', () => {
    const full = [at('nudge', 1), at('constraint', 2), at('structure', 3), at('partial_solution', 4)];
    expect(() => assertLadderIntegrity([...full, at('nudge', 5)])).toThrow(/exhausted/);
  });

  it('rejects an unknown rung rather than treating it as the start', () => {
    // @ts-expect-error deliberately out of contract
    expect(() => nextRung('solution')).toThrow(HintLadderError);
  });
});

describe('silence interrupts (spec §2.2: longer than 45 seconds)', () => {
  it('uses the 45-second threshold', () => {
    expect(SILENCE_INTERRUPT_MS).toBe(45_000);
  });

  it('flags only silences at or past the threshold', () => {
    const windows = [
      { startedMs: 0, endedMs: 44_999 },
      { startedMs: 60_000, endedMs: 105_000 },
      { startedMs: 200_000, endedMs: 260_000 },
    ];
    expect(interruptibleSilences(windows)).toHaveLength(2);
  });

  it('treats exactly 45 seconds as interruptible', () => {
    expect(interruptibleSilences([{ startedMs: 0, endedMs: 45_000 }])).toHaveLength(1);
  });

  it('returns nothing for an empty transcript', () => {
    expect(interruptibleSilences([])).toEqual([]);
  });

  it('rejects a window that ends before it starts', () => {
    expect(() => interruptibleSilences([{ startedMs: 100, endedMs: 50 }])).toThrow(HintLadderError);
  });
});

describe('hint dependence maps onto the published anchors', () => {
  it('scores an unaided solve at the top of the scale', () => {
    const d = scoreHintDependence([]);
    expect(d.anchorLevel).toBe(5);
    expect(d.deepestRung).toBeNull();
    expect(d.hintCount).toBe(0);
  });

  it.each([
    [[at('nudge', 1)], 4],
    [[at('nudge', 1), at('constraint', 2)], 3],
    [[at('nudge', 1), at('constraint', 2), at('structure', 3)], 2],
    [[at('nudge', 1), at('constraint', 2), at('structure', 3), at('partial_solution', 4)], 1],
  ])('scores a ladder ending at rung %#', (events, expected) => {
    expect(scoreHintDependence(events).anchorLevel).toBe(expected);
  });

  it('is a pure function of the deepest rung, so two candidates compare', () => {
    const slow = [at('nudge', 1_000), at('constraint', 90_000)];
    const fast = [at('nudge', 10), at('constraint', 20)];
    expect(scoreHintDependence(slow).anchorLevel).toBe(scoreHintDependence(fast).anchorLevel);
  });

  it('counts unprompted hints separately from requested ones', () => {
    const d = scoreHintDependence([at('nudge', 1, true), at('constraint', 2, false)]);
    expect(d.hintCount).toBe(2);
    expect(d.unpromptedCount).toBe(1);
  });

  it('carries a rationale naming what was required', () => {
    expect(scoreHintDependence([at('nudge', 1)]).rationale).toMatch(/light nudge/i);
    expect(scoreHintDependence([]).rationale).toMatch(/without scaffolding/i);
  });

  it('refuses to score a ladder that skipped a rung', () => {
    expect(() => scoreHintDependence([at('partial_solution', 1)])).toThrow(HintLadderError);
  });
});
