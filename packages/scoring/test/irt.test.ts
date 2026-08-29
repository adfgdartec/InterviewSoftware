import { describe, expect, it } from 'vitest';
import {
  IrtParameterError,
  RECALIBRATION_THRESHOLD,
  REPORTABLE_SE,
  THETA_MAX,
  THETA_MIN,
  estimateAbility,
  fisherInformation,
  isRecalibratable,
  probabilityCorrect,
  readiness,
  selectNextItem,
  type IrtItem,
  type Response,
} from '../src/irt.js';

const item = (id: string, b: number, a = 1.2): IrtItem => ({ id, b, a });
const POOL = [item('e', -1.5), item('m', 0), item('h', 1.5), item('x', 2.5)];

describe('the 2PL model', () => {
  it('is 0.5 at θ = b', () => {
    expect(probabilityCorrect(0, item('m', 0))).toBeCloseTo(0.5, 9);
  });

  it('rises with ability and falls with difficulty', () => {
    expect(probabilityCorrect(2, item('m', 0))).toBeGreaterThan(probabilityCorrect(0, item('m', 0)));
    expect(probabilityCorrect(0, item('h', 2))).toBeLessThan(probabilityCorrect(0, item('m', 0)));
  });

  it('stays inside (0,1) at extreme abilities', () => {
    for (const theta of [-10, 10]) {
      const p = probabilityCorrect(theta, item('m', 0));
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
    }
  });

  it('peaks its information at θ = b and scales with a²', () => {
    const low = fisherInformation(0, item('m', 0, 0.5));
    const high = fisherInformation(0, item('m', 0, 2));
    expect(high).toBeGreaterThan(low);
    expect(fisherInformation(0, item('m', 0))).toBeGreaterThan(fisherInformation(3, item('m', 0)));
  });

  it.each([
    ['zero discrimination', { id: 'z', b: 0, a: 0 }],
    ['negative discrimination', { id: 'n', b: 0, a: -1 }],
    ['non-finite difficulty', { id: 'f', b: Number.NaN, a: 1 }],
  ])('rejects %s', (_label, bad) => {
    expect(() => probabilityCorrect(0, bad as IrtItem)).toThrow(IrtParameterError);
  });
});

describe('ability estimation returns θ with a standard error, never θ alone', () => {
  it('is unreportable with no responses', () => {
    const e = estimateAbility([]);
    expect(e.reportable).toBe(false);
    expect(e.standardError).toBe(Number.POSITIVE_INFINITY);
  });

  it('places a mixed pattern between the items answered', () => {
    const responses: Response[] = [
      { item: item('e', -1.5), correct: true },
      { item: item('m', 0), correct: true },
      { item: item('h', 1.5), correct: false },
      { item: item('x', 2.5), correct: false },
    ];
    const e = estimateAbility(responses);
    expect(e.theta).toBeGreaterThan(-1.5);
    expect(e.theta).toBeLessThan(1.5);
    expect(e.standardError).toBeGreaterThan(0);
    expect(e.responsesUsed).toBe(4);
  });

  it('rises when more hard items are answered correctly', () => {
    const weak = estimateAbility([
      { item: item('m', 0), correct: true },
      { item: item('h', 1.5), correct: false },
    ]);
    const strong = estimateAbility([
      { item: item('m', 0), correct: true },
      { item: item('h', 1.5), correct: true },
      { item: item('x', 2.5), correct: false },
    ]);
    expect(strong.theta).toBeGreaterThan(weak.theta);
  });

  it('refuses to report an all-correct pattern, where MLE is undefined', () => {
    const e = estimateAbility([
      { item: item('e', -1.5), correct: true },
      { item: item('m', 0), correct: true },
    ]);
    expect(e.reportable).toBe(false);
    expect(e.theta).toBe(THETA_MAX);
    expect(e.standardError).toBe(Number.POSITIVE_INFINITY);
  });

  it('refuses to report an all-incorrect pattern for the same reason', () => {
    const e = estimateAbility([
      { item: item('h', 1.5), correct: false },
      { item: item('x', 2.5), correct: false },
    ]);
    expect(e.reportable).toBe(false);
    expect(e.theta).toBe(THETA_MIN);
  });

  it('narrows the standard error as responses accumulate', () => {
    const few: Response[] = [
      { item: item('m', 0), correct: true },
      { item: item('h', 1.5), correct: false },
    ];
    const many: Response[] = [
      ...few,
      { item: item('m2', 0.2), correct: true },
      { item: item('m3', -0.2), correct: true },
      { item: item('h2', 1.2), correct: false },
      { item: item('h3', 1.0), correct: false },
    ];
    expect(estimateAbility(many).standardError).toBeLessThan(estimateAbility(few).standardError);
  });

  it('becomes reportable only once the SE is tight enough', () => {
    const responses: Response[] = Array.from({ length: 20 }, (_u, i) => ({
      item: item(`i${i}`, (i % 5) - 2, 1.5),
      correct: i % 2 === 0,
    }));
    const e = estimateAbility(responses);
    expect(e.standardError).toBeLessThanOrEqual(REPORTABLE_SE);
    expect(e.reportable).toBe(true);
  });

  it('never diverges past the clamp', () => {
    const responses: Response[] = Array.from({ length: 40 }, (_u, i) => ({
      item: item(`i${i}`, -3, 2),
      correct: i > 0,
    }));
    const e = estimateAbility(responses);
    expect(e.theta).toBeGreaterThanOrEqual(THETA_MIN);
    expect(e.theta).toBeLessThanOrEqual(THETA_MAX);
  });
});

