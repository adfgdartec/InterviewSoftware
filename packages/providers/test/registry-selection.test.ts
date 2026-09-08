import { describe, expect, it } from 'vitest';
import { chain, lookup, selectEntry, type ProviderAvailability } from '../src/index.js';

/**
 * These cover the rule that replaced "probe Ollama, else index fallbacks[0]" at every call
 * site. That idiom silently encoded one particular REGISTRY ordering: once OpenAI moved to
 * primary, `fallbacks[0]` was the *Ollama* entry, so the remote branch would have sent an
 * Ollama model tag to OpenAI's API.
 */

const only = (provider: string): ProviderAvailability => (p) => p === provider;

describe('selectEntry (registry tier resolution)', () => {
  it('takes the primary when its provider is usable', async () => {
    const picked = await selectEntry('grading', only('openai'));
    expect(picked).toEqual(lookup('grading').primary);
    expect(picked?.provider).toBe('openai');
  });

  it('falls through to the next declared provider when the primary is not usable', async () => {
    const picked = await selectEntry('grading', only('ollama'));
    expect(picked?.provider).toBe('ollama');
    expect(picked).toEqual(lookup('grading').fallbacks[0]);
  });

  it('never returns a model belonging to an unusable provider', async () => {
    for (const purpose of ['question_generation', 'interviewer_turn', 'grading', 'debrief'] as const) {
      expect((await selectEntry(purpose, only('openai')))?.provider).toBe('openai');
      expect((await selectEntry(purpose, only('ollama')))?.provider).toBe('ollama');
    }
  });

  it('returns null rather than a default when nothing is usable', async () => {
    expect(await selectEntry('grading', () => false)).toBeNull();
  });

  it('stops probing at the first usable provider, so a working primary costs one probe', async () => {
    const asked: string[] = [];
    await selectEntry('grading', (p) => {
      asked.push(p);
      return true;
    });
    expect(asked).toEqual(['openai']);
  });

  it('probes in declared order, so ordering is the only thing that picks the tier', async () => {
    const asked: string[] = [];
    await selectEntry('grading', (p) => {
      asked.push(p);
      return false;
    });
    expect(asked).toEqual(chain('grading').map((m) => m.provider));
  });

  it('awaits an async probe rather than treating the pending promise as truthy', async () => {
    const picked = await selectEntry('grading', async (p) => {
      await Promise.resolve();
      return p === 'ollama';
    });
    expect(picked?.provider).toBe('ollama');
  });
});

describe('every reasoning purpose can be served by either tier', () => {
  it('declares both a remote and a local provider, so neither deployment is stranded', () => {
    for (const purpose of ['question_generation', 'interviewer_turn', 'grading', 'debrief'] as const) {
      const providers = chain(purpose).map((m) => m.provider);
      expect(providers).toContain('openai');
      expect(providers).toContain('ollama');
    }
  });

  it('keeps grading on a different model from the interviewer in BOTH tiers (spec §2.6)', () => {
    for (const provider of ['openai', 'ollama'] as const) {
      const grader = chain('grading').find((m) => m.provider === provider);
      const interviewer = chain('interviewer_turn').find((m) => m.provider === provider);
      expect(grader?.model).toBeDefined();
      expect(grader?.model).not.toBe(interviewer?.model);
    }
  });
});
