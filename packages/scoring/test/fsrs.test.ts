import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESIRED_RETENTION,
  DEFAULT_WEIGHTS,
  FsrsError,
  RATINGS,
  dueNow,
  initialState,
  intervalDays,
  nextState,
  retrievability,
  schedule,
} from '../src/fsrs.js';

describe('the forgetting curve', () => {
  it('is 1 at zero elapsed time', () => {
    expect(retrievability(5, 0)).toBeCloseTo(1, 9);
  });

  it('decays monotonically', () => {
    const r = [0, 1, 5, 20, 100].map((d) => retrievability(5, d));
    for (let i = 1; i < r.length; i += 1) expect(r[i]!).toBeLessThan(r[i - 1]!);
  });

  it('decays more slowly at higher stability', () => {
    expect(retrievability(50, 10)).toBeGreaterThan(retrievability(5, 10));
  });

  it('stays inside (0,1]', () => {
    for (const d of [0, 1, 1_000, 100_000]) {
      const r = retrievability(3, d);
      expect(r).toBeGreaterThan(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });

  it.each([
    ['zero stability', 0, 1],
    ['negative stability', -1, 1],
    ['negative elapsed days', 5, -1],
  ])('rejects %s', (_label, stability, days) => {
    expect(() => retrievability(stability, days)).toThrow(FsrsError);
  });
});

describe('scheduling interval', () => {
  it('grows with stability', () => {
    expect(intervalDays(20)).toBeGreaterThan(intervalDays(2));
  });

  it('is at least one day, never zero', () => {
    expect(intervalDays(0.01)).toBeGreaterThanOrEqual(1);
  });

  it('shortens when higher retention is demanded', () => {
    expect(intervalDays(20, 0.97)).toBeLessThan(intervalDays(20, 0.8));
  });

  it('lands near the desired retention at the scheduled day', () => {
    const stability = 15;
    const r = retrievability(stability, intervalDays(stability, DEFAULT_DESIRED_RETENTION));
    expect(r).toBeGreaterThan(0.85);
    expect(r).toBeLessThan(0.95);
  });

  it.each([0, 1, -0.1, 1.5])('rejects an out-of-range retention target %s', (target) => {
    expect(() => intervalDays(10, target)).toThrow(FsrsError);
  });
});

describe('memory state updates', () => {
  it('ships the published default weight vector', () => {
    expect(DEFAULT_WEIGHTS).toHaveLength(17);
    expect(DEFAULT_WEIGHTS.every((w) => Number.isFinite(w))).toBe(true);
  });

  it.each(RATINGS)('produces a valid initial state for rating %s', (rating) => {
    const s = initialState(rating);
    expect(s.stability).toBeGreaterThan(0);
    expect(s.difficulty).toBeGreaterThanOrEqual(1);
    expect(s.difficulty).toBeLessThanOrEqual(10);
  });

  it('starts an easy first answer more stable than a failed one', () => {
    expect(initialState('easy').stability).toBeGreaterThan(initialState('again').stability);
  });

  it('grows stability on a successful review', () => {
    const start = initialState('good');
    const after = nextState(start, 'good', 10);
    expect(after.stability).toBeGreaterThanOrEqual(start.stability);
  });

  it('never lets a lapse raise stability, and never drops it to zero', () => {
    const start = { stability: 40, difficulty: 5 };
    const after = nextState(start, 'again', 30);
    expect(after.stability).toBeLessThanOrEqual(start.stability);
    expect(after.stability).toBeGreaterThan(0);
  });

  it('raises difficulty on a lapse and lowers it on an easy review', () => {
    const start = { stability: 10, difficulty: 5 };
    expect(nextState(start, 'again', 5).difficulty).toBeGreaterThan(start.difficulty);
    expect(nextState(start, 'easy', 5).difficulty).toBeLessThan(start.difficulty);
  });

  it('keeps difficulty inside the 1-10 scale under repeated extremes', () => {
    let state = initialState('again');
    for (let i = 0; i < 40; i += 1) state = nextState(state, 'again', 1);
    expect(state.difficulty).toBeLessThanOrEqual(10);
    let easy = initialState('easy');
    for (let i = 0; i < 40; i += 1) easy = nextState(easy, 'easy', 1);
    expect(easy.difficulty).toBeGreaterThanOrEqual(1);
  });

  it('rewards an easy review more than a hard one', () => {
    const start = { stability: 10, difficulty: 5 };
    expect(nextState(start, 'easy', 10).stability).toBeGreaterThan(
      nextState(start, 'hard', 10).stability,
    );
  });

  it('rejects a non-positive stability', () => {
    expect(() => nextState({ stability: 0, difficulty: 5 }, 'good', 1)).toThrow(FsrsError);
  });
});

describe('resurfacing weak sub-skills', () => {
  const now = new Date('2026-09-01T00:00:00Z');
  const lastWeek = new Date('2026-08-25T00:00:00Z');

  it('reports when a sub-skill is due and how well it is still recalled', () => {
    const s = schedule('failure_modes', { stability: 3, difficulty: 6 }, lastWeek, now);
    expect(s.dimension).toBe('failure_modes');
    expect(s.dueInDays).toBeGreaterThanOrEqual(1);
    expect(s.retrievabilityNow).toBeGreaterThan(0);
    expect(s.retrievabilityNow).toBeLessThan(1);
  });

  it('surfaces the least-recalled skill first', () => {
    const items = [
      schedule('strong', { stability: 200, difficulty: 3 }, lastWeek, now),
      schedule('weak', { stability: 1, difficulty: 8 }, lastWeek, now),
      schedule('middling', { stability: 10, difficulty: 5 }, lastWeek, now),
    ];
    const due = dueNow(items, now);
    expect(due[0]?.dimension).toBe('weak');
  });

  it('does not surface a skill that is not due yet', () => {
    const notDue = schedule('fresh', { stability: 500, difficulty: 3 }, now, now);
    expect(dueNow([notDue], now)).toEqual([]);
  });

  it('treats a review in the future as zero elapsed time rather than negative', () => {
    const future = new Date('2026-12-01T00:00:00Z');
    expect(schedule('x', { stability: 5, difficulty: 5 }, future, now).retrievabilityNow)
      .toBeCloseTo(1, 6);
  });
});