describe('item selection (spec §2.5: max information near 60% success)', () => {
  it('picks an item the candidate will probably pass, not the hardest available', () => {
    const chosen = selectNextItem(0, POOL);
    expect(chosen).not.toBeNull();
    expect(chosen!.successProbability).toBeGreaterThan(0.4);
    expect(chosen!.successProbability).toBeLessThan(0.8);
    expect(chosen!.item.id).not.toBe('x');
  });

  it('moves to harder items as ability rises', () => {
    const low = selectNextItem(-1.5, POOL)!;
    const high = selectNextItem(1.5, POOL)!;
    expect(high.item.b).toBeGreaterThan(low.item.b);
  });

  it('never repeats an item already used', () => {
    const first = selectNextItem(0, POOL)!;
    const second = selectNextItem(0, POOL, [first.item.id])!;
    expect(second.item.id).not.toBe(first.item.id);
  });

  it('returns null only when the pool is exhausted', () => {
    expect(selectNextItem(0, POOL, POOL.map((i) => i.id))).toBeNull();
    expect(selectNextItem(0, [])).toBeNull();
  });

  it('falls back to the whole pool rather than refusing to ask a question', () => {
    // Every item is far too easy for this ability; none sits in the target band.
    const chosen = selectNextItem(3.5, [item('e', -3), item('e2', -2.5)]);
    expect(chosen).not.toBeNull();
  });

  it('is deterministic, so a seeded demo reproduces', () => {
    expect(selectNextItem(0, POOL)!.item.id).toBe(selectNextItem(0, POOL)!.item.id);
  });
});

describe('recalibration threshold and readiness', () => {
  it('uses the spec §2.5 threshold of 200 responses', () => {
    expect(RECALIBRATION_THRESHOLD).toBe(200);
    expect(isRecalibratable(199)).toBe(false);
    expect(isRecalibratable(200)).toBe(true);
  });

  it('states readiness as a gap with a standard error, never as an offer probability', () => {
    const responses: Response[] = Array.from({ length: 20 }, (_u, i) => ({
      item: item(`i${i}`, (i % 5) - 2, 1.5),
      correct: i % 2 === 0,
    }));
    const r = readiness(estimateAbility(responses), 1.0);
    expect(r.reportable).toBe(true);
    expect(r.statement).toMatch(/±/);
    expect(r.statement).not.toMatch(/offer|hired|probability|chance|%/i);
  });

  it('says it does not know rather than guessing when evidence is thin', () => {
    const r = readiness(estimateAbility([{ item: item('m', 0), correct: true }]), 1.0);
    expect(r.reportable).toBe(false);
    expect(r.statement).toMatch(/Not enough evidence/i);
    expect(Number.isNaN(r.gap)).toBe(true);
  });
});
