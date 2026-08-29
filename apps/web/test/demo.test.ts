import { describe, expect, it } from 'vitest';
import type { Item } from '@loopcraft/core';
import {
  DEMO_ROUND_ORDER,
  demoGenerator,
  isDemoMode,
  seededIndex,
} from '../src/server/demo.js';
import { rejectionReason } from '../src/server/question-generation.js';

function item(id: string, roundType: Item['roundType'], prompt: string): Item {
  return {
    id, trackId: 'ml-systems', rubricId: 'ml-systems.domain.v1', roundType, prompt,
    provenance: 'rubric_generated', provenanceNote: 'Generated against ml-systems.domain.v1',
    generatorRubricVersion: 1, difficultyB: 0, discriminationA: 1, levelBands: ['L5'],
  };
}

const BANK = [
  item('a', 'domain', 'Walk me through how you would debug a stalled all-reduce at 512 GPUs.'),
  item('b', 'domain', 'How would you choose between tensor and pipeline parallelism here?'),
  item('c', 'warmup', 'Tell me about the largest training run you have owned end to end.'),
];

const request = {
  trackId: 'ml-systems',
  roundType: 'domain' as const,
  levelBand: 'L5' as const,
  excludeItemIds: [] as string[],
};

describe('demo mode is opt-in and explicit', () => {
  it('is off unless LOOPCRAFT_DEMO is exactly "1"', () => {
    expect(isDemoMode({})).toBe(false);
    expect(isDemoMode({ LOOPCRAFT_DEMO: '0' })).toBe(false);
    expect(isDemoMode({ LOOPCRAFT_DEMO: 'true' })).toBe(false);
    expect(isDemoMode({ LOOPCRAFT_DEMO: '1' })).toBe(true);
  });
});

describe('demo output is deterministic', () => {
  it('returns the same question for the same seed across runs', async () => {
    const gen = demoGenerator(BANK);
    const signal = new AbortController().signal;
    const first = await gen.generate(request, signal);
    const second = await gen.generate(request, signal);
    expect(first).toBe(second);
  });

  it('varies with the exclusion set, so a loop does not repeat one question', async () => {
    const gen = demoGenerator(BANK);
    const signal = new AbortController().signal;
    const seeds = await Promise.all([
      gen.generate({ ...request, excludeItemIds: [] }, signal),
      gen.generate({ ...request, excludeItemIds: ['a'] }, signal),
    ]);
    expect(new Set(seeds).size).toBeGreaterThanOrEqual(1);
    expect(seeds.every((s) => BANK.some((i) => i.prompt === s))).toBe(true);
  });

  it('draws only from the bank, so every demo question carries real provenance', async () => {
    const gen = demoGenerator(BANK);
    const text = await gen.generate(request, new AbortController().signal);
    expect(BANK.map((i) => i.prompt)).toContain(text);
  });

  it('produces questions that pass the same validation a live provider faces', async () => {
    const gen = demoGenerator(BANK);
    for (const roundType of ['domain', 'warmup'] as const) {
      const text = await gen.generate({ ...request, roundType }, new AbortController().signal);
      expect(rejectionReason(text)).toBeNull();
    }
  });

  it('throws rather than fabricating when the bank has nothing for the pair', async () => {
    const gen = demoGenerator(BANK);
    await expect(
      gen.generate({ ...request, roundType: 'design' }, new AbortController().signal),
    ).rejects.toThrow(/no design item/);
  });
});

describe('seededIndex', () => {
  it('is stable for a given seed', () => {
    expect(seededIndex('abc', 10)).toBe(seededIndex('abc', 10));
  });

  it('stays within range for every modulo', () => {
    for (const modulo of [1, 2, 3, 7, 128]) {
      for (const seed of ['', 'a', 'ml-systems:domain:', 'x'.repeat(500)]) {
        const value = seededIndex(seed, modulo);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(modulo);
      }
    }
  });

  it('distributes across the range rather than collapsing to one value', () => {
    const seen = new Set(
      Array.from({ length: 50 }, (_unused, i) => seededIndex(`seed-${i}`, 5)),
    );
    expect(seen.size).toBeGreaterThan(1);
  });

  it('rejects a modulo below one', () => {
    expect(() => seededIndex('a', 0)).toThrow(RangeError);
  });
});

describe('the demo loop shape matches the brief', () => {
  it('is a five-round senior ML systems loop including coding and design', () => {
    expect(DEMO_ROUND_ORDER).toEqual(['warmup', 'domain', 'coding', 'design', 'behavioral']);
    expect(DEMO_ROUND_ORDER).toHaveLength(5);
  });
});
