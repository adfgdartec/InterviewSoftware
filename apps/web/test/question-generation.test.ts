import { describe, expect, it } from 'vitest';
import type { Item, RoundType } from '@loopcraft/core';
import {
  MAX_QUESTION_LENGTH,
  NoCatalogItemError,
  chooseCatalogItem,
  rejectionReason,
  selectQuestion,
  type ItemSource,
  type QuestionGenerator,
} from '../src/server/question-generation.js';

function item(id: string, difficultyB: number, bands: Item['levelBands'] = ['L5']): Item {
  return {
    id,
    trackId: 'ml-systems',
    rubricId: 'ml-systems.domain.v1',
    roundType: 'domain',
    prompt: `Catalog prompt ${id}: describe how you would debug a stalled all-reduce.`,
    provenance: 'rubric_generated',
    provenanceNote: 'Generated against ml-systems.domain.v1',
    generatorRubricVersion: 1,
    difficultyB,
    discriminationA: 1.1,
    levelBands: bands,
  };
}

const BANK = [item('easy', -1.2), item('mid', 0.1), item('hard', 1.4)];
const source: ItemSource = {
  itemsFor: (trackId, roundType) =>
    trackId === 'ml-systems' && roundType === 'domain' ? BANK : [],
};

const REQUEST = {
  trackId: 'ml-systems',
  roundType: 'domain' as RoundType,
  levelBand: 'L5' as const,
  excludeItemIds: [],
};
const OPTIONS = { timeoutMs: 50, rubricId: 'ml-systems.domain.v1' };

const generatorReturning = (text: string): QuestionGenerator => ({ generate: async () => text });

describe('generated questions are validated before they are shown', () => {
  it('accepts a well-formed question', () => {
    expect(rejectionReason('How would you shard a 70B model across eight GPUs?')).toBeNull();
  });

  it.each([
    ['too short', 'Why?', 'too_short'],
    ['too long', 'a'.repeat(MAX_QUESTION_LENGTH + 1), 'too_long'],
    ['empty', '   ', 'too_short'],
  ])('rejects a %s question', (_label, text, reason) => {
    expect(rejectionReason(text)).toBe(reason);
  });

  it('rejects a question that asks the candidate about an internal state', () => {
    expect(rejectionReason('How confident did you feel about that decision?')).toMatch(
      /^affect_vocabulary:/,
    );
    expect(rejectionReason('Describe your mood during that outage.')).toMatch(/^affect_vocabulary:/);
  });

  it('still allows a statistical confidence interval in a question', () => {
    expect(
      rejectionReason('How would you report a confidence interval on that latency measurement?'),
    ).toBeNull();
  });

  it('rejects a question claiming to be a real or leaked employer question (spec §5.3)', () => {
    expect(rejectionReason('Here is one of the real interview questions they ask.')).toBe(
      'provenance_claim',
    );
    expect(rejectionReason('These are leaked questions from the onsite loop.')).toBe(
      'provenance_claim',
    );
  });
});

describe('catalog fallback (acceptance criterion 2)', () => {
  it('uses the generated question when it passes validation', async () => {
    const result = await selectQuestion(
      REQUEST,
      generatorReturning('Walk me through debugging an NCCL timeout at 512 GPUs.'),
      source,
      OPTIONS,
    );
    expect(result.source).toBe('generated');
    expect(result.itemId).toBeNull();
    expect(result.fallbackReason).toBeNull();
  });

  it('falls back when the provider throws', async () => {
    const failing: QuestionGenerator = {
      generate: async () => {
        throw new Error('upstream 503');
      },
    };
    const result = await selectQuestion(REQUEST, failing, source, OPTIONS);
    expect(result.source).toBe('catalog_fallback');
    expect(result.fallbackReason).toBe('generation_failed');
    expect(result.itemId).toBe('easy');
  });

  it('falls back when the provider exceeds the timeout', async () => {
    const slow: QuestionGenerator = {
      generate: (_request, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    };
    const result = await selectQuestion(REQUEST, slow, source, { ...OPTIONS, timeoutMs: 10 });
    expect(result.source).toBe('catalog_fallback');
    expect(result.fallbackReason).toBe('generation_timeout');
  });

  it('falls back when the generated text is non-compliant, and records why', async () => {
    const result = await selectQuestion(
      REQUEST,
      generatorReturning('Tell me how enthusiastic you were about that project.'),
      source,
      OPTIONS,
    );
    expect(result.source).toBe('catalog_fallback');
    expect(result.fallbackReason).toBe('affect_vocabulary:enthusiastic');
  });

  it('falls back when no generator is configured at all', async () => {
    const result = await selectQuestion(REQUEST, null, source, OPTIONS);
    expect(result.source).toBe('catalog_fallback');
    expect(result.fallbackReason).toBe('no_generator_configured');
  });

  it('carries the catalog item rubric, not the requested one, when falling back', async () => {
    const result = await selectQuestion(REQUEST, null, source, {
      ...OPTIONS,
      rubricId: 'some.other.rubric',
    });
    expect(result.rubricId).toBe('ml-systems.domain.v1');
  });

  it('throws only when generation fails AND the bank is empty for that pair', async () => {
    await expect(
      selectQuestion({ ...REQUEST, trackId: 'unknown-track' }, null, source, OPTIONS),
    ).rejects.toThrow(NoCatalogItemError);
  });
});

describe('catalog item choice', () => {
  it('prefers an item matching the level band', () => {
    const banded = [item('l3-only', -2, ['L3']), item('l5-ok', 0.9, ['L5', 'L6'])];
    expect(chooseCatalogItem(banded, 'L5', [])?.id).toBe('l5-ok');
  });

  it('falls back to the whole pool when no item matches the band', () => {
    const banded = [item('l3-only', -2, ['L3']), item('l4-only', -1, ['L4'])];
    expect(chooseCatalogItem(banded, 'L7', [])?.id).toBe('l3-only');
  });

  it('never repeats an item already used in the session', () => {
    expect(chooseCatalogItem(BANK, 'L5', ['easy'])?.id).toBe('mid');
    expect(chooseCatalogItem(BANK, 'L5', ['easy', 'mid'])?.id).toBe('hard');
  });

  it('reuses the pool rather than returning nothing once every item is spent', () => {
    expect(chooseCatalogItem(BANK, 'L5', ['easy', 'mid', 'hard'])?.id).toBe('easy');
  });

  it('returns undefined for an empty bank', () => {
    expect(chooseCatalogItem([], 'L5', [])).toBeUndefined();
  });
});
