import { describe, expect, it, vi } from 'vitest';
import { CallCoalescer, SemanticCache, cosineSimilarity, gatedCall, type Embedder } from '../src/local-brain.js';

/** Deterministic embedder: identical text -> identical vector, no network. */
class FakeEmbedder implements Embedder {
  calls = 0;
  async embed(text: string): Promise<number[]> {
    this.calls += 1;
    // A crude bag-of-words hash into a fixed-size vector: shared words push two vectors
    // toward each other, disjoint vocabularies push them toward orthogonal. Good enough to
    // exercise threshold behaviour without a real embedding model.
    const dims = 32;
    const vec = new Array(dims).fill(0);
    for (const word of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
      let h = 0;
      for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) % dims;
      vec[h] += 1;
    }
    return vec;
  }
}

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 9);
  });
  it('is 0 for a zero vector', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
  it('rejects mismatched dimensions', () => {
    expect(() => cosineSimilarity([1], [1, 2])).toThrow(RangeError);
  });
});

describe('SemanticCache', () => {
  it('misses on an empty cache without embedding', async () => {
    const embedder = new FakeEmbedder();
    const cache = new SemanticCache<string>(embedder);
    expect(await cache.lookup('anything')).toBeNull();
    expect(embedder.calls).toBe(0);
  });

  it('hits on a near-duplicate prompt', async () => {
    const cache = new SemanticCache<string>(new FakeEmbedder());
    await cache.store('debug a stalled all-reduce', 'answer-A');
    expect(await cache.lookup('debug a stalled all-reduce')).toBe('answer-A');
  });

  it('misses on an unrelated prompt', async () => {
    const cache = new SemanticCache<string>(new FakeEmbedder());
    await cache.store('debug a stalled all-reduce', 'answer-A');
    expect(await cache.lookup('design a checkpointing system')).toBeNull();
  });

  it('respects the similarity threshold', async () => {
    const cache = new SemanticCache<string>(new FakeEmbedder(), { similarityThreshold: 1.01 });
    await cache.store('x', 'v');
    expect(await cache.lookup('x')).toBeNull();
  });

  it('evicts oldest entries past maxEntries', async () => {
    const cache = new SemanticCache<string>(new FakeEmbedder(), { maxEntries: 2 });
    await cache.store('aaa', '1');
    await cache.store('bbb', '2');
    await cache.store('ccc', '3');
    expect(cache.size).toBe(2);
  });
});

describe('CallCoalescer', () => {
  it('collapses concurrent identical calls into one', async () => {
    const coalescer = new CallCoalescer<number>();
    let calls = 0;
    const fn = async (): Promise<number> => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return 42;
    };
    const [a, b, c] = await Promise.all([
      coalescer.run('k', fn),
      coalescer.run('k', fn),
      coalescer.run('k', fn),
    ]);
    expect([a, b, c]).toEqual([42, 42, 42]);
    expect(calls).toBe(1);
  });

  it('does not coalesce different keys', async () => {
    const coalescer = new CallCoalescer<string>();
    let calls = 0;
    const fn = async (): Promise<string> => {
      calls += 1;
      return 'v';
    };
    await Promise.all([coalescer.run('a', fn), coalescer.run('b', fn)]);
    expect(calls).toBe(2);
  });

  it('clears the key once resolved, so a later call is fresh', async () => {
    const coalescer = new CallCoalescer<number>();
    let calls = 0;
    const fn = async (): Promise<number> => {
      calls += 1;
      return calls;
    };
    const first = await coalescer.run('k', fn);
    const second = await coalescer.run('k', fn);
    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(coalescer.pendingCount).toBe(0);
  });
});

describe('gatedCall (coalesce + semantic cache in front of a reasoning call)', () => {
  it('calls the underlying fn once for a burst of identical concurrent requests', async () => {
    const coalescer = new CallCoalescer<string>();
    const cache = new SemanticCache<string>(new FakeEmbedder());
    const fn = vi.fn(async () => 'llm-response');
    const results = await Promise.all(
      Array.from({ length: 5 }, () => gatedCall('same prompt', coalescer, cache, fn)),
    );
    expect(results.every((r) => r === 'llm-response')).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('answers a later near-duplicate request from cache without calling fn', async () => {
    const coalescer = new CallCoalescer<string>();
    const cache = new SemanticCache<string>(new FakeEmbedder());
    const fn = vi.fn(async () => 'llm-response');
    await gatedCall('debug a stalled all-reduce', coalescer, cache, fn);
    await gatedCall('debug a stalled all-reduce', coalescer, cache, fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('still calls fn for a genuinely different prompt', async () => {
    const coalescer = new CallCoalescer<string>();
    const cache = new SemanticCache<string>(new FakeEmbedder());
    const fn = vi.fn(async () => 'r');
    await gatedCall('prompt one', coalescer, cache, fn);
    await gatedCall('a totally different question', coalescer, cache, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('works with no cache, coalescing only', async () => {
    const coalescer = new CallCoalescer<string>();
    const fn = vi.fn(async () => 'r');
    await Promise.all([gatedCall('k', coalescer, null, fn), gatedCall('k', coalescer, null, fn)]);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
